"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Message } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { formatDate, formatTime } from "@/lib/format";
import {
  conversationStatusSchema,
  humanMessageSchema,
  type HumanMessageInput,
} from "@/lib/validations/conversation";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { saveMessage } from "@/server/conversations";
import type { ThreadMessage } from "@/server/inbox";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import {
  sendWhatsappConversationMessage,
  WhatsappOutboundValidationError,
} from "@/server/whatsapp/outbound";

const idSchema = z.string().min(1);

const INBOX_PATH = "/dashboard/conversaciones";

function revalidate() {
  revalidatePath(INBOX_PATH);
  revalidatePath("/dashboard");
}

function toThreadMessage(message: Message, senderName: string): ThreadMessage {
  return {
    id: message.id,
    senderType:
      message.senderType === "AI"
        ? "ai"
        : message.senderType === "HUMAN"
          ? "human"
          : message.senderType === "CUSTOMER"
            ? "customer"
            : "system",
    senderName,
    content: message.content,
    timeLabel: formatTime(message.createdAt),
    dateLabel: formatDate(message.createdAt),
    deliveryStatus: message.deliveryStatus
      ? (message.deliveryStatus.toLowerCase() as ThreadMessage["deliveryStatus"])
      : null,
    errorCode: message.errorCode,
    errorMessage: message.errorMessage,
    retryable:
      message.deliveryStatus === "FAILED" &&
      (message.senderType === "HUMAN" || message.senderType === "AI"),
  };
}

/** Busca la conversación verificando que pertenezca a la organización de la sesión. */
async function findOwnConversation(id: string, organizationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, organizationId },
  });
  if (!conversation) {
    throw new ActionError("La conversación no existe o no pertenece a tu negocio.");
  }
  return conversation;
}

/** Pasa la conversación a atención humana, asignada al usuario autenticado. */
export async function takeConversation(
  conversationId: string
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    const id = idSchema.parse(conversationId);
    const conversation = await findOwnConversation(id, org.id);

    if (conversation.status === "CLOSED") {
      throw new ActionError("La conversación está cerrada. Reabrila para tomarla.");
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        handlingMode: "HUMAN",
        assignedUserId: user.id,
        humanTakeoverAt: new Date(),
      },
    });

    await saveMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      senderType: "SYSTEM",
      content: `${user.name} tomó la conversación.`,
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "conversacion.tomada",
      entityType: "conversation",
      entityId: conversation.id,
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Devuelve la conversación a la IA manteniendo todo el historial. */
export async function returnConversationToAI(
  conversationId: string
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    const id = idSchema.parse(conversationId);
    const conversation = await findOwnConversation(id, org.id);

    if (conversation.handlingMode === "AI") return { ok: true };

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        handlingMode: "AI",
        assignedUserId: null,
        humanTakeoverAt: null,
      },
    });

    await saveMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      senderType: "SYSTEM",
      content: `${user.name} devolvió la conversación a la IA.`,
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "conversacion.devuelta_ia",
      entityType: "conversation",
      entityId: conversation.id,
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export type SendHumanMessageResult =
  | { ok: true; message: ThreadMessage }
  | { ok: false; error: string; message?: ThreadMessage };

/** Respuesta manual de un miembro del equipo dentro del canal de la conversación. */
export async function sendHumanMessage(
  conversationId: string,
  input: HumanMessageInput
): Promise<SendHumanMessageResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    const id = idSchema.parse(conversationId);
    const data = humanMessageSchema.parse(input);
    const conversation = await findOwnConversation(id, org.id);

    if (conversation.status === "CLOSED") {
      throw new ActionError("La conversación está cerrada. Reabrila para responder.");
    }
    if (conversation.handlingMode !== "HUMAN") {
      throw new ActionError("Primero tomá la conversación para responder.");
    }

    if (conversation.channel === "whatsapp") {
      let result;
      try {
        result = await sendWhatsappConversationMessage({
          organizationId: org.id,
          conversationId: conversation.id,
          senderType: "HUMAN",
          senderUserId: user.id,
          content: data.content,
        });
      } catch (error) {
        if (error instanceof WhatsappOutboundValidationError) {
          throw new ActionError(error.message);
        }
        throw error;
      }

      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "conversacion.respuesta_humana",
        entityType: "conversation",
        entityId: conversation.id,
        details: { canal: "whatsapp", resultado: result.ok ? "ok" : "error" },
      });
      revalidatePath(INBOX_PATH);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          message: result.message
            ? toThreadMessage(result.message, user.name)
            : undefined,
        };
      }
      return { ok: true, message: toThreadMessage(result.message, user.name) };
    }

    const message = await saveMessage({
      organizationId: org.id,
      conversationId: conversation.id,
      senderType: "HUMAN",
      senderUserId: user.id,
      content: data.content,
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "conversacion.respuesta_humana",
      entityType: "conversation",
      entityId: conversation.id,
    });

    revalidatePath(INBOX_PATH);
    return {
      ok: true,
      message: toThreadMessage(message, user.name),
    };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Reintenta un intento fallido creando un mensaje nuevo y conservando el anterior. */
export async function retryWhatsappMessage(
  messageId: string
): Promise<SendHumanMessageResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    const id = idSchema.parse(messageId);
    const failed = await prisma.message.findFirst({
      where: {
        id,
        organizationId: org.id,
        deliveryStatus: "FAILED",
        senderType: { in: ["HUMAN", "AI"] },
      },
      include: {
        conversation: {
          select: {
            id: true,
            organizationId: true,
            channel: true,
            status: true,
            handlingMode: true,
          },
        },
      },
    });
    if (!failed || failed.conversation.organizationId !== org.id) {
      throw new ActionError("El mensaje no existe o no se puede reintentar.");
    }
    if (failed.conversation.channel !== "whatsapp") {
      throw new ActionError("Solo los mensajes de WhatsApp se pueden reintentar.");
    }
    if (failed.conversation.status === "CLOSED") {
      throw new ActionError("La conversación está cerrada. Reabrila para responder.");
    }
    if (failed.conversation.handlingMode !== "HUMAN") {
      throw new ActionError("Primero tomá la conversación para reintentar el envío.");
    }

    let result;
    try {
      result = await sendWhatsappConversationMessage({
        organizationId: org.id,
        conversationId: failed.conversation.id,
        senderType: "HUMAN",
        senderUserId: user.id,
        content: failed.content,
        retryOfMessageId: failed.id,
      });
    } catch (error) {
      if (error instanceof WhatsappOutboundValidationError) {
        throw new ActionError(error.message);
      }
      throw error;
    }

    revalidatePath(INBOX_PATH);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        message: result.message
          ? toThreadMessage(result.message, user.name)
          : undefined,
      };
    }
    return { ok: true, message: toThreadMessage(result.message, user.name) };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Cambia el estado (abierta, pendiente, cerrada). Cerrar y reabrir usan esta acción. */
export async function setConversationStatus(
  conversationId: string,
  status: string
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.manage");
    const id = idSchema.parse(conversationId);
    const newStatus = conversationStatusSchema.parse(status);
    const conversation = await findOwnConversation(id, org.id);

    if (conversation.status === newStatus) return { ok: true };

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        status: newStatus,
        closedAt: newStatus === "CLOSED" ? new Date() : null,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action:
        newStatus === "CLOSED"
          ? "conversacion.cerrada"
          : conversation.status === "CLOSED"
            ? "conversacion.reabierta"
            : "conversacion.estado_cambiado",
      entityType: "conversation",
      entityId: conversation.id,
      details: { estado: newStatus },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Asigna la conversación a un miembro del equipo (o la deja sin responsable). */
export async function assignConversation(
  conversationId: string,
  memberId: string | null
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.manage");
    const id = idSchema.parse(conversationId);
    const conversation = await findOwnConversation(id, org.id);

    let assignedUserId: string | null = null;
    let assignedEmail: string | null = null;
    if (memberId) {
      const member = await prisma.organizationMember.findFirst({
        where: { id: idSchema.parse(memberId), organizationId: org.id },
        include: { user: { select: { id: true, email: true } } },
      });
      if (!member) throw new ActionError("El miembro no existe en tu equipo.");
      assignedUserId = member.user.id;
      assignedEmail = member.user.email;
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { assignedUserId },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: assignedUserId ? "conversacion.asignada" : "conversacion.desasignada",
      entityType: "conversation",
      entityId: conversation.id,
      details: assignedEmail ? { email: assignedEmail } : undefined,
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
