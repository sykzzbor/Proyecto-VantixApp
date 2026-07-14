import { Prisma } from "@/generated/prisma/client";
import type { AutomationEventStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { CallbackInput, CallbackStatus } from "@/server/automation/types";

const TERMINAL_STATUSES: AutomationEventStatus[] = [
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
  "CANCELLED",
];

/**
 * Decisión pura de idempotencia/estado del callback: si el evento ya está en
 * un estado terminal no se re-aplica (callback duplicado). No confía en el
 * estado enviado: solo mapea `succeeded`/`failed` a estados válidos.
 */
export function resolveCallbackTransition(
  currentStatus: AutomationEventStatus,
  callbackStatus: CallbackStatus
): { apply: boolean; newStatus: AutomationEventStatus } {
  if (TERMINAL_STATUSES.includes(currentStatus)) {
    return { apply: false, newStatus: currentStatus };
  }
  return {
    apply: true,
    newStatus: callbackStatus === "succeeded" ? "SUCCEEDED" : "FAILED",
  };
}

function sanitizeMessage(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 500);
}

export type ApplyCallbackResult =
  | { ok: true; applied: boolean; status: AutomationEventStatus }
  | { ok: false; code: "not_found" };

/**
 * Aplica el resultado del callback de n8n. Idempotente y aislado por
 * organización: el evento se busca SIEMPRE con organizationId.
 */
export async function applyAutomationCallback(
  input: CallbackInput
): Promise<ApplyCallbackResult> {
  const event = await prisma.automationEvent.findFirst({
    where: { id: input.eventId, organizationId: input.organizationId },
    select: { id: true, status: true },
  });
  if (!event) return { ok: false, code: "not_found" };

  const transition = resolveCallbackTransition(event.status, input.status);
  if (!transition.apply) {
    return { ok: true, applied: false, status: event.status };
  }

  const now = new Date();
  const applied = await prisma.$transaction(async (tx) => {
    // Guarda de concurrencia: solo finaliza desde estados no terminales.
    const updated = await tx.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: input.organizationId,
        status: { in: ["PENDING", "PROCESSING"] },
      },
      data: {
        status: transition.newStatus,
        processedAt: now,
        lockedAt: null,
        lastError:
          input.status === "failed" ? input.errorCode ?? "callback_failed" : null,
      },
    });
    if (updated.count !== 1) return false;

    const lastRun = await tx.automationRun.findFirst({
      where: { automationEventId: event.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, startedAt: true, externalExecutionId: true },
    });
    if (lastRun) {
      await tx.automationRun.update({
        where: { id: lastRun.id },
        data: {
          status: transition.newStatus === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
          finishedAt: now,
          durationMs: now.getTime() - lastRun.startedAt.getTime(),
          externalExecutionId:
            input.externalExecutionId ?? lastRun.externalExecutionId,
          errorCode: input.status === "failed" ? input.errorCode ?? "callback_failed" : null,
          errorMessage:
            input.status === "failed" ? sanitizeMessage(input.errorMessage) : null,
          responseMeta: input.responseMeta
            ? (input.responseMeta as Prisma.InputJsonValue)
            : undefined,
        },
      });
    }
    return true;
  });

  return { ok: true, applied, status: transition.newStatus };
}
