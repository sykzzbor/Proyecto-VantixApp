import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatRequestSchema } from "@/lib/validations/chat";
import {
  getAgentConfigStatus,
  getAIProviderMode,
  getAnthropicModel,
} from "@/server/agent/config";
import { buildAgentInstructions } from "@/server/agent/prompt";
import { getAppointmentReadiness } from "@/server/appointments/service";
import {
  AgentRunError,
  agentErrorMessage,
  runAgent,
} from "@/server/agent/run";
import type { AgentToolContext } from "@/server/agent/tools";
import { recordAiUsage } from "@/server/agent/usage";
import { recordAudit } from "@/server/audit";
import {
  HISTORY_LIMIT,
  getOrCreateTestConversation,
  getRecentMessages,
  saveMessage,
} from "@/server/conversations";
import { checkRateLimit } from "@/server/rate-limit";
import { formatTime } from "@/lib/format";
import { findActiveMembership } from "@/server/context";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";

const RATE_LIMIT_MESSAGES = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/**
 * Log estructurado del lado servidor. Solo metadatos seguros: nunca el
 * contenido del mensaje, claves, tokens ni cuerpos de error.
 */
function logAgentEvent(fields: {
  requestId: string;
  stage: "config" | "provider" | "ok" | "human" | "error";
  provider?: string;
  model?: "set" | "missing";
  organizationId?: string;
  conversationId?: string;
  durationMs?: number;
  errorCode?: string;
}) {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  console.info(`[VantixApp] agent-chat ${parts}`);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  try {
    // 1. Sesión autenticada.
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return jsonError(401, "unauthorized", "Tenés que iniciar sesión.");
    }

    // 2. La organización sale SIEMPRE de la membresía del usuario,
    //    nunca del cuerpo de la petición.
    const membership = await findActiveMembership(session.user.id);
    if (!membership) {
      return jsonError(
        403,
        "no_organization",
        "Tu usuario no pertenece a ninguna organización."
      );
    }
    const organizationId = membership.organizationId;
    const entitlement = await getOrganizationEntitlement(organizationId);
    if (!entitlement.accessAllowed) {
      return jsonError(
        402,
        "subscription_required",
        "Tu prueba o período contratado terminó. Elegí un plan para continuar."
      );
    }

    // 3. Rate limiting por organización y usuario.
    const rate = checkRateLimit(
      `agent-chat:${organizationId}:${session.user.id}`,
      RATE_LIMIT_MESSAGES,
      RATE_LIMIT_WINDOW_MS
    );
    if (!rate.allowed) {
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "Enviaste demasiados mensajes seguidos. Esperá un momento.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rate.retryAfterSeconds) },
        }
      );
    }

    // 4. Validación del mensaje.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "invalid_body", "El cuerpo de la petición no es válido.");
    }
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        400,
        "invalid_message",
        parsed.error.issues[0]?.message ?? "El mensaje no es válido."
      );
    }

    // 5. Conversación de prueba (se crea o reutiliza).
    const conversation = await getOrCreateTestConversation(organizationId);

    // 6. Si la conversación está en atención humana, la IA no responde:
    //    el mensaje queda guardado y aparece en la bandeja del equipo.
    if (conversation.handlingMode === "HUMAN") {
      const customerMessage = await saveMessage({
        organizationId,
        conversationId: conversation.id,
        senderType: "CUSTOMER",
        content: parsed.data.message,
      });
      await recordAudit({
        organizationId,
        userId: session.user.id,
        action: "agente.mensaje_recibido",
        entityType: "conversation",
        entityId: conversation.id,
        details: { canal: conversation.channel, modo: "humano" },
      });
      return NextResponse.json({
        reply: null,
        humanMode: true,
        humanTakeover: true,
        messageId: customerMessage.id,
        timeLabel: formatTime(customerMessage.createdAt),
      });
    }

    // 7. Configuración del agente.
    const [settings, business, knowledgeCount, appointmentReadiness] =
      await Promise.all([
        prisma.agentSettings.findUnique({ where: { organizationId } }),
        prisma.businessProfile.findUnique({ where: { organizationId } }),
        prisma.knowledgeDocument.count({
          where: { organizationId, status: "READY", enabled: true },
        }),
        getAppointmentReadiness(organizationId).catch(() => null),
      ]);
    if (!settings || !settings.enabled) {
      return jsonError(
        409,
        "agent_disabled",
        "El agente está desactivado. Activalo desde la configuración del agente."
      );
    }
    const configStatus = getAgentConfigStatus();
    if (configStatus !== "ready") {
      await recordAudit({
        organizationId,
        userId: session.user.id,
        action: "agente.error",
        entityType: "conversation",
        entityId: conversation.id,
        details: {
          proveedor: getAIProviderMode(),
          codigo: configStatus === "demo" ? "demo" : "not_configured",
        },
      });
      logAgentEvent({
        requestId,
        stage: "config",
        provider: getAIProviderMode(),
        model: getAnthropicModel() ? "set" : "missing",
        organizationId,
        conversationId: conversation.id,
        errorCode: configStatus,
      });
      return jsonError(
        503,
        "agent_not_configured",
        configStatus === "demo"
          ? "Las respuestas automáticas están en modo demostración. Configurá un proveedor de IA real para probarlas."
          : "El proveedor de IA no está configurado correctamente."
      );
    }

    // 8. Historial acotado (antes de guardar el mensaje nuevo, para no
    //    duplicarlo en el contexto) y persistencia del mensaje del cliente.
    const historyRows = await getRecentMessages(
      conversation.id,
      organizationId,
      HISTORY_LIMIT
    );

    const customerMessage = await saveMessage({
      organizationId,
      conversationId: conversation.id,
      senderType: "CUSTOMER",
      content: parsed.data.message,
    });

    await recordAudit({
      organizationId,
      userId: session.user.id,
      action: "agente.mensaje_recibido",
      entityType: "conversation",
      entityId: conversation.id,
      details: { canal: conversation.channel },
    });

    // 9. Ejecución del agente con herramientas.
    const ctx: AgentToolContext = {
      organizationId,
      conversationId: conversation.id,
      sourceMessageId: customerMessage.id,
      userId: session.user.id,
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
          .filter((message) => message.senderType !== "SYSTEM")
          .map((message) => ({
            role:
              message.senderType === "CUSTOMER"
                ? ("user" as const)
                : ("assistant" as const),
            content: message.content,
          })),
        userMessage: parsed.data.message,
      });
    } catch (error) {
      if (error instanceof AgentRunError) {
        await recordAudit({
          organizationId,
          userId: session.user.id,
          action: "agente.error",
          entityType: "conversation",
          entityId: conversation.id,
          details: {
            proveedor: getAIProviderMode(),
            codigo: error.providerCode,
          },
        });
        await recordAiUsage({
          organizationId,
          conversationId: conversation.id,
          provider: getAIProviderMode(),
          latencyMs: Date.now() - startedAt,
          success: false,
          errorType: error.providerCode,
        });
        logAgentEvent({
          requestId,
          stage: "provider",
          provider: getAIProviderMode(),
          model: getAnthropicModel() ? "set" : "missing",
          organizationId,
          conversationId: conversation.id,
          durationMs: Date.now() - startedAt,
          errorCode: error.providerCode,
        });
        return jsonError(502, "agent_error", agentErrorMessage(error.providerCode));
      }
      throw error;
    }

    // 10. Persistencia de la respuesta y salida al frontend.
    const reply = result.reply || settings.fallbackMessage;
    const assistantMessage = await saveMessage({
      organizationId,
      conversationId: conversation.id,
      senderType: "AI",
      content: reply,
    });

    await recordAiUsage({
      organizationId,
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      provider: getAIProviderMode(),
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      success: true,
    });

    logAgentEvent({
      requestId,
      stage: "ok",
      provider: getAIProviderMode(),
      model: getAnthropicModel() ? "set" : "missing",
      organizationId,
      conversationId: conversation.id,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      reply,
      humanTakeover: result.humanTakeover,
      messageId: assistantMessage.id,
      timeLabel: formatTime(assistantMessage.createdAt),
    });
  } catch (error) {
    console.error(
      `[VantixApp] agent-chat requestId=${requestId} stage=error`,
      error instanceof Error ? error.name : "desconocido"
    );
    return jsonError(500, "internal_error", "Ocurrió un error inesperado.");
  }
}
