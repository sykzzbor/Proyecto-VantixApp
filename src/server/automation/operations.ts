import type { AutomationEventStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

export type AutomationOperationResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "conflict"; message: string };

type AutomationOperationInput = {
  id: string;
  organizationId: string;
  userId: string;
};

export type AutomationOperationDeps = {
  findStatus(input: AutomationOperationInput): Promise<AutomationEventStatus | null>;
  transitionAndAudit(
    kind: "retry" | "cancel",
    input: AutomationOperationInput
  ): Promise<boolean>;
};

export function canRetryAutomationStatus(status: AutomationEventStatus) {
  return status === "FAILED" || status === "DEAD_LETTER";
}

export function canCancelAutomationStatus(status: AutomationEventStatus) {
  return status === "PENDING";
}

export function buildRetryTransitionWhere(id: string, organizationId: string) {
  return {
    id,
    organizationId,
    status: { in: ["FAILED", "DEAD_LETTER"] as AutomationEventStatus[] },
  };
}

export function buildCancelTransitionWhere(id: string, organizationId: string) {
  return { id, organizationId, status: "PENDING" as const };
}

const defaultDeps: AutomationOperationDeps = {
  async findStatus(input) {
    const event = await prisma.automationEvent.findFirst({
      where: { id: input.id, organizationId: input.organizationId },
      select: { status: true },
    });
    return event?.status ?? null;
  },
  async transitionAndAudit(kind, input) {
    return prisma.$transaction(async (tx) => {
      const transition =
        kind === "retry"
          ? await tx.automationEvent.updateMany({
              where: buildRetryTransitionWhere(input.id, input.organizationId),
              data: {
                status: "PENDING",
                attempts: 0,
                nextAttemptAt: new Date(),
                lockedAt: null,
                processedAt: null,
                lastError: null,
              },
            })
          : await tx.automationEvent.updateMany({
              where: buildCancelTransitionWhere(input.id, input.organizationId),
              data: {
                status: "CANCELLED",
                nextAttemptAt: null,
                lockedAt: null,
                processedAt: new Date(),
                lastError: null,
              },
            });
      if (transition.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          action:
            kind === "retry"
              ? "automation.event_retried"
              : "automation.event_cancelled",
          entityType: "automation_event",
          entityId: input.id,
        },
      });
      return true;
    });
  },
};

export async function performAutomationOperation(
  kind: "retry" | "cancel",
  input: AutomationOperationInput,
  deps: AutomationOperationDeps = defaultDeps
): Promise<AutomationOperationResult> {
  const status = await deps.findStatus(input);
  if (!status) {
    return { ok: false, code: "not_found", message: "El evento no existe." };
  }
  const allowed =
    kind === "retry"
      ? canRetryAutomationStatus(status)
      : canCancelAutomationStatus(status);
  if (!allowed) {
    return {
      ok: false,
      code: "conflict",
      message:
        kind === "retry"
          ? "El evento ya no se puede reintentar."
          : "Solo se pueden cancelar eventos pendientes.",
    };
  }
  const updated = await deps.transitionAndAudit(kind, input);
  return updated
    ? { ok: true }
    : { ok: false, code: "conflict", message: "El evento cambió de estado." };
}

export function retryAutomationEvent(input: AutomationOperationInput) {
  return performAutomationOperation("retry", input);
}

export function cancelAutomationEvent(input: AutomationOperationInput) {
  return performAutomationOperation("cancel", input);
}
