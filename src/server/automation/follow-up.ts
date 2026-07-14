import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSerializableTransactionConflict } from "@/lib/prisma-errors";
import {
  isAutomationTimeAllowed,
  nextAutomationTimeAllowed,
  scheduleAutomationAfterHours,
} from "@/lib/automation-schedule";
import { followUpRuleConfigSchema } from "@/lib/validations/automation-rules";
import { AUTOMATION_SCHEMA_VERSION } from "@/server/automation/constants";
import { getMaxAttempts } from "@/server/automation/config";

export const FOLLOW_UP_EVENT_TYPE = "conversation.followup_due";

export const FOLLOW_UP_CANCELLATION_REASONS = [
  "customer_replied",
  "conversation_closed",
  "conversation_deleted",
  "rule_disabled",
  "human_takeover",
  "outbound_replaced",
  "integration_disabled",
  "organization_disabled",
  "rule_invalid",
  "source_invalid",
  "maximum_reached",
  "channel_unavailable",
] as const;

export type FollowUpCancellationReason =
  (typeof FOLLOW_UP_CANCELLATION_REASONS)[number];

export type CancelFollowUpsInput = {
  organizationId: string;
  conversationId?: string;
  integrationId?: string;
  reason: FollowUpCancellationReason;
  now?: Date;
};

export function buildFollowUpCancellationScope(
  input: Pick<
    CancelFollowUpsInput,
    "organizationId" | "conversationId" | "integrationId"
  >
): Prisma.AutomationEventWhereInput {
  return {
    organizationId: input.organizationId,
    type: FOLLOW_UP_EVENT_TYPE,
    ...(input.conversationId
      ? { conversationId: input.conversationId }
      : {}),
    ...(input.integrationId
      ? {
          conversation: {
            whatsappIntegrationId: input.integrationId,
          },
        }
      : {}),
  };
}

/** Cancelación tenant-scoped, atómica e idempotente. Nunca toca históricos. */
export async function cancelPendingFollowUpsTx(
  tx: Prisma.TransactionClient,
  input: CancelFollowUpsInput
) {
  const scope = buildFollowUpCancellationScope(input);
  const cancelled = await tx.automationEvent.updateMany({
    where: {
      ...scope,
      status: "PENDING",
    },
    data: {
      status: "CANCELLED",
      cancellationReason: input.reason,
      nextAttemptAt: null,
      lockedAt: null,
      processedAt: input.now ?? new Date(),
      lastError: null,
    },
  });

  // Un evento ya reservado todavía no inició el side effect. Esta marca no
  // altera su estado PROCESSING: ordena atómicamente cancelación vs. claim de
  // envío y la acción firmada lo convierte luego en CANCELLED.
  await tx.automationEvent.updateMany({
    where: {
      ...scope,
      status: "PROCESSING",
      actionClaimedAt: null,
      cancellationReason: null,
    },
    data: { cancellationReason: input.reason },
  });
  return cancelled;
}

export function cancelPendingFollowUps(input: CancelFollowUpsInput) {
  return prisma.$transaction((tx) => cancelPendingFollowUpsTx(tx, input));
}

/** Limpieza periódica para relaciones borradas con ON DELETE SET NULL. */
export async function cancelOrphanedPendingFollowUps(now = new Date()) {
  const orphans = await prisma.automationEvent.findMany({
    where: {
      type: FOLLOW_UP_EVENT_TYPE,
      OR: [
        { status: "PENDING" },
        { status: "PROCESSING", actionClaimedAt: null },
      ],
      AND: [{ OR: [{ conversationId: null }, { sourceMessageId: null }] }],
    },
    select: {
      id: true,
      organizationId: true,
      status: true,
      conversationId: true,
      sourceMessageId: true,
      actionMessageId: true,
    },
  });
  if (orphans.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const event of orphans) {
      const updated = await tx.automationEvent.updateMany({
        where: {
          id: event.id,
          organizationId: event.organizationId,
          type: FOLLOW_UP_EVENT_TYPE,
          status: event.status,
          ...(event.status === "PROCESSING"
            ? { actionClaimedAt: null }
            : {}),
        },
        data: {
          status: "CANCELLED",
          cancellationReason:
            event.conversationId === null
              ? "conversation_deleted"
              : "source_invalid",
          nextAttemptAt: null,
          lockedAt: null,
          processedAt: now,
          lastError: null,
        },
      });
      if (updated.count !== 1) continue;
      if (event.actionMessageId) {
        await tx.message.updateMany({
          where: {
            id: event.actionMessageId,
            organizationId: event.organizationId,
            deliveryStatus: "PENDING",
          },
          data: {
            deliveryStatus: "FAILED",
            errorCode: "cancelled_before_send",
            errorMessage: "El seguimiento se canceló antes del envío.",
          },
        });
      }
      await tx.automationRun.updateMany({
        where: {
          organizationId: event.organizationId,
          automationEventId: event.id,
          status: "STARTED",
        },
        data: {
          status: "FAILED",
          finishedAt: now,
          errorCode: "event_orphaned",
          errorMessage: "La relación del seguimiento dejó de estar disponible.",
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: event.organizationId,
          userId: null,
          action: "automation.followup_cancelled",
          entityType: "automation_event",
          entityId: event.id,
          details: {
            reason:
              event.conversationId === null
                ? "conversation_deleted"
                : "source_invalid",
          },
        },
      });
    }
  });
}

export function followUpIdempotencyKey(input: {
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
}) {
  return `${FOLLOW_UP_EVENT_TYPE}:${input.organizationId}:${input.conversationId}:${input.sourceMessageId}`.slice(
    0,
    200
  );
}

export type ScheduleFollowUpResult =
  | { scheduled: true; eventId: string; nextAttemptAt: Date; duplicate: boolean }
  | { scheduled: false; reason: string };

/**
 * Programa después de un envío confirmado. Falla cerrado y nunca propaga un
 * error hacia el envío de WhatsApp que originó la programación.
 */
export async function scheduleFollowUpAfterOutbound(input: {
  organizationId: string;
  conversationId: string;
  sourceMessageId: string;
  followUpNumber?: number;
}): Promise<ScheduleFollowUpResult> {
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await prisma.$transaction(async (tx) => {
      const source = await tx.message.findFirst({
        where: {
          id: input.sourceMessageId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          senderType: { in: ["AI", "HUMAN"] },
          deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
        },
        select: {
          id: true,
          senderType: true,
          createdAt: true,
          ingestedAt: true,
          conversationId: true,
        },
      });
      if (!source) return { scheduled: false, reason: "source_invalid" };
      const conversation = await tx.conversation.findFirst({
        where: {
          id: source.conversationId,
          organizationId: input.organizationId,
        },
        select: {
          organizationId: true,
          channel: true,
          status: true,
          handlingMode: true,
          humanTakeoverAt: true,
          whatsappIntegrationId: true,
        },
      });
      if (!conversation) {
        return { scheduled: false, reason: "conversation_not_open" };
      }
      if (
        conversation.organizationId !== input.organizationId ||
        conversation.status !== "OPEN"
      ) {
        return { scheduled: false, reason: "conversation_not_open" };
      }
      if (
        source.senderType === "AI" &&
        (conversation.handlingMode === "HUMAN" ||
          Boolean(
            conversation.humanTakeoverAt &&
              conversation.humanTakeoverAt >= source.ingestedAt
          ))
      ) {
        return { scheduled: false, reason: "human_takeover" };
      }
      const integration = conversation.whatsappIntegrationId
        ? await tx.whatsappIntegration.findFirst({
            where: {
              id: conversation.whatsappIntegrationId,
              organizationId: input.organizationId,
            },
            select: { status: true },
          })
        : null;
      if (
        conversation.channel !== "whatsapp" ||
        integration?.status !== "CONNECTED"
      ) {
        return { scheduled: false, reason: "channel_unavailable" };
      }
      const customerReply = await tx.message.findFirst({
        where: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          senderType: "CUSTOMER",
          ingestedAt: { gte: source.ingestedAt },
        },
        select: { id: true },
      });
      if (customerReply) {
        return { scheduled: false, reason: "customer_replied" };
      }
      const newerOutbound = await tx.message.findFirst({
        where: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          senderType: { in: ["AI", "HUMAN"] },
          deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
          ingestedAt: { gte: source.ingestedAt },
          id: { not: source.id },
        },
        select: { id: true },
      });
      if (newerOutbound) {
        return { scheduled: false, reason: "outbound_replaced" };
      }

      const rule = await tx.organizationAutomationRule.findUnique({
        where: {
          organizationId_type: {
            organizationId: input.organizationId,
            type: "FOLLOW_UP",
          },
        },
        select: { id: true, enabled: true, config: true },
      });
      if (!rule?.enabled) return { scheduled: false, reason: "rule_paused" };
      const config = followUpRuleConfigSchema.safeParse(rule.config);
      if (!config.success) return { scheduled: false, reason: "rule_invalid" };

      const sentCount = await tx.automationEvent.count({
        where: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          type: FOLLOW_UP_EVENT_TYPE,
          actionMessage: {
            deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
          },
        },
      });
      if (sentCount >= config.data.maxFollowUps) {
        return { scheduled: false, reason: "maximum_reached" };
      }
      const followUpNumber = input.followUpNumber ?? sentCount + 1;
      if (
        followUpNumber < 1 ||
        followUpNumber > 3 ||
        followUpNumber > config.data.maxFollowUps
      ) {
        return { scheduled: false, reason: "maximum_reached" };
      }

      const existing = await tx.automationEvent.findUnique({
        where: {
          organizationId_type_sourceMessageId: {
            organizationId: input.organizationId,
            type: FOLLOW_UP_EVENT_TYPE,
            sourceMessageId: source.id,
          },
        },
        select: { id: true, nextAttemptAt: true },
      });
      if (existing) {
        return {
          scheduled: true,
          eventId: existing.id,
          nextAttemptAt: existing.nextAttemptAt ?? source.createdAt,
          duplicate: true,
        };
      }

      const now = new Date();
      await cancelPendingFollowUpsTx(tx, {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        reason: "outbound_replaced",
        now,
      });
      const nextAttemptAt = scheduleAutomationAfterHours(
        source.createdAt,
        config.data.delayHours,
        config.data
      );
      const eventId = randomUUID();
      await tx.automationEvent.create({
        data: {
          id: eventId,
          organizationId: input.organizationId,
          automationRuleId: rule.id,
          conversationId: input.conversationId,
          sourceMessageId: source.id,
          type: FOLLOW_UP_EVENT_TYPE,
          payload: {
            eventId,
            organizationId: input.organizationId,
            conversationId: input.conversationId,
            scheduledFor: nextAttemptAt.toISOString(),
            followUpNumber,
            reason: "outbound_message_unanswered",
          },
          schemaVersion: AUTOMATION_SCHEMA_VERSION,
          status: "PENDING",
          idempotencyKey: followUpIdempotencyKey({
            organizationId: input.organizationId,
            conversationId: input.conversationId,
            sourceMessageId: source.id,
          }),
          attempts: 0,
          maxAttempts: getMaxAttempts(),
          nextAttemptAt,
          followUpNumber,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: null,
          action: "automation.followup_scheduled",
          entityType: "automation_event",
          entityId: eventId,
          details: {
            conversationId: input.conversationId,
            followUpNumber,
            scheduledFor: nextAttemptAt.toISOString(),
          },
        },
      });
          return { scheduled: true, eventId, nextAttemptAt, duplicate: false };
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        if (isSerializableTransactionConflict(error) && attempt < 2) {
          continue;
        }
        throw error;
      }
    }
    return { scheduled: false, reason: "serialization_retry_exhausted" };
  } catch (error) {
    const driverKind =
      typeof error === "object" &&
      error !== null &&
      "cause" in error &&
      typeof error.cause === "object" &&
      error.cause !== null &&
      "kind" in error.cause &&
      typeof error.cause.kind === "string"
        ? error.cause.kind
        : null;
    console.error(
      "[VantixApp] programación de seguimiento:",
      error instanceof Error ? error.name : "unknown_error",
      driverKind ?? ""
    );
    return { scheduled: false, reason: "internal_error" };
  }
}

export type FollowUpPreflightResult =
  | { action: "ready" }
  | { action: "cancelled"; reason: FollowUpCancellationReason }
  | { action: "rescheduled"; nextAttemptAt: Date }
  | { action: "not_follow_up" }
  | { action: "not_pending" };

async function cancelEventIfPending(
  eventId: string,
  organizationId: string,
  reason: FollowUpCancellationReason,
  now: Date
) {
  await prisma.automationEvent.updateMany({
    where: {
      id: eventId,
      organizationId,
      type: FOLLOW_UP_EVENT_TYPE,
      status: "PENDING",
    },
    data: {
      status: "CANCELLED",
      cancellationReason: reason,
      nextAttemptAt: null,
      lockedAt: null,
      processedAt: now,
      lastError: null,
    },
  });
  return { action: "cancelled", reason } as const;
}

/** Revalidación previa al claim del dispatcher; no consume un intento. */
export async function preflightFollowUpForDispatch(
  eventId: string,
  now = new Date()
): Promise<FollowUpPreflightResult> {
  const event = await prisma.automationEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      organizationId: true,
      type: true,
      status: true,
      conversationId: true,
      sourceMessageId: true,
      actionMessageId: true,
      followUpNumber: true,
      automationRule: {
        select: { organizationId: true, type: true, enabled: true, config: true },
      },
      conversation: {
        select: {
          organizationId: true,
          status: true,
          handlingMode: true,
          humanTakeoverAt: true,
          channel: true,
          whatsappIntegration: { select: { status: true } },
        },
      },
      sourceMessage: {
        select: {
          organizationId: true,
          conversationId: true,
          senderType: true,
          deliveryStatus: true,
          createdAt: true,
          ingestedAt: true,
        },
      },
    },
  });
  if (!event) return { action: "not_pending" };
  if (event.type !== FOLLOW_UP_EVENT_TYPE) return { action: "not_follow_up" };
  if (event.status !== "PENDING") return { action: "not_pending" };

  const cancel = (reason: FollowUpCancellationReason) =>
    cancelEventIfPending(event.id, event.organizationId, reason, now);
  if (!event.conversation || !event.conversationId) {
    return cancel("conversation_deleted");
  }
  if (
    event.conversation.organizationId !== event.organizationId ||
    event.conversation.status !== "OPEN"
  ) {
    return cancel("conversation_closed");
  }
  if (
    event.conversation.channel !== "whatsapp" ||
    event.conversation.whatsappIntegration?.status !== "CONNECTED"
  ) {
    return cancel("channel_unavailable");
  }
  if (
    !event.sourceMessage ||
    !event.sourceMessageId ||
    event.sourceMessage.organizationId !== event.organizationId ||
    event.sourceMessage.conversationId !== event.conversationId ||
    !["AI", "HUMAN"].includes(event.sourceMessage.senderType) ||
    !["SENT", "DELIVERED", "READ"].includes(
      event.sourceMessage.deliveryStatus ?? ""
    )
  ) {
    return cancel("source_invalid");
  }
  if (
    event.sourceMessage.senderType === "AI" &&
    (event.conversation.handlingMode === "HUMAN" ||
      Boolean(
        event.conversation.humanTakeoverAt &&
          event.conversation.humanTakeoverAt >=
            event.sourceMessage.ingestedAt
      ))
  ) {
    return cancel("human_takeover");
  }
  const rule = event.automationRule;
  const config = rule?.enabled
    ? followUpRuleConfigSchema.safeParse(rule.config)
    : null;
  if (
    !rule ||
    rule.organizationId !== event.organizationId ||
    rule.type !== "FOLLOW_UP" ||
    !rule.enabled
  ) {
    return cancel("rule_disabled");
  }
  if (!config?.success) return cancel("rule_invalid");

  const [customerReply, newerOutbound, sentCount] = await Promise.all([
    prisma.message.findFirst({
      where: {
        organizationId: event.organizationId,
        conversationId: event.conversationId,
        senderType: "CUSTOMER",
        ingestedAt: { gte: event.sourceMessage.ingestedAt },
      },
      select: { id: true },
    }),
    prisma.message.findFirst({
      where: {
        organizationId: event.organizationId,
        conversationId: event.conversationId,
        senderType: { in: ["AI", "HUMAN"] },
        deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
        ingestedAt: { gte: event.sourceMessage.ingestedAt },
        id: {
          notIn: [event.sourceMessageId, event.actionMessageId].filter(
            (id): id is string => Boolean(id)
          ),
        },
      },
      select: { id: true },
    }),
    prisma.automationEvent.count({
      where: {
        organizationId: event.organizationId,
        conversationId: event.conversationId,
        type: FOLLOW_UP_EVENT_TYPE,
        actionMessage: {
          deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
        },
      },
    }),
  ]);
  if (customerReply) return cancel("customer_replied");
  if (newerOutbound) return cancel("outbound_replaced");
  if (
    !event.actionMessageId &&
    (sentCount >= config.data.maxFollowUps ||
      (event.followUpNumber ?? 1) > config.data.maxFollowUps)
  ) {
    return cancel("maximum_reached");
  }

  const minimumDue = scheduleAutomationAfterHours(
    event.sourceMessage.createdAt,
    config.data.delayHours,
    config.data
  );
  if (minimumDue.getTime() > now.getTime()) {
    const updated = await prisma.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: event.organizationId,
        status: "PENDING",
      },
      data: { nextAttemptAt: minimumDue },
    });
    return updated.count === 1
      ? { action: "rescheduled", nextAttemptAt: minimumDue }
      : { action: "not_pending" };
  }

  if (!isAutomationTimeAllowed(now, config.data)) {
    const nextAttemptAt = nextAutomationTimeAllowed(now, config.data);
    const updated = await prisma.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: event.organizationId,
        status: "PENDING",
      },
      data: { nextAttemptAt },
    });
    return updated.count === 1
      ? { action: "rescheduled", nextAttemptAt }
      : { action: "not_pending" };
  }
  return { action: "ready" };
}
