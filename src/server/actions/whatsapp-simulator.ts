"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  whatsappSimulatorMessageSchema,
  whatsappSimulatorStatusSchema,
  type WhatsappSimulatorMessageInput,
  type WhatsappSimulatorStatusInput,
} from "@/lib/validations/whatsapp";
import { prisma } from "@/lib/prisma";
import { isAgentConfigured } from "@/server/agent/openai";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { saveMessage } from "@/server/conversations";
import { ActionError, toActionFailure } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import { isWhatsappDevMode } from "@/server/whatsapp/config";
import {
  applyWhatsappStatus,
  markConversationNeedsHumanAttention,
  persistIncomingWhatsappMessage,
} from "@/server/whatsapp/persistence";
import type {
  WhatsappInboundEvent,
  WhatsappStatusEvent,
} from "@/server/whatsapp/types";

const SIMULATOR_LIMIT = 30;
const SIMULATOR_WINDOW_MS = 60_000;

function requireSimulator(organizationId: string, userId: string) {
  if (!isWhatsappDevMode()) {
    throw new ActionError("El simulador solo está disponible en desarrollo.");
  }
  const rate = checkRateLimit(
    `whatsapp-simulator:${organizationId}:${userId}`,
    SIMULATOR_LIMIT,
    SIMULATOR_WINDOW_MS
  );
  if (!rate.allowed) {
    throw new ActionError("Demasiadas simulaciones seguidas. Esperá un momento.");
  }
}

function revalidateSimulator() {
  revalidatePath("/dashboard/integraciones/whatsapp");
  revalidatePath("/dashboard/conversaciones");
  revalidatePath("/dashboard");
}

export type SimulateIncomingResult =
  | { ok: true; conversationId: string; externalMessageId: string }
  | { ok: false; error: string };

export async function simulateWhatsappIncoming(
  input: WhatsappSimulatorMessageInput
): Promise<SimulateIncomingResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "whatsapp.manage");
    requireSimulator(org.id, user.id);
    const data = whatsappSimulatorMessageSchema.parse(input);
    const externalMessageId = `wamid.simulated.${randomUUID()}`;
    const event: WhatsappInboundEvent = {
      kind: "message",
      phoneNumberId: `simulated-${org.id}`,
      externalMessageId,
      from: data.phone,
      customerName: data.name,
      timestamp: String(Math.floor(Date.now() / 1000)),
      messageType: "text",
      content: data.message,
      metadata: {
        source: "whatsapp",
        messageType: "text",
        simulated: true,
      },
    };

    const persisted = await persistIncomingWhatsappMessage(event, {
      organizationId: org.id,
      integrationId: null,
    });
    if (!persisted.duplicate) {
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.mensaje_recibido",
        entityType: "conversation",
        entityId: persisted.conversationId,
        details: { tipo: "text", simulado: true },
      });
      if (persisted.handlingMode === "AI") {
        // El simulador nunca dispara un envío real, aun si OpenAI está activo.
        await markConversationNeedsHumanAttention({
          organizationId: org.id,
          conversationId: persisted.conversationId,
          reason: isAgentConfigured() ? "integration_unavailable" : "demo",
        });
      }
    }

    revalidateSimulator();
    return {
      ok: true,
      conversationId: persisted.conversationId ?? "",
      externalMessageId,
    };
  } catch (error) {
    return toActionFailure(error);
  }
}

export type SimulateStatusResult =
  | { ok: true; externalMessageId: string }
  | { ok: false; error: string };

export async function simulateWhatsappStatus(
  input: WhatsappSimulatorStatusInput
): Promise<SimulateStatusResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "whatsapp.manage");
    requireSimulator(org.id, user.id);
    const data = whatsappSimulatorStatusSchema.parse(input);

    let message = await prisma.message.findFirst({
      where: {
        organizationId: org.id,
        externalMessageId: data.externalMessageId,
      },
      select: { id: true, senderType: true },
    });
    if (message && !["HUMAN", "AI"].includes(message.senderType)) {
      throw new ActionError("Ese ID no corresponde a un mensaje saliente.");
    }

    if (!message) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          organizationId: org.id,
          channel: "whatsapp",
          status: { not: "CLOSED" },
        },
        orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
        select: { id: true },
      });
      if (!conversation) {
        throw new ActionError("Simulá primero un mensaje entrante.");
      }
      const created = await saveMessage({
        organizationId: org.id,
        conversationId: conversation.id,
        senderType: "HUMAN",
        senderUserId: user.id,
        content: "[Mensaje saliente simulado]",
        externalMessageId: data.externalMessageId,
        deliveryStatus: "PENDING",
        metadata: { source: "whatsapp", simulated: true },
      });
      message = { id: created.id, senderType: created.senderType };
    }

    const event: WhatsappStatusEvent = {
      kind: "status",
      phoneNumberId: "simulator",
      externalMessageId: data.externalMessageId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      deliveryStatus: data.status.toUpperCase() as WhatsappStatusEvent["deliveryStatus"],
      errorCode: data.status === "failed" ? data.errorCode || "SIMULATED" : null,
      errorMessage:
        data.status === "failed"
          ? "Fallo simulado: WhatsApp no pudo entregar el mensaje."
          : null,
    };
    const applied = await applyWhatsappStatus(event, org.id);
    if (!applied.found) {
      throw new ActionError("No se encontró el mensaje saliente simulado.");
    }

    if (applied.changed && applied.deliveryStatus === "FAILED") {
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.envio_fallido",
        entityType: "message",
        entityId: message.id,
        details: { simulado: true, codigo: event.errorCode },
      });
    } else if (applied.changed && applied.deliveryStatus === "SENT") {
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.mensaje_enviado",
        entityType: "message",
        entityId: message.id,
        details: { simulado: true },
      });
    }

    revalidateSimulator();
    return { ok: true, externalMessageId: data.externalMessageId };
  } catch (error) {
    return toActionFailure(error);
  }
}
