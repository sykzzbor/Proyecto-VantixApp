import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isSerializableTransactionConflict } from "@/lib/prisma-errors";
import { nextDeliveryStatus } from "@/server/whatsapp/delivery";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";
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
  const integration = await prisma.whatsappIntegration.findFirst({
    where: { phoneNumberId, provider: "META_CLOUD" },
    select: {
      id: true,
      organizationId: true,
      provider: true,
      wabaId: true,
      phoneNumberId: true,
      providerPhoneNumber: true,
      displayPhoneNumber: true,
      encryptedAccessToken: true,
      status: true,
    },
  });
  return integration;
}

export async function resolveYCloudIntegration(input: {
  phoneNumber: string;
  wabaId: string;
}): Promise<ResolvedWhatsappIntegration | null> {
  let phoneNumber: string;
  try {
    phoneNumber = normalizeWhatsappPhone(input.phoneNumber);
  } catch {
    return null;
  }
  return prisma.whatsappIntegration.findFirst({
    where: {
      provider: "YCLOUD",
      providerPhoneNumber: phoneNumber,
      wabaId: input.wabaId,
    },
    select: {
      id: true,
      organizationId: true,
      provider: true,
      wabaId: true,
      phoneNumberId: true,
      providerPhoneNumber: true,
      displayPhoneNumber: true,
      encryptedAccessToken: true,
      status: true,
    },
  });
}

async function findDuplicate(event: WhatsappInboundEvent) {
  return prisma.message.findFirst({
    where: {
      OR: [
        { externalMessageId: event.externalMessageId },
        ...(event.whatsappMessageId
          ? [{ whatsappMessageId: event.whatsappMessageId }]
          : []),
      ],
    },
    select: { id: true, conversationId: true },
  });
}

function parseInboundTimestamp(value: string | null): Date {
  if (!value) return new Date();
  const numeric = /^\d+(?:\.\d+)?$/.test(value)
    ? new Date(Number(value) * 1000)
    : new Date(value);
  return Number.isNaN(numeric.getTime()) ? new Date() : numeric;
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
            // Contador mensual de conversaciones. Solo cuenta: el mensaje del
            // cliente nunca se descarta por límite; si el cupo del plan se
            // agotó, el gate del agente deriva a atención humana sin responder.
            const period = new Date();
            const periodKey = `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}`;
            await tx.organizationUsagePeriod.upsert({
              where: {
                organizationId_periodKey: {
                  organizationId: scope.organizationId,
                  periodKey,
                },
              },
              create: {
                organizationId: scope.organizationId,
                periodKey,
                conversationsCount: 1,
              },
              update: { conversationsCount: { increment: 1 } },
            });
          }

          const safeCreatedAt = parseInboundTimestamp(event.timestamp);
          const ingestedAt = new Date();

          const message = await tx.message.create({
            data: {
              organizationId: scope.organizationId,
              conversationId: conversation.id,
              senderType: "CUSTOMER",
              content: event.content,
              externalMessageId: event.externalMessageId,
              whatsappMessageId: event.whatsappMessageId ?? null,
              metadata: event.metadata as Prisma.InputJsonObject,
              createdAt: safeCreatedAt,
              ingestedAt,
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

          await cancelPendingFollowUpsTx(tx, {
            organizationId: scope.organizationId,
            conversationId: conversation.id,
            reason: "customer_replied",
            now: ingestedAt,
          });

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
        const duplicate = await findDuplicate(event);
        if (duplicate) {
          return {
            duplicate: true,
            conversationId: duplicate.conversationId,
            messageId: duplicate.id,
          };
        }
      }
      if (
        isSerializableTransactionConflict(error) &&
        attempt < SERIALIZABLE_RETRIES - 1
      ) {
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
  reason:
    | "demo"
    | "agent_disabled"
    | "agent_error"
    | "integration_unavailable"
    | "usage_limit";
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
              : input.reason === "usage_limit"
                ? "Se alcanzó el límite mensual del plan. Esta conversación necesita atención humana."
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
      OR: [
        { externalMessageId: event.externalMessageId },
        ...(event.whatsappMessageId
          ? [{ whatsappMessageId: event.whatsappMessageId }]
          : []),
        ...(event.internalMessageId ? [{ id: event.internalMessageId }] : []),
      ],
    },
    select: { id: true, deliveryStatus: true, whatsappMessageId: true },
  });
  if (!message) return { found: false };

  const next = nextDeliveryStatus(message.deliveryStatus, event.deliveryStatus);
  if (next === message.deliveryStatus) {
    if (event.whatsappMessageId && !message.whatsappMessageId) {
      const enriched = await prisma.message.updateMany({
        where: {
          id: message.id,
          organizationId,
          whatsappMessageId: null,
        },
        data: { whatsappMessageId: event.whatsappMessageId },
      });
      return {
        found: true,
        changed: enriched.count === 1,
        organizationId,
        messageId: message.id,
        deliveryStatus: next,
      };
    }
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
      ...(event.whatsappMessageId && !message.whatsappMessageId
        ? { whatsappMessageId: event.whatsappMessageId }
        : {}),
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
