import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSerializableTransactionConflict } from "@/lib/prisma-errors";
import {
  isAutomationTimeAllowed,
  nextAutomationTimeAllowed,
  scheduleAutomationAfterHours,
} from "@/lib/automation-schedule";
import {
  followUpRuleConfigSchema,
  renderFollowUpMessage,
} from "@/lib/validations/automation-rules";
import {
  FOLLOW_UP_CANCELLATION_REASONS,
  FOLLOW_UP_EVENT_TYPE,
  type FollowUpCancellationReason,
} from "@/server/automation/follow-up";
import {
  getAutomationProviderMode,
  type AutomationProviderMode,
} from "@/server/automation/config";
import { sanitizeAutomationMessage } from "@/server/automation/sanitization";
import {
  deliverPreparedWhatsappMessage,
  WhatsappOutboundValidationError,
} from "@/server/whatsapp/outbound";
import { recordAudit } from "@/server/audit";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";

const SENT_DELIVERY_STATUSES = ["SENT", "DELIVERED", "READ"] as const;

export function canExecuteN8nFollowUpAction(input: {
  providerMode: AutomationProviderMode;
  runProvider: string | null;
}): boolean {
  return input.providerMode === "n8n" && input.runProvider === "n8n";
}

export type FollowUpActionResult =
  | {
      ok: true;
      state: "sent" | "already_sent";
      duplicate: boolean;
      messageId: string;
      callbackRequired: true;
    }
  | {
      ok: true;
      state: "cancelled" | "rescheduled";
      duplicate: false;
      callbackRequired: false;
      nextAttemptAt?: string;
    }
  | {
      ok: true;
      state: "in_progress";
      duplicate: true;
      callbackRequired: false;
    }
  | {
      ok: false;
      code:
        | "not_found"
        | "not_executable"
        | "in_progress"
        | "send_failed"
        | "internal_error";
      message: string;
      retryable: boolean;
    };

export type FollowUpEligibilitySnapshot = {
  sameOrganization: boolean;
  sameConversation: boolean;
  eventTypeValid: boolean;
  eventExecutable: boolean;
  ruleEnabled: boolean;
  ruleValid: boolean;
  conversationOpen: boolean;
  humanTakeover: boolean;
  sourceValid: boolean;
  customerReplied: boolean;
  newerOutbound: boolean;
  maximumReached: boolean;
  channelAvailable: boolean;
};

export function decideFollowUpEligibility(
  snapshot: FollowUpEligibilitySnapshot
): { allowed: true } | { allowed: false; reason: FollowUpCancellationReason | "not_executable" } {
  if (
    !snapshot.sameOrganization ||
    !snapshot.sameConversation ||
    !snapshot.eventTypeValid ||
    !snapshot.eventExecutable
  ) {
    return { allowed: false, reason: "not_executable" };
  }
  if (!snapshot.ruleEnabled) return { allowed: false, reason: "rule_disabled" };
  if (!snapshot.ruleValid) return { allowed: false, reason: "rule_invalid" };
  if (!snapshot.conversationOpen) {
    return { allowed: false, reason: "conversation_closed" };
  }
  if (snapshot.humanTakeover) {
    return { allowed: false, reason: "human_takeover" };
  }
  if (!snapshot.sourceValid) return { allowed: false, reason: "source_invalid" };
  if (snapshot.customerReplied) {
    return { allowed: false, reason: "customer_replied" };
  }
  if (snapshot.newerOutbound) {
    return { allowed: false, reason: "outbound_replaced" };
  }
  if (snapshot.maximumReached) {
    return { allowed: false, reason: "maximum_reached" };
  }
  if (!snapshot.channelAvailable) {
    return { allowed: false, reason: "channel_unavailable" };
  }
  return { allowed: true };
}

export function resolveExistingFollowUpAction(input: {
  deliveryStatus: string | null;
  actionClaimedAt: Date | null;
}): "already_sent" | "resume" | "in_progress" | "failed" {
  if (
    SENT_DELIVERY_STATUSES.includes(
      input.deliveryStatus as (typeof SENT_DELIVERY_STATUSES)[number]
    )
  ) {
    return "already_sent";
  }
  if (input.deliveryStatus === "FAILED") return "failed";
  if (input.deliveryStatus === "PENDING" && !input.actionClaimedAt) {
    return "resume";
  }
  return "in_progress";
}

export function resolveStaleFollowUpAction(input: {
  eventType: string;
  deliveryStatus: string | null;
  actionClaimedAt: Date | null;
}): "sent" | "failed" | "ambiguous" | null {
  if (input.eventType !== FOLLOW_UP_EVENT_TYPE) return null;
  if (
    SENT_DELIVERY_STATUSES.includes(
      input.deliveryStatus as (typeof SENT_DELIVERY_STATUSES)[number]
    )
  ) {
    return "sent";
  }
  if (!input.actionClaimedAt) return null;
  if (input.deliveryStatus === "FAILED") return "failed";
  return "ambiguous";
}

function safeName(value: string | null | undefined, fallback: string) {
  return value?.trim().replace(/[<>]/g, "").slice(0, 100) || fallback;
}

async function recordFollowUpAuditBestEffort(
  input: Parameters<typeof recordAudit>[0]
) {
  try {
    await recordAudit(input);
  } catch (error) {
    console.error(
      "[VantixApp] auditoría de seguimiento:",
      error instanceof Error ? error.name : "unknown_error"
    );
  }
}

async function finishTechnicalRun(
  tx: Prisma.TransactionClient,
  eventId: string,
  runId: string,
  organizationId: string,
  now: Date,
  responseMeta: Prisma.InputJsonValue
) {
  const run = await tx.automationRun.findFirst({
    where: {
      id: runId,
      organizationId,
      automationEventId: eventId,
      status: "STARTED",
    },
    select: { id: true, startedAt: true },
  });
  if (!run) return;
  await tx.automationRun.updateMany({
    where: { id: run.id, status: "STARTED" },
    data: {
      status: "SUCCEEDED",
      finishedAt: now,
      durationMs: now.getTime() - run.startedAt.getTime(),
      responseMeta,
    },
  });
}

async function invalidateProcessingEvent(input: {
  eventId: string;
  runId: string;
  organizationId: string;
  reason: FollowUpCancellationReason;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.automationEvent.findFirst({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
        type: FOLLOW_UP_EVENT_TYPE,
        status: "PROCESSING",
        actionClaimedAt: null,
      },
      select: {
        attempts: true,
        actionMessageId: true,
        runs: {
          where: {
            id: input.runId,
            organizationId: input.organizationId,
            status: "STARTED",
          },
          take: 1,
          select: { attempt: true },
        },
      },
    });
    const run = event?.runs[0];
    if (!event || !run || run.attempt !== event.attempts) return false;
    const updated = await tx.automationEvent.updateMany({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
        type: FOLLOW_UP_EVENT_TYPE,
        status: "PROCESSING",
        attempts: event.attempts,
        actionClaimedAt: null,
      },
      data: {
        status: "CANCELLED",
        cancellationReason: input.reason,
        nextAttemptAt: null,
        lockedAt: null,
        processedAt: input.now,
        lastError: null,
      },
    });
    if (updated.count !== 1) return false;
    if (event.actionMessageId) {
      await tx.message.updateMany({
        where: {
          id: event.actionMessageId,
          organizationId: input.organizationId,
          deliveryStatus: "PENDING",
        },
        data: {
          deliveryStatus: "FAILED",
          errorCode: "cancelled_before_send",
          errorMessage: "El seguimiento se canceló antes del envío.",
        },
      });
    }
    await finishTechnicalRun(
      tx,
      input.eventId,
      input.runId,
      input.organizationId,
      input.now,
      {
        cancelled: true,
        reason: input.reason,
      }
    );
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        userId: null,
        action: "automation.followup_cancelled",
        entityType: "automation_event",
        entityId: input.eventId,
        details: { reason: input.reason },
      },
    });
    return true;
  });
}

async function reprogramProcessingEvent(input: {
  eventId: string;
  runId: string;
  organizationId: string;
  nextAttemptAt: Date;
  now: Date;
}) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.automationEvent.findFirst({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
        type: FOLLOW_UP_EVENT_TYPE,
        status: "PROCESSING",
        actionClaimedAt: null,
      },
      select: {
        attempts: true,
        actionMessageId: true,
        runs: {
          where: {
            id: input.runId,
            organizationId: input.organizationId,
            status: "STARTED",
          },
          take: 1,
          select: { attempt: true },
        },
      },
    });
    const run = event?.runs[0];
    if (!event || !run || run.attempt !== event.attempts) return false;
    const updated = await tx.automationEvent.updateMany({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
        type: FOLLOW_UP_EVENT_TYPE,
        status: "PROCESSING",
        attempts: event.attempts,
        actionClaimedAt: null,
      },
      data: {
        status: "PENDING",
        attempts: { decrement: 1 },
        nextAttemptAt: input.nextAttemptAt,
        lockedAt: null,
        processedAt: null,
        lastError: null,
        actionMessageId: null,
        cancellationReason: null,
      },
    });
    if (updated.count !== 1) return false;
    if (event.actionMessageId) {
      await tx.message.updateMany({
        where: {
          id: event.actionMessageId,
          organizationId: input.organizationId,
          deliveryStatus: "PENDING",
        },
        data: {
          deliveryStatus: "FAILED",
          errorCode: "rescheduled_before_send",
          errorMessage: "El seguimiento se reprogramó antes del envío.",
        },
      });
    }
    await finishTechnicalRun(
      tx,
      input.eventId,
      input.runId,
      input.organizationId,
      input.now,
      {
        rescheduled: true,
        nextAttemptAt: input.nextAttemptAt.toISOString(),
      }
    );
    return true;
  });
}

type ReservedAction = {
  messageId: string;
  followUpNumber: number;
};

/**
 * Carga el snapshot de ejecución en consultas secuenciales. Prisma puede
 * descomponer relaciones en ramas paralelas; dentro de una tx interactiva eso
 * comparte un solo cliente `pg` y dejará de estar soportado en pg 9.
 */
async function loadFollowUpExecutionSnapshot(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    runId: string;
    organizationId: string;
    conversationId: string;
    expectedActionMessageId?: string;
  }
) {
  const event = await tx.automationEvent.findFirst({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      ...(input.expectedActionMessageId
        ? { actionMessageId: input.expectedActionMessageId }
        : {}),
    },
    select: {
      id: true,
      organizationId: true,
      conversationId: true,
      automationRuleId: true,
      sourceMessageId: true,
      actionMessageId: true,
      type: true,
      status: true,
      attempts: true,
      followUpNumber: true,
      actionClaimedAt: true,
      cancellationReason: true,
    },
  });
  if (!event) return null;

  const run = await tx.automationRun.findFirst({
    where: {
      id: input.runId,
      organizationId: input.organizationId,
      automationEventId: event.id,
    },
    select: { id: true, provider: true, status: true, attempt: true },
  });
  const actionMessage = event.actionMessageId
    ? await tx.message.findFirst({
        where: {
          id: event.actionMessageId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
        },
        select: { id: true, deliveryStatus: true },
      })
    : null;
  const sourceMessage = event.sourceMessageId
    ? await tx.message.findFirst({
        where: {
          id: event.sourceMessageId,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
        },
        select: {
          id: true,
          organizationId: true,
          conversationId: true,
          senderType: true,
          deliveryStatus: true,
          createdAt: true,
          ingestedAt: true,
        },
      })
    : null;
  const automationRule = event.automationRuleId
    ? await tx.organizationAutomationRule.findFirst({
        where: {
          id: event.automationRuleId,
          organizationId: input.organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          type: true,
          enabled: true,
          config: true,
        },
      })
    : null;
  const conversationRow = await tx.conversation.findFirst({
    where: {
      id: input.conversationId,
      organizationId: input.organizationId,
    },
    select: {
      id: true,
      organizationId: true,
      customerId: true,
      whatsappIntegrationId: true,
      status: true,
      handlingMode: true,
      humanTakeoverAt: true,
      channel: true,
    },
  });
  const customer = conversationRow?.customerId
    ? await tx.customer.findFirst({
        where: {
          id: conversationRow.customerId,
          organizationId: input.organizationId,
        },
        select: { name: true, phone: true },
      })
    : null;
  const whatsappIntegration = conversationRow?.whatsappIntegrationId
    ? await tx.whatsappIntegration.findFirst({
        where: {
          id: conversationRow.whatsappIntegrationId,
          organizationId: input.organizationId,
        },
        select: { status: true },
      })
    : null;
  const organization = conversationRow
    ? await tx.organization.findUnique({
        where: { id: input.organizationId },
        select: { name: true },
      })
    : null;
  const businessProfile = conversationRow
    ? await tx.businessProfile.findUnique({
        where: { organizationId: input.organizationId },
        select: { name: true },
      })
    : null;

  return {
    ...event,
    actionMessage,
    sourceMessage,
    automationRule,
    runs: run ? [run] : [],
    conversation: conversationRow
      ? {
          ...conversationRow,
          customer,
          whatsappIntegration,
          organization: {
            name: organization?.name ?? "",
            businessProfile,
          },
        }
      : null,
  };
}

async function reserveFollowUpMessageOnce(input: {
  eventId: string;
  runId: string;
  organizationId: string;
  conversationId: string;
  now: Date;
  providerMode: AutomationProviderMode;
}): Promise<
  | { kind: "reserved"; data: ReservedAction }
  | { kind: "existing"; result: FollowUpActionResult }
  | { kind: "cancel"; reason: FollowUpCancellationReason }
  | { kind: "reschedule"; nextAttemptAt: Date }
  | { kind: "not_found" }
  | { kind: "not_executable" }
> {
  return prisma.$transaction(
    async (tx) => {
      const event = await loadFollowUpExecutionSnapshot(tx, input);
      if (!event) return { kind: "not_found" } as const;
      const activeRun = event.runs[0];
      if (
        !activeRun ||
        activeRun.status !== "STARTED" ||
        activeRun.attempt !== event.attempts ||
        !canExecuteN8nFollowUpAction({
          providerMode: input.providerMode,
          runProvider: activeRun.provider,
        })
      ) {
        return { kind: "not_executable" } as const;
      }
      const requestedCancellation = knownCancellationReason(
        event.cancellationReason
      );
      if (requestedCancellation) {
        return { kind: "cancel", reason: requestedCancellation } as const;
      }
      if (event.actionMessage) {
        const actionState = resolveExistingFollowUpAction({
          deliveryStatus: event.actionMessage.deliveryStatus,
          actionClaimedAt: event.actionClaimedAt,
        });
        if (actionState === "already_sent") {
          return {
            kind: "existing",
            result: {
              ok: true,
              state: "already_sent",
              duplicate: true,
              messageId: event.actionMessage.id,
              callbackRequired: true,
            },
          } as const;
        }
        if (actionState === "resume") {
          return {
            kind: "reserved",
            data: {
              messageId: event.actionMessage.id,
              followUpNumber: event.followUpNumber ?? 1,
            },
          } as const;
        }
        if (actionState === "in_progress") {
          return {
            kind: "existing",
            result: {
              ok: true,
              state: "in_progress",
              duplicate: true,
              callbackRequired: false,
            },
          } as const;
        }
        return {
          kind: "existing",
          result: {
            ok: false,
            code: "send_failed",
            message:
              "El envío anterior no se completó y no se repetirá automáticamente.",
            retryable: false,
          },
        } as const;
      }
      if (event.type !== FOLLOW_UP_EVENT_TYPE || event.status !== "PROCESSING") {
        return { kind: "not_executable" } as const;
      }

      const rule = event.automationRule;
      const config = rule?.enabled
        ? followUpRuleConfigSchema.safeParse(rule.config)
        : null;
      const source = event.sourceMessage;
      const conversation = event.conversation;
      const customerReply = source
        ? await tx.message.findFirst({
            where: {
              organizationId: input.organizationId,
              conversationId: input.conversationId,
              senderType: "CUSTOMER",
              ingestedAt: { gte: source.ingestedAt },
            },
            select: { id: true },
          })
        : null;
      const newerOutbound = source
        ? await tx.message.findFirst({
            where: {
              organizationId: input.organizationId,
              conversationId: input.conversationId,
              senderType: { in: ["AI", "HUMAN"] },
              deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
              ingestedAt: { gte: source.ingestedAt },
              id: { not: source.id },
            },
            select: { id: true },
          })
        : null;
      const sentCount = source
        ? await tx.automationEvent.count({
            where: {
              organizationId: input.organizationId,
              conversationId: input.conversationId,
              type: FOLLOW_UP_EVENT_TYPE,
              actionMessage: {
                deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
              },
            },
          })
        : 0;

      const eligibility = decideFollowUpEligibility({
        sameOrganization:
          conversation?.organizationId === input.organizationId &&
          rule?.organizationId === input.organizationId &&
          source?.organizationId === input.organizationId,
        sameConversation:
          event.conversationId === input.conversationId &&
          source?.conversationId === input.conversationId,
        eventTypeValid: event.type === FOLLOW_UP_EVENT_TYPE,
        eventExecutable: event.status === "PROCESSING",
        ruleEnabled: Boolean(rule?.enabled),
        ruleValid: Boolean(config?.success && rule?.type === "FOLLOW_UP"),
        conversationOpen: conversation?.status === "OPEN",
        humanTakeover: Boolean(
          source?.senderType === "AI" &&
            (conversation?.handlingMode === "HUMAN" ||
              (conversation?.humanTakeoverAt &&
                conversation.humanTakeoverAt >= source.ingestedAt))
        ),
        sourceValid: Boolean(
          source &&
            ["AI", "HUMAN"].includes(source.senderType) &&
            SENT_DELIVERY_STATUSES.includes(
              source.deliveryStatus as (typeof SENT_DELIVERY_STATUSES)[number]
            )
        ),
        customerReplied: Boolean(customerReply),
        newerOutbound: Boolean(newerOutbound),
        maximumReached: Boolean(
          config?.success &&
            (sentCount >= config.data.maxFollowUps ||
              (event.followUpNumber ?? 1) > config.data.maxFollowUps)
        ),
        channelAvailable: Boolean(
          conversation?.channel === "whatsapp" &&
            conversation.customer?.phone &&
            conversation.whatsappIntegration?.status === "CONNECTED"
        ),
      });
      if (!eligibility.allowed) {
        return eligibility.reason === "not_executable"
          ? ({ kind: "not_executable" } as const)
          : ({ kind: "cancel", reason: eligibility.reason } as const);
      }
      if (!config?.success || !conversation || !source || !rule) {
        return { kind: "not_executable" } as const;
      }
      const minimumDue = scheduleAutomationAfterHours(
        source.createdAt,
        config.data.delayHours,
        config.data
      );
      if (minimumDue.getTime() > input.now.getTime()) {
        return { kind: "reschedule", nextAttemptAt: minimumDue } as const;
      }
      if (!isAutomationTimeAllowed(input.now, config.data)) {
        return {
          kind: "reschedule",
          nextAttemptAt: nextAutomationTimeAllowed(input.now, config.data),
        } as const;
      }

      const followUpNumber = event.followUpNumber ?? 1;
      const content = renderFollowUpMessage(config.data.message, {
        customerName: safeName(conversation.customer?.name, "cliente"),
        businessName: safeName(
          conversation.organization.businessProfile?.name ??
            conversation.organization.name,
          "nuestro equipo"
        ),
      });
      const message = await tx.message.create({
        data: {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          senderType: "AI",
          content,
          deliveryStatus: "PENDING",
          metadata: {
            source: "automation_follow_up",
            automationEventId: event.id,
            followUpNumber,
          },
        },
        select: { id: true },
      });
      const claimed = await tx.automationEvent.updateMany({
        where: {
          id: event.id,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          type: FOLLOW_UP_EVENT_TYPE,
          status: "PROCESSING",
          actionMessageId: null,
          actionClaimedAt: null,
        },
        data: { actionMessageId: message.id },
      });
      if (claimed.count !== 1) throw new Error("followup_claim_conflict");
      await tx.conversation.updateMany({
        where: {
          id: input.conversationId,
          organizationId: input.organizationId,
          status: "OPEN",
        },
        data: { lastMessageAt: input.now },
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: null,
          action: "automation.followup_claimed",
          entityType: "automation_event",
          entityId: event.id,
          details: { conversationId: input.conversationId, followUpNumber },
        },
      });
      return {
        kind: "reserved",
        data: { messageId: message.id, followUpNumber },
      } as const;
    },
    { isolationLevel: "Serializable" }
  );
}

async function reserveFollowUpMessage(
  input: Parameters<typeof reserveFollowUpMessageOnce>[0]
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await reserveFollowUpMessageOnce(input);
    } catch (error) {
      if (isSerializableTransactionConflict(error) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("followup_reservation_retry_exhausted");
}

type DeliveryClaimResult =
  | { kind: "ready" }
  | { kind: "cancel"; reason: FollowUpCancellationReason }
  | { kind: "reschedule"; nextAttemptAt: Date }
  | { kind: "not_executable" };

function knownCancellationReason(
  value: string | null
): FollowUpCancellationReason | null {
  return value &&
    (FOLLOW_UP_CANCELLATION_REASONS as readonly string[]).includes(value)
    ? (value as FollowUpCancellationReason)
    : null;
}

/**
 * Segundo claim inmediatamente anterior a Meta. Compite por la misma fila con
 * la marca que escriben mensaje entrante/cierre/pausa: solo una decisión puede
 * confirmar primero y la que pierde falla cerrada.
 */
async function claimFollowUpDeliveryOnce(input: {
  eventId: string;
  runId: string;
  organizationId: string;
  conversationId: string;
  messageId: string;
  now: Date;
}): Promise<DeliveryClaimResult> {
  return prisma.$transaction(
    async (tx) => {
      const event = await loadFollowUpExecutionSnapshot(tx, {
        ...input,
        expectedActionMessageId: input.messageId,
      });
      if (!event) return { kind: "not_executable" };
      const run = event.runs[0];
      if (
        event.type !== FOLLOW_UP_EVENT_TYPE ||
        event.status !== "PROCESSING" ||
        event.actionClaimedAt ||
        event.actionMessage?.deliveryStatus !== "PENDING" ||
        !run ||
        run.status !== "STARTED" ||
        run.attempt !== event.attempts
      ) {
        return { kind: "not_executable" };
      }
      const requestedCancellation = knownCancellationReason(
        event.cancellationReason
      );
      if (requestedCancellation) {
        return { kind: "cancel", reason: requestedCancellation };
      }

      const rule = event.automationRule;
      const config = rule?.enabled
        ? followUpRuleConfigSchema.safeParse(rule.config)
        : null;
      const source = event.sourceMessage;
      const conversation = event.conversation;
      const customerReply = source
        ? await tx.message.findFirst({
            where: {
              organizationId: input.organizationId,
              conversationId: input.conversationId,
              senderType: "CUSTOMER",
              ingestedAt: { gte: source.ingestedAt },
            },
            select: { id: true },
          })
        : null;
      const newerOutbound = source
        ? await tx.message.findFirst({
            where: {
              organizationId: input.organizationId,
              conversationId: input.conversationId,
              senderType: { in: ["AI", "HUMAN"] },
              deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
              ingestedAt: { gte: source.ingestedAt },
              id: { notIn: [source.id, input.messageId] },
            },
            select: { id: true },
          })
        : null;
      const sentCount = source
        ? await tx.automationEvent.count({
            where: {
              organizationId: input.organizationId,
              conversationId: input.conversationId,
              type: FOLLOW_UP_EVENT_TYPE,
              actionMessage: {
                deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
              },
            },
          })
        : 0;

      const eligibility = decideFollowUpEligibility({
        sameOrganization:
          conversation?.organizationId === input.organizationId &&
          rule?.organizationId === input.organizationId &&
          source?.organizationId === input.organizationId,
        sameConversation: source?.conversationId === input.conversationId,
        eventTypeValid: event.type === FOLLOW_UP_EVENT_TYPE,
        eventExecutable: event.status === "PROCESSING",
        ruleEnabled: Boolean(rule?.enabled),
        ruleValid: Boolean(config?.success && rule?.type === "FOLLOW_UP"),
        conversationOpen: conversation?.status === "OPEN",
        humanTakeover: Boolean(
          source?.senderType === "AI" &&
            (conversation?.handlingMode === "HUMAN" ||
              (conversation?.humanTakeoverAt &&
                conversation.humanTakeoverAt >= source.ingestedAt))
        ),
        sourceValid: Boolean(
          source &&
            ["AI", "HUMAN"].includes(source.senderType) &&
            SENT_DELIVERY_STATUSES.includes(
              source.deliveryStatus as (typeof SENT_DELIVERY_STATUSES)[number]
            )
        ),
        customerReplied: Boolean(customerReply),
        newerOutbound: Boolean(newerOutbound),
        maximumReached: Boolean(
          config?.success &&
            (sentCount >= config.data.maxFollowUps ||
              (event.followUpNumber ?? 1) > config.data.maxFollowUps)
        ),
        channelAvailable: Boolean(
          conversation?.channel === "whatsapp" &&
            conversation.customer?.phone &&
            conversation.whatsappIntegration?.status === "CONNECTED"
        ),
      });
      if (!eligibility.allowed) {
        return eligibility.reason === "not_executable"
          ? ({ kind: "not_executable" } as const)
          : ({ kind: "cancel", reason: eligibility.reason } as const);
      }
      if (!config?.success) return { kind: "not_executable" };
      if (!source) return { kind: "not_executable" };
      const minimumDue = scheduleAutomationAfterHours(
        source.createdAt,
        config.data.delayHours,
        config.data
      );
      if (minimumDue.getTime() > input.now.getTime()) {
        return { kind: "reschedule", nextAttemptAt: minimumDue };
      }
      if (!isAutomationTimeAllowed(input.now, config.data)) {
        return {
          kind: "reschedule",
          nextAttemptAt: nextAutomationTimeAllowed(input.now, config.data),
        };
      }

      const claimed = await tx.automationEvent.updateMany({
        where: {
          id: event.id,
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          status: "PROCESSING",
          actionMessageId: input.messageId,
          actionClaimedAt: null,
          cancellationReason: null,
        },
        data: { actionClaimedAt: input.now },
      });
      if (claimed.count === 1) return { kind: "ready" };

      const raced = await tx.automationEvent.findFirst({
        where: { id: event.id, organizationId: input.organizationId },
        select: { cancellationReason: true },
      });
      const reason = knownCancellationReason(
        raced?.cancellationReason ?? null
      );
      return reason
        ? { kind: "cancel", reason }
        : { kind: "not_executable" };
    },
    { isolationLevel: "Serializable" }
  );
}

async function claimFollowUpDelivery(
  input: Parameters<typeof claimFollowUpDeliveryOnce>[0]
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await claimFollowUpDeliveryOnce(input);
    } catch (error) {
      if (isSerializableTransactionConflict(error) && attempt < 2) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("followup_delivery_claim_retry_exhausted");
}

/** Ejecuta una acción n8n ya autenticada; nunca confía en texto o teléfonos. */
export async function executeFollowUpAction(input: {
  eventId: string;
  runId: string;
  organizationId: string;
  conversationId: string;
}, testHooks?: {
  afterReservation?: () => Promise<void>;
  afterDeliveryClaim?: () => Promise<void>;
  getProviderMode?: typeof getAutomationProviderMode;
}): Promise<FollowUpActionResult> {
  const providerMode = (
    testHooks?.getProviderMode ?? getAutomationProviderMode
  )();
  if (providerMode !== "n8n") {
    return {
      ok: false,
      code: "not_executable",
      message: "El proveedor de automatización no está habilitado para esta acción.",
      retryable: false,
    };
  }
  const entitlement = await getOrganizationEntitlement(input.organizationId);
  if (!entitlement.accessAllowed) {
    return {
      ok: false,
      code: "not_executable",
      message: "La suscripción de la organización no permite ejecutar esta acción.",
      retryable: false,
    };
  }
  const now = new Date();
  let reservation: Awaited<ReturnType<typeof reserveFollowUpMessage>>;
  try {
    reservation = await reserveFollowUpMessage({ ...input, now, providerMode });
  } catch (error) {
    console.error(
      "[VantixApp] reserva de seguimiento:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return {
      ok: false,
      code: "internal_error",
      message: "No se pudo preparar el seguimiento.",
      retryable: true,
    };
  }

  if (reservation.kind === "not_found") {
    return {
      ok: false,
      code: "not_found",
      message: "El evento no existe.",
      retryable: false,
    };
  }
  if (reservation.kind === "not_executable") {
    return {
      ok: false,
      code: "not_executable",
      message: "El evento ya no se puede ejecutar.",
      retryable: false,
    };
  }
  if (reservation.kind === "existing") return reservation.result;
  if (reservation.kind === "cancel") {
    const applied = await invalidateProcessingEvent({
      eventId: input.eventId,
      runId: input.runId,
      organizationId: input.organizationId,
      reason: reservation.reason,
      now,
    });
    if (!applied) {
      return {
        ok: true,
        state: "in_progress",
        duplicate: true,
        callbackRequired: false,
      };
    }
    return {
      ok: true,
      state: "cancelled",
      duplicate: false,
      callbackRequired: false,
    };
  }
  if (reservation.kind === "reschedule") {
    const applied = await reprogramProcessingEvent({
      eventId: input.eventId,
      runId: input.runId,
      organizationId: input.organizationId,
      nextAttemptAt: reservation.nextAttemptAt,
      now,
    });
    if (!applied) {
      return {
        ok: true,
        state: "in_progress",
        duplicate: true,
        callbackRequired: false,
      };
    }
    return {
      ok: true,
      state: "rescheduled",
      duplicate: false,
      callbackRequired: false,
      nextAttemptAt: reservation.nextAttemptAt.toISOString(),
    };
  }

  await testHooks?.afterReservation?.();
  const claimNow = new Date();
  let deliveryClaim: Awaited<ReturnType<typeof claimFollowUpDelivery>>;
  try {
    deliveryClaim = await claimFollowUpDelivery({
      ...input,
      messageId: reservation.data.messageId,
      now: claimNow,
    });
  } catch (error) {
    console.error(
      "[VantixApp] claim de envío de seguimiento:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return {
      ok: false,
      code: "internal_error",
      message: "No se pudo confirmar el seguimiento para envío.",
      retryable: true,
    };
  }
  if (deliveryClaim.kind === "cancel") {
    const applied = await invalidateProcessingEvent({
      eventId: input.eventId,
      runId: input.runId,
      organizationId: input.organizationId,
      reason: deliveryClaim.reason,
      now: claimNow,
    });
    if (!applied) {
      return {
        ok: true,
        state: "in_progress",
        duplicate: true,
        callbackRequired: false,
      };
    }
    return {
      ok: true,
      state: "cancelled",
      duplicate: false,
      callbackRequired: false,
    };
  }
  if (deliveryClaim.kind === "reschedule") {
    const applied = await reprogramProcessingEvent({
      eventId: input.eventId,
      runId: input.runId,
      organizationId: input.organizationId,
      nextAttemptAt: deliveryClaim.nextAttemptAt,
      now: claimNow,
    });
    if (!applied) {
      return {
        ok: true,
        state: "in_progress",
        duplicate: true,
        callbackRequired: false,
      };
    }
    return {
      ok: true,
      state: "rescheduled",
      duplicate: false,
      callbackRequired: false,
      nextAttemptAt: deliveryClaim.nextAttemptAt.toISOString(),
    };
  }
  if (deliveryClaim.kind === "not_executable") {
    return {
      ok: true,
      state: "in_progress",
      duplicate: true,
      callbackRequired: false,
    };
  }

  await testHooks?.afterDeliveryClaim?.();
  try {
    const sent = await deliverPreparedWhatsappMessage({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: reservation.data.messageId,
      senderUserId: null,
      scheduleFollowUp: true,
      nextFollowUpNumber: reservation.data.followUpNumber + 1,
    });
    try {
      await prisma.automationEvent.updateMany({
        where: {
          id: input.eventId,
          organizationId: input.organizationId,
          actionMessageId: reservation.data.messageId,
        },
        data: { actionCompletedAt: new Date() },
      });
    } catch (error) {
      console.error(
        "[VantixApp] cierre de acción de seguimiento:",
        error instanceof Error ? error.name : "unknown_error"
      );
    }
    if (!sent.ok) {
      await recordFollowUpAuditBestEffort({
        organizationId: input.organizationId,
        userId: null,
        action: "automation.followup_send_failed",
        entityType: "automation_event",
        entityId: input.eventId,
        details: { code: "provider_error" },
      });
      return {
        ok: false,
        code: "send_failed",
        message: sanitizeAutomationMessage(sent.error) ?? "No se pudo enviar el seguimiento.",
        retryable: false,
      };
    }
    await recordFollowUpAuditBestEffort({
      organizationId: input.organizationId,
      userId: null,
      action: "automation.followup_sent",
      entityType: "automation_event",
      entityId: input.eventId,
      details: {
        conversationId: input.conversationId,
        followUpNumber: reservation.data.followUpNumber,
      },
    });
    return {
      ok: true,
      state: "sent",
      duplicate: false,
      messageId: sent.message.id,
      callbackRequired: true,
    };
  } catch (error) {
    const known = error instanceof WhatsappOutboundValidationError;
    if (known) {
      await prisma.message.updateMany({
        where: {
          id: reservation.data.messageId,
          organizationId: input.organizationId,
          deliveryStatus: "PENDING",
        },
        data: {
          deliveryStatus: "FAILED",
          errorCode: "validation_failed",
          errorMessage: "El canal ya no está disponible.",
        },
      });
    }
    await recordFollowUpAuditBestEffort({
      organizationId: input.organizationId,
      userId: null,
      action: "automation.followup_send_failed",
      entityType: "automation_event",
      entityId: input.eventId,
      details: { code: known ? "channel_unavailable" : "ambiguous_result" },
    });
    console.error(
      "[VantixApp] envío de seguimiento:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return {
      ok: false,
      code: known ? "send_failed" : "internal_error",
      message: known
        ? "El canal ya no está disponible."
        : "No se pudo confirmar el envío. No se repetirá automáticamente.",
      retryable: false,
    };
  }
}
