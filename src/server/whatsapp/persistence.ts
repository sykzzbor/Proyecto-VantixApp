import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { nextDeliveryStatus } from "@/server/whatsapp/delivery";
import type {
  ResolvedWhatsappIntegration,
  WhatsappInboundEvent,
  WhatsappStatusEvent,
} from "@/server/whatsapp/types";

const SERIALIZABLE_RETRIES = 3;

export type WhatsappTenantScope = {
  organizationId: string;
  integrationId: string | null;
};

export type PersistInboundResult =
  | {
      duplicate: true;
      conversationId: string | null;
      messageId: string;
    }
  | {
      duplicate: false;
      organizationId: string;
      integrationId: string | null;
      conversationId: string;
      messageId: string;
      handlingMode: "AI" | "HUMAN";
      content: string;
    };

export function normalizeWhatsappPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 24);
  if (!digits) throw new Error("invalid_whatsapp_phone");
  return `+${digits}`;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}

export async function resolveWhatsappIntegration(
  phoneNumberId: string
): Promise<ResolvedWhatsappIntegration | null> {
  return prisma.whatsappIntegration.findUnique({
    where: { phoneNumberId },
    select: {
      id: true,
      organizationId: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      encryptedAccessToken: true,
      status: true,
    },
  });
}

async function findDuplicate(externalMessageId: string) {
  return prisma.message.findUnique({
    where: { externalMessageId },
    select: { id: true, conversationId: true },
  });
}

/**
 * Persiste el mensaje, cliente y conversación en una transacción serializable.
 * La combinación de ese aislamiento y el ID externo único evita que un webhook
 * repetido incremente dos veces los no leídos o cree conversaciones paralelas.
 */
export async function persistIncomingWhatsappMessage(
  event: WhatsappInboundEvent,
  scope: WhatsappTenantScope
): Promise<PersistInboundResult> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const duplicate = await tx.message.findUnique({
            where: { externalMessageId: event.externalMessageId },
            select: { id: true, conversationId: true },
          });
          if (duplicate) {
            return {
              duplicate: true as const,
              conversationId: duplicate.conversationId,
              messageId: duplicate.id,
            };
          }

          const phone = normalizeWhatsappPhone(event.from);
          let customer = await tx.customer.findFirst({
            where: { organizationId: scope.organizationId, phone },
            orderBy: { createdAt: "asc" },
            select: { id: true, name: true },
          });

          if (customer) {
            if (customer.name !== event.customerName) {
              customer = await tx.customer.update({
                where: { id: customer.id },
                data: { name: event.customerName },
                select: { id: true, name: true },
              });
            }
          } else {
            customer = await tx.customer.create({
              data: {
                organizationId: scope.organizationId,
                name: event.customerName,
                phone,
              },
              select: { id: true, name: true },
            });
          }

          let conversation = await tx.conversation.findFirst({
            where: {
              organizationId: scope.organizationId,
              customerId: customer.id,
              channel: "whatsapp",
              status: { not: "CLOSED" },
              whatsappIntegrationId: scope.integrationId,
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, handlingMode: true, lastMessageAt: true },
          });

          if (!conversation) {
            conversation = await tx.conversation.create({
              data: {
                organizationId: scope.organizationId,
                customerId: customer.id,
                channel: "whatsapp",
                whatsappIntegrationId: scope.integrationId,
              },
              select: { id: true, handlingMode: true, lastMessageAt: true },
            });
          }

          const createdAt = event.timestamp
            ? new Date(Number(event.timestamp) * 1000)
            : new Date();
          const safeCreatedAt = Number.isNaN(createdAt.getTime())
            ? new Date()
            : createdAt;

          const message = await tx.message.create({
            data: {
              organizationId: scope.organizationId,
              conversationId: conversation.id,
              senderType: "CUSTOMER",
              content: event.content,
              externalMessageId: event.externalMessageId,
              metadata: event.metadata as Prisma.InputJsonObject,
              createdAt: safeCreatedAt,
            },
            select: { id: true },
          });

          const activityAt =
            conversation.lastMessageAt && conversation.lastMessageAt > safeCreatedAt
              ? conversation.lastMessageAt
              : safeCreatedAt;
          const updated = await tx.conversation.updateMany({
            where: {
              id: conversation.id,
              organizationId: scope.organizationId,
            },
            data: {
              lastMessageAt: activityAt,
              unreadCount: { increment: 1 },
            },
          });
          if (updated.count !== 1) throw new Error("conversation_scope_mismatch");

          return {
            duplicate: false as const,
            organizationId: scope.organizationId,
            integrationId: scope.integrationId,
            conversationId: conversation.id,
            messageId: message.id,
            handlingMode: conversation.handlingMode,
            content: event.content,
          };
        },
        { isolationLevel: "Serializable" }
      );
    } catch (error) {
      if (isPrismaCode(error, "P2002")) {
        const duplicate = await findDuplicate(event.externalMessageId);
        if (duplicate) {
          return {
            duplicate: true,
            conversationId: duplicate.conversationId,
            messageId: duplicate.id,
          };
        }
      }
      if (isPrismaCode(error, "P2034") && attempt < SERIALIZABLE_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("whatsapp_transaction_retry_exhausted");
}

export async function markConversationNeedsHumanAttention(input: {
  organizationId: string;
  conversationId: string;
  reason: "demo" | "agent_disabled" | "agent_error" | "integration_unavailable";
}) {
  await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.findFirst({
      where: {
        id: input.conversationId,
        organizationId: input.organizationId,
      },
      select: { id: true, status: true },
    });
    if (!conversation) return;

    await tx.conversation.updateMany({
      where: { id: conversation.id, organizationId: input.organizationId },
      data: { status: "PENDING" },
    });

    if (conversation.status !== "PENDING") {
      const content =
        input.reason === "demo"
          ? "La respuesta automática está desactivada. Esta conversación necesita atención humana."
          : input.reason === "agent_disabled"
            ? "El agente está desactivado. Esta conversación necesita atención humana."
            : input.reason === "integration_unavailable"
              ? "No se pudo usar la integración de WhatsApp. Esta conversación necesita atención humana."
              : "El agente no pudo generar una respuesta. Esta conversación necesita atención humana.";
      const now = new Date();
      await tx.message.create({
        data: {
          organizationId: input.organizationId,
          conversationId: conversation.id,
          senderType: "SYSTEM",
          content,
          metadata: { source: "whatsapp", internalNotice: input.reason },
        },
      });
      await tx.conversation.updateMany({
        where: { id: conversation.id, organizationId: input.organizationId },
        data: { lastMessageAt: now },
      });
    }
  });
}

export type ApplyStatusResult =
  | { found: false }
  | {
      found: true;
      changed: boolean;
      organizationId: string;
      messageId: string;
      deliveryStatus: "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";
    };

export async function applyWhatsappStatus(
  event: WhatsappStatusEvent,
  organizationId: string
): Promise<ApplyStatusResult> {
  const message = await prisma.message.findFirst({
    where: {
      organizationId,
      externalMessageId: event.externalMessageId,
    },
    select: { id: true, deliveryStatus: true },
  });
  if (!message) return { found: false };

  const next = nextDeliveryStatus(message.deliveryStatus, event.deliveryStatus);
  if (next === message.deliveryStatus) {
    return {
      found: true,
      changed: false,
      organizationId,
      messageId: message.id,
      deliveryStatus: next,
    };
  }

  const updated = await prisma.message.updateMany({
    where: {
      id: message.id,
      organizationId,
      deliveryStatus: message.deliveryStatus,
    },
    data: {
      deliveryStatus: next,
      errorCode: next === "FAILED" ? event.errorCode : null,
      errorMessage: next === "FAILED" ? event.errorMessage : null,
    },
  });

  return {
    found: true,
    changed: updated.count === 1,
    organizationId,
    messageId: message.id,
    deliveryStatus: next,
  };
}

export async function touchWhatsappIntegration(integrationId: string) {
  await prisma.whatsappIntegration.updateMany({
    where: { id: integrationId },
    data: { lastWebhookAt: new Date() },
  });
}
