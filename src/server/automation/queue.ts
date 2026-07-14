import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSerializableTransactionConflict } from "@/lib/prisma-errors";
import {
  DISPATCH_BATCH_SIZE,
  PROCESSING_STALE_MS,
} from "@/server/automation/constants";
import {
  decideAfterDispatch,
  decideStaleProcessing,
  type EventDecision,
} from "@/server/automation/decide";
import { getAutomationProvider } from "@/server/automation/providers";
import {
  cancelOrphanedPendingFollowUps,
  FOLLOW_UP_CANCELLATION_REASONS,
  FOLLOW_UP_EVENT_TYPE,
  preflightFollowUpForDispatch,
  type FollowUpCancellationReason,
} from "@/server/automation/follow-up";
import type { AutomationProvider } from "@/server/automation/providers";
import type {
  AutomationWebhookPayload,
  DispatchResult,
} from "@/server/automation/types";
import { resolveStaleFollowUpAction } from "@/server/automation/follow-up-action";
import { preflightHandoffForDispatchTx } from "@/server/automation/handoff";

/**
 * Cola persistida en PostgreSQL. No depende de memoria local ni de procesos
 * encendidos permanentemente: cada corrida es un lote acotado, con locking
 * atómico para que dos procesos no ejecuten el mismo evento.
 */

/** Recupera eventos que quedaron colgados en PROCESSING (callback nunca llegó). */
async function reclaimStaleProcessing(now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - PROCESSING_STALE_MS);
  const candidates = await prisma.automationEvent.findMany({
    where: { status: "PROCESSING", lockedAt: { lt: threshold } },
    select: { id: true, organizationId: true },
  });

  let reclaimed = 0;
  for (const candidate of candidates) {
    let changed = false;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        changed = await prisma.$transaction(
          async (tx) => {
            const event = await tx.automationEvent.findFirst({
              where: {
                id: candidate.id,
                organizationId: candidate.organizationId,
                status: "PROCESSING",
                lockedAt: { lt: threshold },
              },
              select: {
                id: true,
                organizationId: true,
                type: true,
                attempts: true,
                maxAttempts: true,
                lockedAt: true,
                actionMessageId: true,
                actionClaimedAt: true,
                cancellationReason: true,
                actionMessage: { select: { deliveryStatus: true } },
              },
            });
            if (!event?.lockedAt) return false;

            const staleAction = resolveStaleFollowUpAction({
              eventType: event.type,
              deliveryStatus: event.actionMessage?.deliveryStatus ?? null,
              actionClaimedAt: event.actionClaimedAt,
            });
            const cancellationReason =
              staleAction === null &&
              event.type === FOLLOW_UP_EVENT_TYPE &&
              event.actionClaimedAt === null &&
              event.cancellationReason &&
              (FOLLOW_UP_CANCELLATION_REASONS as readonly string[]).includes(
                event.cancellationReason
              )
                ? (event.cancellationReason as FollowUpCancellationReason)
                : null;
            let decision: EventDecision;
            if (cancellationReason) {
              decision = {
                status: "CANCELLED",
                attempts: event.attempts,
                nextAttemptAt: null,
                processedAt: now,
                lastError: null,
                clearLock: true,
              };
            } else if (staleAction === "sent") {
              decision = {
                status: "SUCCEEDED",
                attempts: event.attempts,
                nextAttemptAt: null,
                processedAt: now,
                lastError: null,
                clearLock: true,
              };
            } else if (staleAction === "failed") {
              decision = {
                status: "FAILED",
                attempts: event.attempts,
                nextAttemptAt: null,
                processedAt: now,
                lastError: "followup_delivery_failed",
                clearLock: true,
              };
            } else if (staleAction === "ambiguous") {
              decision = {
                status: "DEAD_LETTER",
                attempts: event.attempts,
                nextAttemptAt: null,
                processedAt: now,
                lastError: "followup_delivery_ambiguous",
                clearLock: true,
              };
            } else {
              decision = decideStaleProcessing({
                attempts: event.attempts,
                maxAttempts: event.maxAttempts,
                now,
              });
            }

            const actionGuard: Prisma.AutomationEventWhereInput =
              cancellationReason
                ? {
                    type: FOLLOW_UP_EVENT_TYPE,
                    actionClaimedAt: null,
                    cancellationReason,
                  }
                : staleAction === "sent"
                ? {
                    actionMessageId: event.actionMessageId,
                    actionMessage: {
                      deliveryStatus: { in: ["SENT", "DELIVERED", "READ"] },
                    },
                  }
                : staleAction === "failed"
                  ? {
                      actionMessageId: event.actionMessageId,
                      actionMessage: { deliveryStatus: "FAILED" },
                    }
                  : staleAction === "ambiguous"
                    ? {
                        actionMessageId: event.actionMessageId,
                        actionClaimedAt: event.actionClaimedAt,
                        ...(event.actionMessageId
                          ? { actionMessage: { deliveryStatus: "PENDING" } }
                          : {}),
                      }
                    : { actionClaimedAt: null };

            const updated = await tx.automationEvent.updateMany({
              where: {
                id: event.id,
                organizationId: event.organizationId,
                status: "PROCESSING",
                attempts: event.attempts,
                lockedAt: event.lockedAt,
                ...actionGuard,
              },
              data: {
                status: decision.status,
                nextAttemptAt: decision.nextAttemptAt,
                processedAt: decision.processedAt,
                lastError: decision.lastError,
                lockedAt: null,
                ...(staleAction === "sent" ? { actionCompletedAt: now } : {}),
              },
            });
            if (updated.count !== 1) return false;

            if (cancellationReason && event.actionMessageId) {
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

            const unfinishedRuns = await tx.automationRun.findMany({
              where: {
                organizationId: event.organizationId,
                automationEventId: event.id,
                attempt: event.attempts,
                status: "STARTED",
              },
              select: { id: true, startedAt: true },
            });
            const completedWithoutError =
              Boolean(cancellationReason) || staleAction === "sent";
            for (const run of unfinishedRuns) {
              await tx.automationRun.updateMany({
                where: {
                  id: run.id,
                  organizationId: event.organizationId,
                  automationEventId: event.id,
                  attempt: event.attempts,
                  status: "STARTED",
                },
                data: {
                  status: completedWithoutError ? "SUCCEEDED" : "FAILED",
                  finishedAt: now,
                  durationMs: Math.max(
                    0,
                    now.getTime() - run.startedAt.getTime()
                  ),
                  errorCode:
                    completedWithoutError
                      ? null
                      : decision.lastError ?? "callback_timeout",
                  errorMessage:
                    completedWithoutError
                      ? null
                      : staleAction === "ambiguous"
                        ? "El resultado del envío no pudo confirmarse y no se reintentó para evitar duplicados."
                        : staleAction === "failed"
                          ? "El envío del seguimiento no se completó."
                          : "No se recibió el callback dentro del plazo esperado.",
                  responseMeta:
                    cancellationReason
                      ? {
                          reconciledCancellation: true,
                          reason: cancellationReason,
                        }
                      : staleAction === "sent"
                      ? { reconciledFromActionMessage: true }
                      : undefined,
                },
              });
            }
            if (cancellationReason) {
              await tx.auditLog.create({
                data: {
                  organizationId: event.organizationId,
                  userId: null,
                  action: "automation.followup_cancelled",
                  entityType: "automation_event",
                  entityId: event.id,
                  details: {
                    reason: cancellationReason,
                    reconciledFromStaleProcessing: true,
                  },
                },
              });
            }
            return true;
          },
          { isolationLevel: "Serializable" }
        );
        break;
      } catch (error) {
        if (isSerializableTransactionConflict(error) && retry < 2) {
          continue;
        }
        throw error;
      }
    }
    if (changed) reclaimed++;
  }
  return reclaimed;
}

async function processOneEvent(
  eventId: string,
  provider: AutomationProvider,
  organizationId?: string
): Promise<boolean> {
  const lockedAt = new Date();
  // El run STARTED nace junto con el claim. Así un callback muy rápido siempre
  // encuentra la ejecución y no puede quedar un run STARTED huérfano.
  const claimed = await prisma.$transaction(async (tx) => {
    const handoffPreflight = await preflightHandoffForDispatchTx(
      tx,
      eventId,
      lockedAt
    );
    if (
      handoffPreflight.action === "cancelled" ||
      handoffPreflight.action === "not_pending"
    ) {
      return null;
    }
    const locked = await tx.automationEvent.updateMany({
      where: {
        id: eventId,
        status: "PENDING",
        ...(organizationId ? { organizationId } : {}),
      },
      data: { status: "PROCESSING", lockedAt, attempts: { increment: 1 } },
    });
    if (locked.count !== 1) return null;
    const event = await tx.automationEvent.findUnique({ where: { id: eventId } });
    if (!event) return null;
    const run = await tx.automationRun.create({
      data: {
        organizationId: event.organizationId,
        automationEventId: event.id,
        provider: provider.name,
        status: "STARTED",
        attempt: event.attempts,
        startedAt: lockedAt,
      },
      select: { id: true },
    });
    return { event, runId: run.id };
  });
  if (!claimed) return false;
  const { event, runId } = claimed;

  const startedAt = lockedAt;
  let result: DispatchResult;
  try {
    const webhook: AutomationWebhookPayload = {
      eventId: event.id,
      runId,
      organizationId: event.organizationId,
      type: event.type,
      timestamp: Date.now(),
      schemaVersion: event.schemaVersion,
      idempotencyKey: event.idempotencyKey,
      payload: (event.payload as Record<string, unknown>) ?? {},
    };
    result = await provider.dispatch(webhook);
  } catch {
    result = {
      ok: false,
      retryable: true,
      errorCode: "dispatch_exception",
      errorMessage: "Fallo inesperado al enviar el evento.",
    };
  }

  const finishedAt = new Date();
  const decision = decideAfterDispatch({
    attempts: event.attempts,
    maxAttempts: event.maxAttempts,
    result,
    now: finishedAt,
  });

  await prisma.$transaction(async (tx) => {
    if (result.ok && result.awaitingCallback) {
      await tx.automationRun.updateMany({
        where: {
          id: runId,
          organizationId: event.organizationId,
          automationEventId: event.id,
          attempt: event.attempts,
          status: "STARTED",
        },
        data: {
          externalExecutionId: result.externalExecutionId ?? null,
          responseMeta: result.responseMeta
            ? (result.responseMeta as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return;
    }

    const updatedEvent = await tx.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: event.organizationId,
        status: "PROCESSING",
        attempts: event.attempts,
        lockedAt,
      },
      data: {
        status: decision.status,
        attempts: decision.attempts,
        nextAttemptAt: decision.nextAttemptAt,
        processedAt: decision.processedAt,
        lastError: decision.lastError,
        lockedAt: decision.clearLock ? null : lockedAt,
      },
    });
    if (updatedEvent.count !== 1) return;
    await tx.automationRun.updateMany({
      where: {
        id: runId,
        organizationId: event.organizationId,
        automationEventId: event.id,
        attempt: event.attempts,
        status: "STARTED",
      },
      data: {
        status: result.ok ? "SUCCEEDED" : "FAILED",
        externalExecutionId: result.ok ? result.externalExecutionId ?? null : null,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorCode: result.ok ? null : result.errorCode,
        errorMessage: result.ok ? null : result.errorMessage,
        responseMeta:
          result.ok && result.responseMeta
            ? (result.responseMeta as Prisma.InputJsonValue)
            : undefined,
      },
    });
  });
  return true;
}

/** Despacha un evento ya creado y tenant-scoped, sin barrer la cola global. */
export async function processAutomationEventNow(input: {
  eventId: string;
  organizationId: string;
}): Promise<boolean> {
  const event = await prisma.automationEvent.findFirst({
    where: {
      id: input.eventId,
      organizationId: input.organizationId,
      status: "PENDING",
    },
    select: { id: true },
  });
  if (!event) return false;
  const preflight = await preflightFollowUpForDispatch(event.id);
  if (
    preflight.action === "cancelled" ||
    preflight.action === "rescheduled" ||
    preflight.action === "not_pending"
  ) {
    return false;
  }
  return processOneEvent(
    event.id,
    getAutomationProvider(),
    input.organizationId
  );
}

/**
 * Procesa un lote de eventos pendientes. Idempotente y seguro de ejecutar en
 * paralelo (locking por fila). Pensado para una ejecución programada en Vercel.
 */
export async function processDueAutomationEvents(options?: {
  now?: Date;
  limit?: number;
}): Promise<{ processed: number; reclaimed: number }> {
  const now = options?.now ?? new Date();
  const limit = options?.limit ?? DISPATCH_BATCH_SIZE;

  await cancelOrphanedPendingFollowUps(now);
  const reclaimed = await reclaimStaleProcessing(now);
  const provider = getAutomationProvider();

  const due = await prisma.automationEvent.findMany({
    where: {
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });

  let processed = 0;
  for (const { id } of due) {
    const preflight = await preflightFollowUpForDispatch(id, now);
    if (
      preflight.action === "cancelled" ||
      preflight.action === "rescheduled" ||
      preflight.action === "not_pending"
    ) {
      continue;
    }
    if (await processOneEvent(id, provider)) processed++;
  }
  return { processed, reclaimed };
}
