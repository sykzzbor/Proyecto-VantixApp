import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { completeHandoffRuleConfigSchema } from "@/lib/validations/automation-rules";
import { recordAudit } from "@/server/audit";
import { getAutomationProviderMode } from "@/server/automation/config";
import { getCredentialsEncryptionKey } from "@/server/whatsapp/config";
import {
  CredentialsEncryptionError,
  decryptAccessToken,
} from "@/server/whatsapp/crypto";
import {
  MetaApiError,
  sendWhatsappTemplateMessage,
} from "@/server/whatsapp/meta-client";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";

export const HANDOFF_ALERT_EVENT_TYPE = "conversation.handoff_requested";

type HandoffAlertActionInput = {
  eventId: string;
  organizationId: string;
};

type TemplateSender = typeof sendWhatsappTemplateMessage;

export type HandoffAlertActionDependencies = {
  now?: () => Date;
  sendTemplate?: TemplateSender;
  decryptToken?: typeof decryptAccessToken;
  getRecipientHashSecret?: typeof getCredentialsEncryptionKey;
  getProviderMode?: typeof getAutomationProviderMode;
  /** Punto de sincronización exclusivo de pruebas de concurrencia. */
  afterClaim?: () => Promise<void>;
};

export type HandoffAlertActionResult =
  | {
      ok: true;
      state: "success" | "already_sent";
      duplicate: boolean;
      sentCount: number;
      callbackRequired: true;
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
        | "invalid_recipients"
        | "template_missing"
        | "channel_unavailable"
        | "send_failed"
        | "internal_error";
      message: string;
      retryable: boolean;
    };

type DeliverySnapshot = {
  status: "PROCESSING" | "SENT" | "FAILED";
};

export function resolveExistingHandoffAlertAction(input: {
  actionClaimedAt: Date | null;
  deliveries: DeliverySnapshot[];
}): "ready" | "already_sent" | "failed" | "in_progress" {
  if (input.deliveries.length > 0) {
    if (input.deliveries.every((delivery) => delivery.status === "SENT")) {
      return "already_sent";
    }
    if (input.deliveries.some((delivery) => delivery.status === "FAILED")) {
      return "failed";
    }
    return "in_progress";
  }
  return input.actionClaimedAt ? "in_progress" : "ready";
}

/**
 * Hash tenant/event-scoped para el ledger. El número nunca se persiste fuera
 * de la configuración de la regla y no puede correlacionarse entre eventos.
 */
export function handoffAlertRecipientHash(input: {
  eventId: string;
  phoneNumber: string;
  secret: string;
}) {
  return createHmac("sha256", input.secret)
    .update(`vantix:handoff-alert:v1:${input.eventId}:${input.phoneNumber}`)
    .digest("hex");
}

function notExecutable(
  code:
    | "not_executable"
    | "invalid_recipients"
    | "template_missing"
    | "channel_unavailable",
  message: string
): HandoffAlertActionResult {
  return { ok: false, code, message, retryable: false };
}

function safeDeliveryError(error: unknown) {
  if (error instanceof MetaApiError) {
    return {
      code: `meta_${error.code}`.slice(0, 120),
      message: error.safeMessage.slice(0, 240),
    };
  }
  if (error instanceof CredentialsEncryptionError) {
    return {
      code: "whatsapp_credentials_unavailable",
      message: "No se pudieron usar las credenciales de WhatsApp.",
    };
  }
  return {
    code: "handoff_delivery_failed",
    message: "No se pudo enviar la alerta de derivación.",
  };
}

async function auditBestEffort(
  input: Parameters<typeof recordAudit>[0]
): Promise<void> {
  await recordAudit(input);
}

type ClaimedDelivery = {
  id: string;
  phoneNumber: string;
};

type ClaimResult =
  | { kind: "result"; result: HandoffAlertActionResult }
  | {
      kind: "claimed";
      eventId: string;
      organizationId: string;
      phoneNumberId: string;
      encryptedAccessToken: string;
      templateName: string;
      templateLanguage: string;
      deliveries: ClaimedDelivery[];
    };

async function claimHandoffAlertAction(
  input: HandoffAlertActionInput,
  now: Date,
  getRecipientHashSecret: typeof getCredentialsEncryptionKey
): Promise<ClaimResult> {
  return prisma.$transaction(async (tx) => {
    const event = await tx.automationEvent.findFirst({
      where: {
        id: input.eventId,
        organizationId: input.organizationId,
      },
      select: {
        id: true,
        organizationId: true,
        automationRuleId: true,
        conversationId: true,
        type: true,
        status: true,
        attempts: true,
        actionClaimedAt: true,
        actionCompletedAt: true,
        actionDeliveries: {
          where: { organizationId: input.organizationId },
          select: { status: true },
        },
        runs: {
          where: { organizationId: input.organizationId, status: "STARTED" },
          orderBy: { attempt: "desc" },
          take: 1,
          select: { attempt: true, provider: true },
        },
      },
    });
    if (!event) {
      return {
        kind: "result",
        result: {
          ok: false,
          code: "not_found",
          message: "No se encontró la acción solicitada.",
          retryable: false,
        },
      };
    }
    if (event.type !== HANDOFF_ALERT_EVENT_TYPE) {
      return {
        kind: "result",
        result: notExecutable(
          "not_executable",
          "El evento no admite esta acción."
        ),
      };
    }

    const existing = resolveExistingHandoffAlertAction({
      actionClaimedAt: event.actionClaimedAt,
      deliveries: event.actionDeliveries,
    });
    if (existing === "already_sent") {
      if (!event.actionCompletedAt) {
        await tx.automationEvent.updateMany({
          where: {
            id: event.id,
            organizationId: event.organizationId,
            actionCompletedAt: null,
          },
          data: { actionCompletedAt: now },
        });
      }
      return {
        kind: "result",
        result: {
          ok: true,
          state: "already_sent",
          duplicate: true,
          sentCount: event.actionDeliveries.length,
          callbackRequired: true,
        },
      };
    }
    if (existing === "failed") {
      return {
        kind: "result",
        result: {
          ok: false,
          code: "send_failed",
          message: "La alerta no pudo completarse y no se reenviará automáticamente.",
          retryable: false,
        },
      };
    }
    if (existing === "in_progress") {
      return {
        kind: "result",
        result: {
          ok: true,
          state: "in_progress",
          duplicate: true,
          callbackRequired: false,
        },
      };
    }

    if (
      event.status !== "PROCESSING" ||
      !event.conversationId ||
      event.runs[0]?.attempt !== event.attempts ||
      event.runs[0]?.provider !== "n8n"
    ) {
      return {
        kind: "result",
        result: notExecutable(
          "not_executable",
          "El evento ya no está en un estado ejecutable."
        ),
      };
    }

    const rule = await tx.organizationAutomationRule.findUnique({
      where: {
        organizationId_type: {
          organizationId: input.organizationId,
          type: "HANDOFF_ALERT",
        },
      },
      select: { id: true, enabled: true, config: true },
    });
    if (
      !rule ||
      !rule.enabled ||
      event.automationRuleId !== rule.id
    ) {
      return {
        kind: "result",
        result: notExecutable(
          "not_executable",
          "La regla ya no está activa para este evento."
        ),
      };
    }

    const draft = completeHandoffRuleConfigSchema.safeParse(rule.config);
    if (!draft.success) {
      const parsedDraft = rule.config as Record<string, unknown> | null;
      const numbers = Array.isArray(parsedDraft?.phoneNumbers)
        ? parsedDraft.phoneNumbers
        : [];
      const templateName =
        typeof parsedDraft?.templateName === "string"
          ? parsedDraft.templateName.trim()
          : "";
      return {
        kind: "result",
        result: !templateName
          ? notExecutable(
              "template_missing",
              "La plantilla aprobada no está configurada."
            )
          : notExecutable(
              "invalid_recipients",
              numbers.length === 0
                ? "No hay destinatarios válidos configurados."
                : "La configuración de destinatarios no es válida."
            ),
      };
    }
    const config = draft.data;

    const conversation = await tx.conversation.findFirst({
      where: {
        id: event.conversationId,
        organizationId: input.organizationId,
        status: { not: "CLOSED" },
        handlingMode: "HUMAN",
      },
      select: { id: true, whatsappIntegrationId: true },
    });
    if (!conversation) {
      return {
        kind: "result",
        result: notExecutable(
          "not_executable",
          "La derivación ya no está activa."
        ),
      };
    }

    const integrations = await tx.whatsappIntegration.findMany({
      where: {
        organizationId: input.organizationId,
        status: "CONNECTED",
        provider: "META_CLOUD",
        ...(conversation.whatsappIntegrationId
          ? { id: conversation.whatsappIntegrationId }
          : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: conversation.whatsappIntegrationId ? 1 : 2,
      select: {
        phoneNumberId: true,
        encryptedAccessToken: true,
      },
    });
    // Una conversación vinculada debe usar exactamente esa integración. Sin
    // vínculo solo se permite el fallback si la organización tiene una única
    // conexión activa; ante ambigüedad se falla cerrado.
    const integration =
      conversation.whatsappIntegrationId || integrations.length === 1
        ? integrations[0]
        : null;
    if (!integration) {
      return {
        kind: "result",
        result: notExecutable(
          "channel_unavailable",
          "WhatsApp no está disponible para enviar la alerta."
        ),
      };
    }

    let hashSecret: string;
    try {
      hashSecret = getRecipientHashSecret();
    } catch {
      return {
        kind: "result",
        result: notExecutable(
          "channel_unavailable",
          "WhatsApp no está disponible para enviar la alerta."
        ),
      };
    }
    const deliveries = config.phoneNumbers.map((phoneNumber) => ({
      id: randomUUID(),
      phoneNumber,
      recipientHash: handoffAlertRecipientHash({
        eventId: event.id,
        phoneNumber,
        secret: hashSecret,
      }),
    }));

    const claimed = await tx.automationEvent.updateMany({
      where: {
        id: event.id,
        organizationId: event.organizationId,
        type: HANDOFF_ALERT_EVENT_TYPE,
        status: "PROCESSING",
        attempts: event.attempts,
        actionClaimedAt: null,
      },
      // El claim inicia un nuevo tramo de trabajo externo. Renovar el lock evita
      // que el reclaimer stale terminalice el evento mientras Meta está enviando.
      data: { actionClaimedAt: now, lockedAt: now },
    });
    if (claimed.count !== 1) {
      return {
        kind: "result",
        result: {
          ok: true,
          state: "in_progress",
          duplicate: true,
          callbackRequired: false,
        },
      };
    }

    await tx.automationActionDelivery.createMany({
      data: deliveries.map((delivery) => ({
        id: delivery.id,
        organizationId: event.organizationId,
        eventId: event.id,
        recipientHash: delivery.recipientHash,
        status: "PROCESSING",
        templateName: config.templateName,
        templateLanguage: config.templateLanguage,
        processingStartedAt: now,
        updatedAt: now,
      })),
    });

    return {
      kind: "claimed",
      eventId: event.id,
      organizationId: event.organizationId,
      phoneNumberId: integration.phoneNumberId,
      encryptedAccessToken: integration.encryptedAccessToken,
      templateName: config.templateName,
      templateLanguage: config.templateLanguage,
      deliveries: deliveries.map(({ id, phoneNumber }) => ({ id, phoneNumber })),
    };
  });
}

export async function executeHandoffAlertAction(
  input: HandoffAlertActionInput,
  dependencies: HandoffAlertActionDependencies = {}
): Promise<HandoffAlertActionResult> {
  const now = (dependencies.now ?? (() => new Date()))();
  const sendTemplate = dependencies.sendTemplate ?? sendWhatsappTemplateMessage;
  const decryptToken = dependencies.decryptToken ?? decryptAccessToken;
  const getRecipientHashSecret =
    dependencies.getRecipientHashSecret ?? getCredentialsEncryptionKey;
  const getProviderMode =
    dependencies.getProviderMode ?? getAutomationProviderMode;

  // Defensa adicional mientras la integración permanece en mock: conocer el
  // HMAC nunca alcanza para habilitar por sí solo un side effect en Meta.
  if (getProviderMode() !== "n8n") {
    return notExecutable(
      "not_executable",
      "El proveedor de automatización no está habilitado para esta acción."
    );
  }

  const entitlement = await getOrganizationEntitlement(input.organizationId);
  if (!entitlement.accessAllowed) {
    return notExecutable(
      "not_executable",
      "La suscripción de la organización no permite ejecutar esta acción."
    );
  }

  let claim: ClaimResult;
  try {
    claim = await claimHandoffAlertAction(
      input,
      now,
      getRecipientHashSecret
    );
  } catch {
    return {
      ok: false,
      code: "internal_error",
      message: "No se pudo preparar el envío de la alerta.",
      retryable: false,
    };
  }
  if (claim.kind === "result") return claim.result;

  await dependencies.afterClaim?.();

  let accessToken: string;
  try {
    accessToken = decryptToken(claim.encryptedAccessToken);
  } catch (error) {
    const safeError = safeDeliveryError(error);
    let failurePersisted = true;
    try {
      await prisma.$transaction([
        prisma.automationActionDelivery.updateMany({
          where: {
            organizationId: claim.organizationId,
            eventId: claim.eventId,
            status: "PROCESSING",
          },
          data: {
            status: "FAILED",
            errorCode: safeError.code,
            errorMessage: safeError.message,
            completedAt: now,
          },
        }),
        prisma.automationEvent.updateMany({
          where: {
            id: claim.eventId,
            organizationId: claim.organizationId,
            status: "PROCESSING",
            actionClaimedAt: { not: null },
          },
          data: { actionCompletedAt: now },
        }),
      ]);
    } catch {
      failurePersisted = false;
    }
    await auditBestEffort({
      organizationId: claim.organizationId,
      action: "automation.handoff_alert_failed",
      entityType: "automation_event",
      entityId: claim.eventId,
      details: {
        recipientCount: claim.deliveries.length,
        templateName: claim.templateName,
        templateLanguage: claim.templateLanguage,
        errorCode: safeError.code,
      },
    });
    if (!failurePersisted) {
      return {
        ok: false,
        code: "internal_error",
        message: "No se pudo confirmar el estado de la alerta.",
        retryable: false,
      };
    }
    return {
      ok: false,
      code: "send_failed",
      message: safeError.message,
      retryable: false,
    };
  }

  // El máximo validado es 10. Ejecutarlas en paralelo mantiene la acción por
  // debajo del timeout aunque Meta demore su máximo por destinatario.
  const outcomes = await Promise.all(
    claim.deliveries.map(async (delivery) => {
      try {
        const sent = await sendTemplate({
          phoneNumberId: claim.phoneNumberId,
          accessToken,
          to: delivery.phoneNumber,
          templateName: claim.templateName,
          language: claim.templateLanguage,
        });
        return {
          deliveryId: delivery.id,
          status: "SENT" as const,
          externalMessageId: sent.messageId.slice(0, 255),
        };
      } catch (error) {
        return {
          deliveryId: delivery.id,
          status: "FAILED" as const,
          error: safeDeliveryError(error),
        };
      }
    })
  );
  const sentCount = outcomes.filter((outcome) => outcome.status === "SENT").length;
  const firstFailure = outcomes.find((outcome) => outcome.status === "FAILED");
  const completedAt = new Date();
  try {
    const updates = outcomes.map((outcome) =>
      prisma.automationActionDelivery.updateMany({
        where: {
          id: outcome.deliveryId,
          organizationId: claim.organizationId,
          eventId: claim.eventId,
          status: "PROCESSING",
        },
        data:
          outcome.status === "SENT"
            ? {
                status: "SENT" as const,
                externalMessageId: outcome.externalMessageId,
                completedAt,
                errorCode: null,
                errorMessage: null,
              }
            : {
                status: "FAILED" as const,
                completedAt,
                errorCode: outcome.error.code,
                errorMessage: outcome.error.message,
              },
      })
    );
    const persisted = await prisma.$transaction([
      ...updates,
      prisma.automationEvent.updateMany({
        where: {
          id: claim.eventId,
          organizationId: claim.organizationId,
          status: "PROCESSING",
          actionClaimedAt: { not: null },
        },
        data: { actionCompletedAt: completedAt },
      }),
    ]);
    if (persisted.some((result) => result.count !== 1)) {
      throw new Error("handoff_delivery_persistence_conflict");
    }
  } catch {
    await auditBestEffort({
      organizationId: claim.organizationId,
      action: "automation.handoff_alert_failed",
      entityType: "automation_event",
      entityId: claim.eventId,
      details: {
        recipientCount: claim.deliveries.length,
        sentCount,
        templateName: claim.templateName,
        templateLanguage: claim.templateLanguage,
        errorCode: "delivery_state_unconfirmed",
      },
    });
    return {
      ok: false,
      code: "internal_error",
      message: "No se pudo confirmar el estado de la alerta.",
      retryable: false,
    };
  }
  if (firstFailure) {
    await auditBestEffort({
      organizationId: claim.organizationId,
      action: "automation.handoff_alert_failed",
      entityType: "automation_event",
      entityId: claim.eventId,
      details: {
        recipientCount: claim.deliveries.length,
        sentCount,
        templateName: claim.templateName,
        templateLanguage: claim.templateLanguage,
        errorCode: firstFailure.error.code,
      },
    });
    return {
      ok: false,
      code: "send_failed",
      message: firstFailure.error.message,
      retryable: false,
    };
  }
  await auditBestEffort({
    organizationId: claim.organizationId,
    action: "automation.handoff_alert_sent",
    entityType: "automation_event",
    entityId: claim.eventId,
    details: {
      recipientCount: sentCount,
      templateName: claim.templateName,
      templateLanguage: claim.templateLanguage,
    },
  });
  return {
    ok: true,
    state: "success",
    duplicate: false,
    sentCount,
    callbackRequired: true,
  };
}
