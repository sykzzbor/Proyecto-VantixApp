import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { handoffRuleConfigSchema } from "@/lib/validations/automation-rules";
import { AUTOMATION_SCHEMA_VERSION } from "@/server/automation/constants";
import { getMaxAttempts } from "@/server/automation/config";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";

export type HandoffRecipient = {
  userId: string;
  name: string;
  email: string;
  role: "OWNER" | "ADMIN" | "AGENT" | "VIEWER";
};

export function resolveHandoffRecipients(input: {
  strategy: "ASSIGNED_AGENT" | "OWNERS_ADMINS" | "BOTH";
  assignedUserId: string | null;
  memberships: HandoffRecipient[];
}): { assignedAgent: HandoffRecipient | null; recipients: HandoffRecipient[] } {
  const assignedAgent = input.assignedUserId
    ? input.memberships.find(
        (member) =>
          member.userId === input.assignedUserId && member.role !== "VIEWER"
      ) ?? null
    : null;
  const admins = input.memberships.filter(
    (member) => member.role === "OWNER" || member.role === "ADMIN"
  );
  const selected: HandoffRecipient[] = [];
  const includeAssigned =
    input.strategy === "ASSIGNED_AGENT" || input.strategy === "BOTH";
  const includeAdmins =
    input.strategy === "OWNERS_ADMINS" ||
    input.strategy === "BOTH" ||
    (includeAssigned && !assignedAgent);
  if (includeAssigned && assignedAgent) selected.push(assignedAgent);
  if (includeAdmins) selected.push(...admins);
  return {
    assignedAgent,
    recipients: Array.from(
      new Map(selected.map((recipient) => [recipient.userId, recipient])).values()
    ),
  };
}

export function handoffIdempotencyKey(
  conversationId: string,
  sourceMessageId: string | null
) {
  return `conversation.handoff_requested:${conversationId}:${sourceMessageId ?? "no-source"}`.slice(
    0,
    200
  );
}

export function resolveHandoffEventDispatchState(input: {
  enabled: boolean;
  configValid: boolean;
}) {
  if (!input.enabled) {
    return { status: "CANCELLED" as const, cancellationReason: "rule_disabled" };
  }
  if (!input.configValid) {
    return { status: "CANCELLED" as const, cancellationReason: "rule_invalid" };
  }
  return { status: "PENDING" as const, cancellationReason: null };
}

export type HandoffPreflightResult =
  | { action: "ready" }
  | { action: "cancelled"; reason: string }
  | { action: "not_handoff" }
  | { action: "not_pending" };

export async function runHandoffWithFallback<T>(
  withAutomationEvent: () => Promise<T>,
  withoutAutomationEvent: () => Promise<T>,
  onAutomationError: (error: unknown) => void = () => undefined
) {
  try {
    return await withAutomationEvent();
  } catch (error) {
    onAutomationError(error);
    return withoutAutomationEvent();
  }
}

function safeDisplayName(value: string | null | undefined, fallback: string) {
  return value?.trim().replace(/[<>]/g, "").slice(0, 100) || fallback;
}

function applicationOrigin() {
  const candidates = [
    process.env.BETTER_AUTH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
    process.env.NODE_ENV === "development" ? "http://localhost:3000" : undefined,
    "https://proyecto-vantix-app.vercel.app",
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // Probar el siguiente origen seguro.
    }
  }
  return "https://proyecto-vantix-app.vercel.app";
}

type HandoffInput = {
  organizationId: string;
  conversationId: string;
  sourceMessageId?: string | null;
  userId?: string | null;
  reason: string;
};

async function transitionHandoff(
  tx: Prisma.TransactionClient,
  input: HandoffInput,
  includeAutomationEvent: boolean
) {
  const conversation = await tx.conversation.findFirst({
    where: {
      id: input.conversationId,
      organizationId: input.organizationId,
      status: { not: "CLOSED" },
    },
    select: {
      id: true,
      handlingMode: true,
      assignedUserId: true,
      customer: { select: { name: true } },
      organization: {
        select: {
          name: true,
          businessProfile: { select: { name: true } },
        },
      },
    },
  });
  if (!conversation) throw new Error("conversation_scope_mismatch");
  if (conversation.handlingMode === "HUMAN") {
    return { changed: false, eventId: null as string | null };
  }

  const changedAt = new Date();
  const changed = await tx.conversation.updateMany({
    where: {
      id: conversation.id,
      organizationId: input.organizationId,
      handlingMode: "AI",
      status: { not: "CLOSED" },
    },
    data: { handlingMode: "HUMAN", humanTakeoverAt: changedAt },
  });
  if (changed.count !== 1) {
    return { changed: false, eventId: null as string | null };
  }

  await cancelPendingFollowUpsTx(tx, {
    organizationId: input.organizationId,
    conversationId: conversation.id,
    reason: "human_takeover",
    now: changedAt,
  });

  await tx.message.create({
    data: {
      organizationId: input.organizationId,
      conversationId: conversation.id,
      senderType: "SYSTEM",
      content: "El asistente derivó la conversación a atención humana.",
      createdAt: changedAt,
    },
  });
  await tx.conversation.updateMany({
    where: { id: conversation.id, organizationId: input.organizationId },
    data: { lastMessageAt: changedAt },
  });

  let eventId: string | null = null;
  if (includeAutomationEvent) {
    const rule = await tx.organizationAutomationRule.findUnique({
      where: {
        organizationId_type: {
          organizationId: input.organizationId,
          type: "HANDOFF_ALERT",
        },
      },
      select: { id: true, enabled: true, config: true },
    });
    const config = rule?.enabled
      ? handoffRuleConfigSchema.safeParse(rule.config)
      : null;
    const sourceMessage = input.sourceMessageId
      ? await tx.message.findFirst({
          where: {
            id: input.sourceMessageId,
            organizationId: input.organizationId,
            conversationId: conversation.id,
            senderType: "CUSTOMER",
          },
          select: { id: true },
        })
      : await tx.message.findFirst({
          where: {
            organizationId: input.organizationId,
            conversationId: conversation.id,
            senderType: "CUSTOMER",
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

    let assignedAgent: HandoffRecipient | null = null;
    let recipients: HandoffRecipient[] = [];
    if (rule && config?.success) {
      const memberships = await tx.organizationMember.findMany({
        where: {
          organizationId: input.organizationId,
          OR: [
            { role: { in: ["OWNER", "ADMIN"] } },
            ...(conversation.assignedUserId
              ? [{ userId: conversation.assignedUserId }]
              : []),
          ],
        },
        select: {
          role: true,
          user: { select: { id: true, name: true, email: true } },
        },
      });
      const resolved = resolveHandoffRecipients({
        strategy: config.data.recipients,
        assignedUserId: conversation.assignedUserId,
        memberships: memberships.map((membership) => ({
          userId: membership.user.id,
          name: safeDisplayName(membership.user.name, "Miembro del equipo"),
          email: membership.user.email,
          role: membership.role,
        })),
      });
      assignedAgent = resolved.assignedAgent;
      recipients = resolved.recipients;
    }

    const dispatchState = resolveHandoffEventDispatchState({
      enabled: Boolean(rule?.enabled),
      configValid: Boolean(config?.success),
    });
    const dispatchable = dispatchState.status === "PENDING";
    eventId = randomUUID();
    await tx.automationEvent.create({
      data: {
        id: eventId,
        organizationId: input.organizationId,
        automationRuleId: rule?.id ?? null,
        conversationId: conversation.id,
        sourceMessageId: sourceMessage?.id ?? null,
        type: "conversation.handoff_requested",
        payload: {
          eventId,
          organizationId: input.organizationId,
          conversationId: conversation.id,
          businessName: safeDisplayName(
            conversation.organization.businessProfile?.name ??
              conversation.organization.name,
            "Negocio"
          ),
          customerName: safeDisplayName(
            conversation.customer?.name,
            "Cliente"
          ),
          conversationUrl: `${applicationOrigin()}/dashboard/conversaciones?conversacion=${encodeURIComponent(conversation.id)}`,
          requestedAt: changedAt.toISOString(),
          assignedAgent,
          recipients,
        },
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        status: dispatchState.status,
        cancellationReason: dispatchState.cancellationReason,
        idempotencyKey: handoffIdempotencyKey(
          conversation.id,
          sourceMessage?.id ?? null
        ),
        attempts: 0,
        maxAttempts: getMaxAttempts(),
        nextAttemptAt: dispatchable ? changedAt : null,
        processedAt: dispatchable ? null : changedAt,
      },
    });
  }

  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: "agente.derivacion_solicitada",
      entityType: "conversation",
      entityId: conversation.id,
      details: {
        motivo: input.reason.trim().slice(0, 200),
        automationEventCreated: Boolean(eventId),
      },
    },
  });
  return { changed: true, eventId };
}

/**
 * Refresca destinatarios inmediatamente antes de cada dispatch. Así un retry
 * nunca reutiliza membresías removidas ni una regla que fue pausada.
 */
export async function preflightHandoffForDispatchTx(
  tx: Prisma.TransactionClient,
  eventId: string,
  now = new Date()
): Promise<HandoffPreflightResult> {
    const event = await tx.automationEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        organizationId: true,
        type: true,
        status: true,
        createdAt: true,
        automationRule: {
          select: {
            id: true,
            organizationId: true,
            type: true,
            enabled: true,
            config: true,
          },
        },
        conversation: {
          select: {
            id: true,
            organizationId: true,
            status: true,
            handlingMode: true,
            assignedUserId: true,
            customer: { select: { name: true } },
            organization: {
              select: {
                name: true,
                businessProfile: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!event || event.status !== "PENDING") {
      return { action: "not_pending" } as const;
    }
    if (event.type !== "conversation.handoff_requested") {
      return { action: "not_handoff" } as const;
    }

    const cancel = async (reason: string) => {
      const updated = await tx.automationEvent.updateMany({
        where: {
          id: event.id,
          organizationId: event.organizationId,
          type: "conversation.handoff_requested",
          status: "PENDING",
        },
        data: {
          status: "CANCELLED",
          cancellationReason: reason.slice(0, 120),
          nextAttemptAt: null,
          lockedAt: null,
          processedAt: now,
          lastError: null,
        },
      });
      return updated.count === 1
        ? ({ action: "cancelled", reason } as const)
        : ({ action: "not_pending" } as const);
    };

    const rule = event.automationRule;
    if (
      !rule ||
      rule.organizationId !== event.organizationId ||
      rule.type !== "HANDOFF_ALERT" ||
      !rule.enabled
    ) {
      return cancel("rule_disabled");
    }
    const config = handoffRuleConfigSchema.safeParse(rule.config);
    if (!config.success) return cancel("rule_invalid");

    const conversation = event.conversation;
    if (!conversation || conversation.organizationId !== event.organizationId) {
      return cancel("conversation_deleted");
    }
    if (conversation.status === "CLOSED") {
      return cancel("conversation_closed");
    }
    if (conversation.handlingMode !== "HUMAN") {
      return cancel("handoff_no_longer_active");
    }

    const memberships = await tx.organizationMember.findMany({
      where: {
        organizationId: event.organizationId,
        OR: [
          { role: { in: ["OWNER", "ADMIN"] } },
          ...(conversation.assignedUserId
            ? [{ userId: conversation.assignedUserId }]
            : []),
        ],
      },
      select: {
        role: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
    const resolved = resolveHandoffRecipients({
      strategy: config.data.recipients,
      assignedUserId: conversation.assignedUserId,
      memberships: memberships.map((membership) => ({
        userId: membership.user.id,
        name: safeDisplayName(membership.user.name, "Miembro del equipo"),
        email: membership.user.email,
        role: membership.role,
      })),
    });
    if (resolved.recipients.length === 0) {
      return cancel("no_valid_recipients");
    }

    const updated = await tx.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: event.organizationId,
        type: "conversation.handoff_requested",
        status: "PENDING",
      },
      data: {
        payload: {
          eventId: event.id,
          organizationId: event.organizationId,
          conversationId: conversation.id,
          businessName: safeDisplayName(
            conversation.organization.businessProfile?.name ??
              conversation.organization.name,
            "Negocio"
          ),
          customerName: safeDisplayName(
            conversation.customer?.name,
            "Cliente"
          ),
          conversationUrl: `${applicationOrigin()}/dashboard/conversaciones?conversacion=${encodeURIComponent(conversation.id)}`,
          requestedAt: event.createdAt.toISOString(),
          assignedAgent: resolved.assignedAgent,
          recipients: resolved.recipients,
        },
        cancellationReason: null,
      },
    });
    return updated.count === 1
      ? ({ action: "ready" } as const)
      : ({ action: "not_pending" } as const);
}

export function preflightHandoffForDispatch(
  eventId: string,
  now = new Date()
): Promise<HandoffPreflightResult> {
  return prisma.$transaction((tx) =>
    preflightHandoffForDispatchTx(tx, eventId, now)
  );
}

/**
 * Transición central del tool request_human_support. El outbox se escribe en
 * la misma transacción; si esa parte falla, reintenta solo la derivación para
 * que una automatización nunca deje al cliente sin atención humana.
 */
export async function requestConversationHumanHandoff(input: HandoffInput) {
  return runHandoffWithFallback(
    () => prisma.$transaction((tx) => transitionHandoff(tx, input, true)),
    () => prisma.$transaction((tx) => transitionHandoff(tx, input, false)),
    (error) => {
      console.error(
        "[VantixApp] evento de derivación:",
        error instanceof Error ? error.name : "unknown_error"
      );
    }
  );
}
