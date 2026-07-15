import { Prisma } from "@/generated/prisma/client";
import type { AutomationEventStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { CallbackInput, CallbackStatus } from "@/server/automation/types";
import {
  sanitizeAutomationMessage,
  sanitizeAutomationValue,
} from "@/server/automation/sanitization";
import { getN8nConfigurationFingerprint } from "@/server/automation/config";
import {
  getN8nConnectionProbeFingerprint,
  isN8nConnectionProbeEvent,
} from "@/server/automation/providers/n8n";

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

export function isCurrentAutomationCallback(input: {
  runStatus: AutomationRunStatusLike;
  eventStatus: AutomationEventStatus;
  runAttempt: number;
  eventAttempts: number;
}) {
  return (
    input.runStatus === "STARTED" &&
    input.eventStatus === "PROCESSING" &&
    input.runAttempt === input.eventAttempts
  );
}

type AutomationRunStatusLike = "STARTED" | "SUCCEEDED" | "FAILED";

export function canAcceptSuccessfulAutomationCallback(input: {
  eventType: string;
  actionDeliveryStatus: string | null;
  actionCompletedAt?: Date | null;
  handoffDeliveryStatuses?: string[];
}) {
  if (input.eventType === "conversation.followup_due") {
    return ["SENT", "DELIVERED", "READ"].includes(
      input.actionDeliveryStatus ?? ""
    );
  }
  if (input.eventType === "conversation.handoff_requested") {
    const deliveries = input.handoffDeliveryStatuses ?? [];
    return (
      input.actionCompletedAt instanceof Date &&
      deliveries.length > 0 &&
      deliveries.every((status) => status === "SENT")
    );
  }
  return true;
}

export type ApplyCallbackResult =
  | { ok: true; applied: boolean; status: AutomationEventStatus }
  | {
      ok: false;
      code: "not_found" | "stale_attempt" | "action_incomplete";
    };

async function recordCallbackTelemetry(input: {
  organizationId: string;
  now: Date;
  errorCode?: string | null;
  recordOutcome: boolean;
}) {
  try {
    const safeError = sanitizeAutomationMessage(input.errorCode, 120);
    await prisma.integrationConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: "n8n",
        },
      },
      create: {
        organizationId: input.organizationId,
        provider: "n8n",
        status: "DISCONNECTED",
        enabled: false,
        lastCallbackAt: input.now,
        lastError: input.recordOutcome ? safeError : null,
      },
      update: {
        lastCallbackAt: input.now,
        ...(input.recordOutcome ? { lastError: safeError } : {}),
      },
    });
  } catch {
    // La telemetría no puede cambiar el resultado de un callback ya validado.
  }
}

/**
 * Aplica el resultado del callback de n8n. Idempotente y aislado por
 * organización: el evento se busca SIEMPRE con organizationId.
 */
export async function applyAutomationCallback(
  input: CallbackInput
): Promise<ApplyCallbackResult> {
  const run = await prisma.automationRun.findFirst({
    where: {
      id: input.runId,
      organizationId: input.organizationId,
      automationEventId: input.eventId,
    },
    select: {
      id: true,
      provider: true,
      status: true,
      attempt: true,
      startedAt: true,
      externalExecutionId: true,
      automationEvent: {
        select: {
          id: true,
          status: true,
          attempts: true,
          type: true,
          payload: true,
          conversationId: true,
          actionCompletedAt: true,
          actionMessage: {
            select: {
              organizationId: true,
              conversationId: true,
              deliveryStatus: true,
            },
          },
          actionDeliveries: {
            where: { organizationId: input.organizationId },
            select: { status: true },
          },
        },
      },
    },
  });
  if (!run) return { ok: false, code: "not_found" };
  // Un secreto de callback nunca puede cerrar ejecuciones del proveedor mock.
  if (run.provider !== "n8n") {
    return { ok: false, code: "stale_attempt" };
  }

  const now = new Date();
  const event = run.automationEvent;
  const connectionProbe = isN8nConnectionProbeEvent(event);
  const probeFingerprint = getN8nConnectionProbeFingerprint(event);
  const currentConfigurationFingerprint = getN8nConfigurationFingerprint();
  const probeConfigurationMatches =
    !!probeFingerprint &&
    probeFingerprint === currentConfigurationFingerprint;
  const probeConnectionSucceeded =
    connectionProbe &&
    input.status === "succeeded" &&
    probeConfigurationMatches;
  const probeConnectionErrorCode =
    input.status === "succeeded" && !probeConfigurationMatches
      ? "configuration_changed"
      : input.errorCode ?? "connection_probe_failed";
  const effectiveStatus: CallbackStatus =
    connectionProbe &&
    input.status === "succeeded" &&
    !probeConfigurationMatches
      ? "failed"
      : input.status;
  const transition = resolveCallbackTransition(event.status, effectiveStatus);

  // Un callback duplicado del mismo run es idempotente. Nunca busca "el run
  // más reciente", porque eso permitiría que un intento viejo cierre uno nuevo.
  if (run.status !== "STARTED") {
    await recordCallbackTelemetry({
      organizationId: input.organizationId,
      now,
      errorCode: input.status === "failed" ? input.errorCode : null,
      recordOutcome: false,
    });
    return { ok: true, applied: false, status: event.status };
  }

  if (
    !isCurrentAutomationCallback({
      runStatus: run.status,
      eventStatus: event.status,
      runAttempt: run.attempt,
      eventAttempts: event.attempts,
    }) ||
    !transition.apply
  ) {
    await prisma.automationRun.updateMany({
      where: {
        id: run.id,
        organizationId: input.organizationId,
        automationEventId: event.id,
        status: "STARTED",
      },
      data: {
        status: "FAILED",
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - run.startedAt.getTime()),
        errorCode: "stale_callback",
        errorMessage: "El callback pertenece a un intento que ya no está activo.",
      },
    });
    await recordCallbackTelemetry({
      organizationId: input.organizationId,
      now,
      errorCode: "stale_callback",
      recordOutcome: false,
    });
    return { ok: false, code: "stale_attempt" };
  }

  if (
    input.status === "succeeded" &&
    !canAcceptSuccessfulAutomationCallback({
      eventType: event.type,
      actionDeliveryStatus:
        event.actionMessage?.organizationId === input.organizationId &&
        event.actionMessage.conversationId === event.conversationId
          ? event.actionMessage.deliveryStatus
          : null,
      actionCompletedAt: event.actionCompletedAt,
      handoffDeliveryStatuses: event.actionDeliveries.map(
        (delivery) => delivery.status
      ),
    })
  ) {
    const actionErrorCode =
      event.type === "conversation.handoff_requested"
        ? "handoff_action_incomplete"
        : "followup_action_incomplete";
    await recordCallbackTelemetry({
      organizationId: input.organizationId,
      now,
      errorCode: actionErrorCode,
      recordOutcome: true,
    });
    return { ok: false, code: "action_incomplete" };
  }

  const application = await prisma.$transaction(async (tx) => {
    // Guardas de concurrencia: evento, organización, intento y run exactos.
    const updated = await tx.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: input.organizationId,
        status: "PROCESSING",
        attempts: run.attempt,
        ...(input.status === "succeeded" &&
        event.type === "conversation.handoff_requested"
          ? {
              actionCompletedAt: event.actionCompletedAt,
              actionDeliveries: {
                some: {
                  organizationId: input.organizationId,
                  status: "SENT" as const,
                },
                none: {
                  organizationId: input.organizationId,
                  status: { not: "SENT" as const },
                },
              },
            }
          : {}),
      },
      data: {
        status: transition.newStatus,
        processedAt: now,
        lockedAt: null,
        lastError:
          effectiveStatus === "failed"
            ? sanitizeAutomationMessage(
                connectionProbe
                  ? probeConnectionErrorCode
                  : input.errorCode ?? "callback_failed",
                120
              )
            : null,
      },
    });
    if (updated.count !== 1) return { applied: false };

    const updatedRun = await tx.automationRun.updateMany({
      where: {
        id: run.id,
        organizationId: input.organizationId,
        automationEventId: event.id,
        attempt: run.attempt,
        status: "STARTED",
      },
      data: {
        status: transition.newStatus === "SUCCEEDED" ? "SUCCEEDED" : "FAILED",
        finishedAt: now,
        durationMs: Math.max(0, now.getTime() - run.startedAt.getTime()),
        externalExecutionId:
          input.externalExecutionId ?? run.externalExecutionId,
        errorCode:
          effectiveStatus === "failed"
            ? sanitizeAutomationMessage(
                connectionProbe
                  ? probeConnectionErrorCode
                  : input.errorCode ?? "callback_failed",
                120
              )
            : null,
        errorMessage:
          effectiveStatus === "failed"
            ? sanitizeAutomationMessage(
                connectionProbe && input.status === "succeeded"
                  ? "La configuración cambió durante la prueba."
                  : input.errorMessage
              )
            : null,
        responseMeta: input.responseMeta
          ? (sanitizeAutomationValue(input.responseMeta) as Prisma.InputJsonValue)
          : undefined,
      },
    });
    if (updatedRun.count !== 1) {
      throw new Error("callback_run_conflict");
    }
    if (connectionProbe) {
      if (probeConfigurationMatches) {
        const latestEquivalentProbe = await tx.automationEvent.findFirst({
          where: {
            organizationId: input.organizationId,
            type: "automation.test",
            AND: [
              {
                payload: { path: ["source"], equals: "connection-test" },
              },
              {
                payload: {
                  path: ["configurationFingerprint"],
                  equals: probeFingerprint,
                },
              },
            ],
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        });
        if (latestEquivalentProbe?.id === event.id) {
          const probeSucceeded = probeConnectionSucceeded;
          await tx.integrationConnection.upsert({
            where: {
              organizationId_provider: {
                organizationId: input.organizationId,
                provider: "n8n",
              },
            },
            create: {
              organizationId: input.organizationId,
              provider: "n8n",
              status: probeSucceeded ? "CONNECTED" : "ERROR",
              enabled: probeSucceeded,
              externalId: probeSucceeded ? probeFingerprint : null,
              lastCallbackAt: now,
              lastError: probeSucceeded
                ? null
                : sanitizeAutomationMessage(probeConnectionErrorCode, 120),
            },
            update: {
              status: probeSucceeded ? "CONNECTED" : "ERROR",
              enabled: probeSucceeded,
              externalId: probeSucceeded ? probeFingerprint : null,
              lastCallbackAt: now,
              lastError: probeSucceeded
                ? null
                : sanitizeAutomationMessage(probeConnectionErrorCode, 120),
            },
          });
        }
      } else {
        const safeProbeError =
          sanitizeAutomationMessage(probeConnectionErrorCode, 120) ??
          "configuration_changed";
        // Si no existe conexión aún, el callback obsoleto deja un diagnóstico
        // útil. Si una prueba nueva ya verificó la configuración actual, el
        // UPDATE condicional no puede degradarla aunque los callbacks se crucen.
        await tx.integrationConnection.createMany({
          data: [
            {
              organizationId: input.organizationId,
              provider: "n8n",
              status: "ERROR",
              enabled: false,
              externalId: null,
              lastCallbackAt: now,
              lastError: safeProbeError,
            },
          ],
          skipDuplicates: true,
        });
        await tx.integrationConnection.updateMany({
          where: {
            organizationId: input.organizationId,
            provider: "n8n",
            OR: [
              { enabled: false },
              { status: { not: "CONNECTED" } },
              { externalId: null },
              {
                externalId: {
                  not: currentConfigurationFingerprint ?? "",
                },
              },
            ],
          },
          data: {
            status: "ERROR",
            enabled: false,
            externalId: null,
            lastCallbackAt: now,
            lastError: safeProbeError,
          },
        });
      }
    }
    return { applied: true };
  });
  const { applied } = application;

  await recordCallbackTelemetry({
    organizationId: input.organizationId,
    now,
    errorCode:
      connectionProbe && !probeConnectionSucceeded
        ? probeConnectionErrorCode
        : input.status === "failed"
          ? input.errorCode
          : null,
    recordOutcome: connectionProbe ? false : applied,
  });

  const currentStatus = applied
    ? transition.newStatus
    : (
        await prisma.automationEvent.findFirst({
          where: { id: event.id, organizationId: input.organizationId },
          select: { status: true },
        })
      )?.status ?? event.status;

  return {
    ok: true,
    applied,
    status: currentStatus,
  };
}
