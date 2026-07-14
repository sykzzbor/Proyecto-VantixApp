import type { Message, SenderType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { scheduleFollowUpAfterOutbound } from "@/server/automation/follow-up";
import { saveMessage } from "@/server/conversations";
import {
  CredentialsEncryptionError,
  decryptAccessToken,
} from "@/server/whatsapp/crypto";
import {
  MetaApiError,
  sendWhatsappTextMessage,
} from "@/server/whatsapp/meta-client";

export class WhatsappOutboundValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsappOutboundValidationError";
  }
}

export type WhatsappOutboundResult =
  | { ok: true; message: Message }
  | { ok: false; error: string; message?: Message };

function safeFailure(error: unknown) {
  if (error instanceof MetaApiError) {
    return {
      code: error.metaCode ?? error.code,
      message: error.safeMessage,
    };
  }
  if (error instanceof CredentialsEncryptionError) {
    return {
      code: "credentials_unavailable",
      message: "No se pudo usar la configuración de WhatsApp.",
    };
  }
  return {
    code: "send_failed",
    message: "No se pudo enviar el mensaje por WhatsApp.",
  };
}

async function recordWhatsappAuditBestEffort(
  input: Parameters<typeof recordAudit>[0]
) {
  try {
    await recordAudit(input);
  } catch (error) {
    console.error(
      "[VantixApp] auditoría de WhatsApp:",
      error instanceof Error ? error.name : "unknown_error"
    );
  }
}

export async function sendWhatsappConversationMessage(input: {
  organizationId: string;
  conversationId: string;
  senderType: Extract<SenderType, "HUMAN" | "AI">;
  senderUserId?: string | null;
  content: string;
  retryOfMessageId?: string;
  scheduleFollowUp?: boolean;
  nextFollowUpNumber?: number;
}): Promise<WhatsappOutboundResult> {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      organizationId: input.organizationId,
      channel: "whatsapp",
    },
    select: {
      id: true,
      status: true,
      customer: { select: { phone: true } },
      whatsappIntegration: {
        select: {
          id: true,
          organizationId: true,
          phoneNumberId: true,
          encryptedAccessToken: true,
          status: true,
        },
      },
    },
  });
  if (!conversation) {
    throw new WhatsappOutboundValidationError(
      "La conversación no existe o no pertenece a tu negocio."
    );
  }
  if (conversation.status === "CLOSED") {
    throw new WhatsappOutboundValidationError(
      "La conversación está cerrada. Reabrila para responder."
    );
  }
  if (!conversation.customer?.phone) {
    throw new WhatsappOutboundValidationError(
      "El cliente no tiene un número de WhatsApp válido."
    );
  }
  const integration = conversation.whatsappIntegration;
  if (
    !integration ||
    integration.organizationId !== input.organizationId ||
    integration.status !== "CONNECTED"
  ) {
    throw new WhatsappOutboundValidationError(
      "La integración de WhatsApp no está conectada."
    );
  }

  const pending = await saveMessage({
    organizationId: input.organizationId,
    conversationId: conversation.id,
    senderType: input.senderType,
    senderUserId: input.senderUserId ?? null,
    content: input.content,
    deliveryStatus: "PENDING",
    metadata: {
      source: "whatsapp",
      ...(input.retryOfMessageId
        ? { retryOfMessageId: input.retryOfMessageId }
        : {}),
    },
  });

  return deliverPreparedWhatsappMessage({
    organizationId: input.organizationId,
    conversationId: conversation.id,
    messageId: pending.id,
    senderUserId: input.senderUserId ?? null,
    scheduleFollowUp: input.scheduleFollowUp,
    nextFollowUpNumber: input.nextFollowUpNumber,
  });
}

/**
 * Envía un Message PENDING ya reservado. La acción firmada de seguimiento usa
 * esta variante después de enlazar el mensaje al AutomationEvent de forma
 * atómica; los retries nunca vuelven a entrar si ese enlace ya existe.
 */
export async function deliverPreparedWhatsappMessage(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  senderUserId?: string | null;
  scheduleFollowUp?: boolean;
  nextFollowUpNumber?: number;
}): Promise<WhatsappOutboundResult> {
  const prepared = await prisma.message.findFirst({
    where: {
      id: input.messageId,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      senderType: { in: ["AI", "HUMAN"] },
      deliveryStatus: "PENDING",
    },
    select: {
      id: true,
      content: true,
      conversation: {
        select: {
          status: true,
          customer: { select: { phone: true } },
          whatsappIntegration: {
            select: {
              organizationId: true,
              phoneNumberId: true,
              encryptedAccessToken: true,
              status: true,
            },
          },
        },
      },
    },
  });
  if (!prepared) {
    throw new WhatsappOutboundValidationError(
      "El mensaje ya no está disponible para enviar."
    );
  }
  if (prepared.conversation.status === "CLOSED") {
    throw new WhatsappOutboundValidationError(
      "La conversación está cerrada. Reabrila para responder."
    );
  }
  if (!prepared.conversation.customer?.phone) {
    throw new WhatsappOutboundValidationError(
      "El cliente no tiene un número de WhatsApp válido."
    );
  }
  const integration = prepared.conversation.whatsappIntegration;
  if (
    !integration ||
    integration.organizationId !== input.organizationId ||
    integration.status !== "CONNECTED"
  ) {
    throw new WhatsappOutboundValidationError(
      "La integración de WhatsApp no está conectada."
    );
  }

  let sent: Awaited<ReturnType<typeof sendWhatsappTextMessage>>;
  try {
    const accessToken = decryptAccessToken(integration.encryptedAccessToken);
    sent = await sendWhatsappTextMessage({
      phoneNumberId: integration.phoneNumberId,
      accessToken,
      to: prepared.conversation.customer.phone,
      text: prepared.content,
    });
  } catch (error) {
    const failure = safeFailure(error);
    const message = await prisma.message.update({
      where: { id: prepared.id },
      data: {
        deliveryStatus: "FAILED",
        errorCode: failure.code.slice(0, 100),
        errorMessage: failure.message.slice(0, 500),
      },
    });
    await recordWhatsappAuditBestEffort({
      organizationId: input.organizationId,
      userId: input.senderUserId ?? null,
      action: "whatsapp.envio_fallido",
      entityType: "message",
      entityId: message.id,
      details: { codigo: failure.code.slice(0, 100) },
    });
    return { ok: false, error: failure.message, message };
  }

  // Esta escritura queda fuera del catch de transporte: si Meta confirmó el
  // envío pero falla la base, nunca se etiqueta falsamente el intento como FAILED.
  const message = await prisma.message.update({
    where: { id: prepared.id },
    data: {
      externalMessageId: sent.messageId,
      deliveryStatus: "SENT",
      errorCode: null,
      errorMessage: null,
    },
  });

  await recordWhatsappAuditBestEffort({
    organizationId: input.organizationId,
    userId: input.senderUserId ?? null,
    action: "whatsapp.mensaje_enviado",
    entityType: "message",
    entityId: message.id,
    details: { remitente: message.senderType.toLowerCase() },
  });
  if (input.scheduleFollowUp !== false) {
    await scheduleFollowUpAfterOutbound({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      sourceMessageId: message.id,
      followUpNumber: input.nextFollowUpNumber,
    });
  }
  return { ok: true, message };
}
