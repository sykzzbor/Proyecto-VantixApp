import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DISPATCH_BATCH_SIZE,
  PROCESSING_STALE_MS,
} from "@/server/automation/constants";
import {
  decideAfterDispatch,
  decideStaleProcessing,
} from "@/server/automation/decide";
import { getAutomationProvider } from "@/server/automation/providers";
import type { AutomationProvider } from "@/server/automation/providers";
import type {
  AutomationWebhookPayload,
  DispatchResult,
} from "@/server/automation/types";

/**
 * Cola persistida en PostgreSQL. No depende de memoria local ni de procesos
 * encendidos permanentemente: cada corrida es un lote acotado, con locking
 * atómico para que dos procesos no ejecuten el mismo evento.
 */

/** Recupera eventos que quedaron colgados en PROCESSING (callback nunca llegó). */
async function reclaimStaleProcessing(now: Date): Promise<number> {
  const threshold = new Date(now.getTime() - PROCESSING_STALE_MS);
  const stale = await prisma.automationEvent.findMany({
    where: { status: "PROCESSING", lockedAt: { lt: threshold } },
    select: { id: true, attempts: true, maxAttempts: true },
  });

  let reclaimed = 0;
  for (const event of stale) {
    const decision = decideStaleProcessing({
      attempts: event.attempts,
      maxAttempts: event.maxAttempts,
      now,
    });
    const updated = await prisma.automationEvent.updateMany({
      where: { id: event.id, status: "PROCESSING" },
      data: {
        status: decision.status,
        nextAttemptAt: decision.nextAttemptAt,
        processedAt: decision.processedAt,
        lastError: decision.lastError,
        lockedAt: null,
      },
    });
    if (updated.count === 1) reclaimed++;
  }
  return reclaimed;
}

async function processOneEvent(
  eventId: string,
  provider: AutomationProvider
): Promise<boolean> {
  const lockedAt = new Date();
  // Lock atómico: solo lo toma quien logra pasar PENDING -> PROCESSING.
  const locked = await prisma.automationEvent.updateMany({
    where: { id: eventId, status: "PENDING" },
    data: { status: "PROCESSING", lockedAt, attempts: { increment: 1 } },
  });
  if (locked.count !== 1) return false;

  const event = await prisma.automationEvent.findUnique({ where: { id: eventId } });
  if (!event) return false;

  const startedAt = new Date();
  let result: DispatchResult;
  try {
    const webhook: AutomationWebhookPayload = {
      eventId: event.id,
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
    await tx.automationRun.create({
      data: {
        organizationId: event.organizationId,
        automationEventId: event.id,
        provider: provider.name,
        status: result.ok
          ? result.awaitingCallback
            ? "STARTED"
            : "SUCCEEDED"
          : "FAILED",
        attempt: event.attempts,
        externalExecutionId: result.ok ? result.externalExecutionId ?? null : null,
        startedAt,
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
    await tx.automationEvent.updateMany({
      where: { id: event.id, status: "PROCESSING" },
      data: {
        status: decision.status,
        attempts: decision.attempts,
        nextAttemptAt: decision.nextAttemptAt,
        processedAt: decision.processedAt,
        lastError: decision.lastError,
        lockedAt: decision.clearLock ? null : lockedAt,
      },
    });
  });
  return true;
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
    if (await processOneEvent(id, provider)) processed++;
  }
  return { processed, reclaimed };
}
