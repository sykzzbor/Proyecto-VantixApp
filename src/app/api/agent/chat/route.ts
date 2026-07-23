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
  getOpenTestConversation,
  getOrCreateTestConversation,
  getRecentMessages,
  saveMessage,
} from "@/server/conversations";
import {
  consumeUsage,
  refundUsage,
  UsageLimitError,
} from "@/server/billing/rules";
import { checkRateLimit } from "@/server/rate-limit";
import { formatTime } from "@/lib/format";
import { findActiveMembership } from "@/server/context";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { getTiendanubeAgentReadiness } from "@/server/integrations/tiendanube/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// El turno del agente puede tardar más que el límite por defecto de Vercel
// (10 s): la llamada a Anthropic tiene un timeout de 30 s y puede haber
// varias rondas de herramientas. Sin esto, la función muere a mitad de la
// respuesta y el chat "no responde".
export const maxDuration = 60;

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
  stage:
    | "session"
    | "membership"
    | "entitlement"
    | "rate_limit"
    | "invalid_body"
    | "usage_limit"
    | "human"
    | "agent_disabled"
    | "config"
    | "provider"
    | "ok"
    | "error";
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
      logAgentEvent({ requestId, stage: "session", errorCode: "unauthorized" });
      return jsonError(401, "unauthorized", "Tenés que iniciar sesión.");
    }

    // 2. La organización sale SIEMPRE de la membresía del usuario,
    //    nunca del cuerpo de la petición.
    const membership = await findActiveMembership(session.user.id);
    if (!membership) {
      logAgentEvent({
        requestId,
        stage: "membership",
        errorCode: "no_organization",
      });
      return jsonError(
        403,
        "no_organization",
        "Tu usuario no pertenece a ninguna organización."
      );
    }
    const organizationId = membership.organizationId;
    // A diferencia de WhatsApp (que resuelve la organización desde la
    // integración), acá sale de la selección activa del usuario: se registra
    // para poder comparar ambos caminos cuando uno responde y el otro no.
    const entitlement = await getOrganizationEntitlement(organizationId);
    if (!entitlement.accessAllowed) {
      logAgentEvent({
        requestId,
        stage: "entitlement",
        organizationId,
        errorCode: entitlement.reason,
      });
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
      logAgentEvent({
        requestId,
        stage: "rate_limit",
        organizationId,
        errorCode: "rate_limited",
      });
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

    // 5. Conversación de prueba (se crea o reutiliza). Crear una nueva
    //    consume una unidad del cupo mensual de conversaciones del plan.
    const existingConversation = await getOpenTestConversation(organizationId);
    if (!existingConversation) {
      const conversationUsage = await consumeUsage({
        organizationId,
        metric: "conversations",
        entitlement,
      });
      if (!conversationUsage.allowed) {
        logAgentEvent({
          requestId,
          stage: "usage_limit",
          organizationId,
          errorCode: "conversations",
        });
        return jsonError(
          402,
          "usage_limit",
          new UsageLimitError("conversations", conversationUsage.limit).message
        );
      }
    }
    const conversation =
      existingConversation ?? (await getOrCreateTestConversation(organizationId));

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
      // La IA no responde y el frontend no muestra ninguna burbuja nueva: es
      // el caso que más se parece a "no pasa nada", así que queda registrado.
      logAgentEvent({
        requestId,
        stage: "human",
        organizationId,
        conversationId: conversation.id,
        errorCode: "human_takeover",
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
    const [settings, business, knowledgeCount, appointmentReadiness, commerceReady] =
      await Promise.all([
        prisma.agentSettings.findUnique({ where: { organizationId } }),
        prisma.businessProfile.findUnique({ where: { organizationId } }),
        prisma.knowledgeDocument.count({
          where: { organizationId, status: "READY", enabled: true },
        }),
        getAppointmentReadiness(organizationId).catch(() => null),
        getTiendanubeAgentReadiness(organizationId).catch(() => false),
      ]);
    if (!settings || !settings.enabled) {
      logAgentEvent({
        requestId,
        stage: "agent_disabled",
        organizationId,
        conversationId: conversation.id,
        errorCode: settings ? "disabled" : "no_settings",
      });
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

    // 9.bis Cupo mensual de respuestas de IA, reservado antes de llamar al
    //       proveedor y devuelto si la llamada falla.
    const aiUsage = await consumeUsage({
      organizationId,
      metric: "aiResponses",
      entitlement,
    });
    if (!aiUsage.allowed) {
      logAgentEvent({
        requestId,
        stage: "usage_limit",
        organizationId,
        conversationId: conversation.id,
        errorCode: "aiResponses",
      });
      return jsonError(
        402,
        "usage_limit",
        new UsageLimitError("aiResponses", aiUsage.limit).message
      );
    }

    const startedAt = Date.now();
    let result;
    try {
      result = await runAgent({
        ctx,
        instructions: buildAgentInstructions(settings, business, {
          hasAppointments: appointmentReadiness?.ready ?? false,
          hasKnowledge: knowledgeCount > 0,
          hasCommerce: commerceReady,
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
        // Solo se ofrecen las herramientas que esta organización puede usar.
        capabilities: {
          appointments: appointmentReadiness?.ready ?? false,
          knowledge: knowledgeCount > 0,
          commerce: commerceReady,
        },
        // La función serverless muere a los 60 s: el agente corta bastante
        // antes para que el cliente reciba respuesta o error, nunca un corte.
        deadlineMs: 25_000,
      });
    } catch (error) {
      if (error instanceof AgentRunError) {
        // El fallo del proveedor no debe consumir cupo del plan.
        await refundUsage({ organizationId, metric: "aiResponses" }).catch(
          () => {}
        );
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
