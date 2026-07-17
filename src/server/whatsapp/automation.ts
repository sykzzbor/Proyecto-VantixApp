import { prisma } from "@/lib/prisma";
import {
  getAIProviderMode,
  isAgentConfigured,
} from "@/server/agent/config";
import { buildAgentInstructions } from "@/server/agent/prompt";
import { getAppointmentReadiness } from "@/server/appointments/service";
import { runAgent } from "@/server/agent/run";
import type { AgentToolContext } from "@/server/agent/tools";
import { recordAiUsage } from "@/server/agent/usage";
import { recordAudit } from "@/server/audit";
import {
  HISTORY_LIMIT,
  getRecentMessages,
  saveMessage,
} from "@/server/conversations";
import {
  markConversationNeedsHumanAttention,
} from "@/server/whatsapp/persistence";
import {
  sendWhatsappConversationMessage,
  WhatsappOutboundValidationError,
} from "@/server/whatsapp/outbound";
import type { WhatsappAutomationJob } from "@/server/whatsapp/processing";

export function getWhatsappAgentFallbackReason(
  provider = getAIProviderMode(),
  configured = isAgentConfigured()
): "demo" | "agent_error" | null {
  if (configured) return null;
  return provider === "demo" ? "demo" : "agent_error";
}

async function saveUnsentAutomaticReply(
  job: WhatsappAutomationJob,
  content: string,
  error: string
) {
  const message = await saveMessage({
    organizationId: job.integration.organizationId,
    conversationId: job.persisted.conversationId,
    senderType: "AI",
    content,
    deliveryStatus: "FAILED",
    errorCode: "integration_unavailable",
    errorMessage: error,
    metadata: { source: "whatsapp", automatic: true },
  });
  await recordAudit({
    organizationId: job.integration.organizationId,
    userId: null,
    action: "whatsapp.envio_fallido",
    entityType: "message",
    entityId: message.id,
    details: { codigo: "integration_unavailable" },
  });
}

export async function handleWhatsappAutomaticResponse(
  job: WhatsappAutomationJob
) {
  const organizationId = job.integration.organizationId;
  const conversationId = job.persisted.conversationId;

  const unavailableReason = getWhatsappAgentFallbackReason();
  if (unavailableReason) {
    const provider = getAIProviderMode();
    if (provider !== "demo") {
      await recordAudit({
        organizationId,
        userId: null,
        action: "agente.error",
        entityType: "conversation",
        entityId: conversationId,
        details: { proveedor: provider, codigo: "not_configured" },
      });
    }
    await markConversationNeedsHumanAttention({
      organizationId,
      conversationId,
      reason: unavailableReason,
    });
    return;
  }

  const [conversation, settings, business, knowledgeCount, appointmentReadiness] =
    await Promise.all([
      prisma.conversation.findFirst({
        where: { id: conversationId, organizationId },
        select: { id: true, handlingMode: true, status: true },
      }),
      prisma.agentSettings.findUnique({ where: { organizationId } }),
      prisma.businessProfile.findUnique({ where: { organizationId } }),
      prisma.knowledgeDocument.count({
        where: { organizationId, status: "READY", enabled: true },
      }),
      getAppointmentReadiness(organizationId).catch(() => null),
    ]);

  if (!conversation || conversation.status === "CLOSED") return;
  if (conversation.handlingMode === "HUMAN") return;
  if (!settings?.enabled) {
    await markConversationNeedsHumanAttention({
      organizationId,
      conversationId,
      reason: "agent_disabled",
    });
    return;
  }
  if (job.integration.status !== "CONNECTED") {
    await markConversationNeedsHumanAttention({
      organizationId,
      conversationId,
      reason: "integration_unavailable",
    });
    return;
  }

  const historyRows = await getRecentMessages(
    conversationId,
    organizationId,
    HISTORY_LIMIT + 1
  );
  const ctx: AgentToolContext = {
    organizationId,
    conversationId,
    sourceMessageId: job.persisted.messageId,
    userId: null,
    flags: { humanTakeover: false },
  };

  const startedAt = Date.now();
  let result;
  try {
    result = await runAgent({
      ctx,
      instructions: buildAgentInstructions(settings, business, {
        hasAppointments: appointmentReadiness?.ready ?? false,
        hasKnowledge: knowledgeCount > 0,
      }),
      history: historyRows
        .filter(
          (message) =>
            message.id !== job.persisted.messageId &&
            message.senderType !== "SYSTEM"
        )
        .slice(-HISTORY_LIMIT)
        .map((message) => ({
          role:
            message.senderType === "CUSTOMER"
              ? ("user" as const)
              : ("assistant" as const),
          content: message.content,
        })),
      userMessage: job.event.content,
    });
  } catch {
    await recordAudit({
      organizationId,
      userId: null,
      action: "agente.error",
      entityType: "conversation",
      entityId: conversationId,
      details: { proveedor: getAIProviderMode(), codigo: "provider_error" },
    });
    await recordAiUsage({
      organizationId,
      conversationId,
      provider: getAIProviderMode(),
      latencyMs: Date.now() - startedAt,
      success: false,
      errorType: "provider_error",
    });
    await markConversationNeedsHumanAttention({
      organizationId,
      conversationId,
      reason: "agent_error",
    });
    return;
  }

  await recordAiUsage({
    organizationId,
    conversationId,
    provider: getAIProviderMode(),
    usage: result.usage,
    latencyMs: Date.now() - startedAt,
    success: true,
  });

  const current = await prisma.conversation.findFirst({
    where: { id: conversationId, organizationId },
    select: { handlingMode: true, status: true },
  });
  if (!current || current.status === "CLOSED") return;
  if (!result.humanTakeover && current.handlingMode === "HUMAN") return;

  const reply = result.reply.trim() || settings.fallbackMessage;
  try {
    const sent = await sendWhatsappConversationMessage({
      organizationId,
      conversationId,
      senderType: "AI",
      senderUserId: null,
      content: reply,
      scheduleFollowUp: !result.humanTakeover,
    });
    if (!sent.ok) {
      await markConversationNeedsHumanAttention({
        organizationId,
        conversationId,
        reason: "integration_unavailable",
      });
    }
  } catch (error) {
    if (error instanceof WhatsappOutboundValidationError) {
      await saveUnsentAutomaticReply(job, reply, error.message);
      await markConversationNeedsHumanAttention({
        organizationId,
        conversationId,
        reason: "integration_unavailable",
      });
      return;
    }
    throw error;
  }
}
