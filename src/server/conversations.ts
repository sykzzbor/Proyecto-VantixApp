import { prisma } from "@/lib/prisma";
import type {
  MessageDeliveryStatus,
  SenderType,
} from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { formatTime } from "@/lib/format";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";

export const TEST_CHANNEL = "test";

/** Mensajes que se cargan como contexto para el modelo. */
export const HISTORY_LIMIT = 12;

/** Mensajes que se muestran al abrir el chat de prueba. */
export const CHAT_PAGE_LIMIT = 50;

export function getOpenTestConversation(organizationId: string) {
  return prisma.conversation.findFirst({
    where: {
      organizationId,
      channel: TEST_CHANNEL,
      status: { not: "CLOSED" },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getOrCreateTestConversation(organizationId: string) {
  const existing = await getOpenTestConversation(organizationId);
  if (existing) return existing;
  return prisma.conversation.create({
    data: { organizationId, channel: TEST_CHANNEL },
  });
}

/**
 * Devuelve los últimos `limit` mensajes en orden cronológico.
 * Siempre filtra por organizationId además de la conversación.
 */
export async function getRecentMessages(
  conversationId: string,
  organizationId: string,
  limit: number
) {
  const rows = await prisma.message.findMany({
    where: { conversationId, organizationId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse();
}

/**
 * Guarda un mensaje y actualiza la actividad de la conversación.
 * Los mensajes del cliente suman al contador de no leídos de la bandeja.
 */
export async function saveMessage(input: {
  organizationId: string;
  conversationId: string;
  senderType: SenderType;
  senderUserId?: string | null;
  content: string;
  externalMessageId?: string | null;
  deliveryStatus?: MessageDeliveryStatus | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        senderType: input.senderType,
        senderUserId: input.senderUserId ?? null,
        content: input.content,
        externalMessageId: input.externalMessageId ?? null,
        deliveryStatus: input.deliveryStatus ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        metadata: input.metadata,
      },
    });
    const updated = await tx.conversation.updateMany({
      where: {
        id: input.conversationId,
        organizationId: input.organizationId,
      },
      data: {
        lastMessageAt: new Date(),
        ...(input.senderType === "CUSTOMER"
          ? { unreadCount: { increment: 1 } }
          : {}),
      },
    });
    if (updated.count !== 1) throw new Error("conversation_scope_mismatch");
    if (input.senderType === "CUSTOMER") {
      await cancelPendingFollowUpsTx(tx, {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        reason: "customer_replied",
      });
    }
    return message;
  });
}

/** Cierra la conversación de prueba abierta (el "limpiar chat" del dashboard). */
export function closeTestConversation(organizationId: string) {
  return prisma.$transaction(async (tx) => {
    const conversations = await tx.conversation.findMany({
      where: {
        organizationId,
        channel: TEST_CHANNEL,
        status: { not: "CLOSED" },
      },
      select: { id: true },
    });
    const ids = conversations.map((conversation) => conversation.id);
    const updated = await tx.conversation.updateMany({
      where: { id: { in: ids }, organizationId },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    if (ids.length > 0) {
      const now = new Date();
      for (const conversationId of ids) {
        await cancelPendingFollowUpsTx(tx, {
          organizationId,
          conversationId,
          reason: "conversation_closed",
          now,
        });
      }
    }
    return updated;
  });
}

// ============================================================
// Estado inicial del chat de prueba para la página del agente
// ============================================================

export type ChatMessageDTO = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timeLabel: string;
};

export type TestChatState = {
  messages: ChatMessageDTO[];
  humanTakeover: boolean;
};

export async function getTestChatState(
  organizationId: string
): Promise<TestChatState> {
  const conversation = await getOpenTestConversation(organizationId);
  if (!conversation) return { messages: [], humanTakeover: false };

  const rows = await getRecentMessages(
    conversation.id,
    organizationId,
    CHAT_PAGE_LIMIT
  );
  return {
    // El chat de prueba muestra el lado del cliente: los mensajes de la IA
    // y del equipo aparecen como respuestas del negocio.
    messages: rows
      .filter((message) => message.senderType !== "SYSTEM")
      .map((message) => ({
        id: message.id,
        role: message.senderType === "CUSTOMER" ? ("user" as const) : ("assistant" as const),
        content: message.content,
        timeLabel: formatTime(message.createdAt),
      })),
    humanTakeover: conversation.handlingMode === "HUMAN",
  };
}
