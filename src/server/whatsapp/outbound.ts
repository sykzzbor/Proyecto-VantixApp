import type { Message, SenderType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
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

export async function sendWhatsappConversationMessage(input: {
  organizationId: string;
  conversationId: string;
  senderType: Extract<SenderType, "HUMAN" | "AI">;
  senderUserId?: string | null;
  content: string;
  retryOfMessageId?: string;
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

  let sent: Awaited<ReturnType<typeof sendWhatsappTextMessage>>;
  try {
    const accessToken = decryptAccessToken(integration.encryptedAccessToken);
    sent = await sendWhatsappTextMessage({
      phoneNumberId: integration.phoneNumberId,
      accessToken,
      to: conversation.customer.phone,
      text: input.content,
    });
  } catch (error) {
    const failure = safeFailure(error);
    const message = await prisma.message.update({
      where: { id: pending.id },
      data: {
        deliveryStatus: "FAILED",
        errorCode: failure.code.slice(0, 100),
        errorMessage: failure.message.slice(0, 500),
      },
    });
    await recordAudit({
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
    where: { id: pending.id },
    data: {
      externalMessageId: sent.messageId,
      deliveryStatus: "SENT",
      errorCode: null,
      errorMessage: null,
    },
  });

  await recordAudit({
    organizationId: input.organizationId,
    userId: input.senderUserId ?? null,
    action: "whatsapp.mensaje_enviado",
    entityType: "message",
    entityId: message.id,
    details: { remitente: input.senderType.toLowerCase() },
  });
  return { ok: true, message };
}
