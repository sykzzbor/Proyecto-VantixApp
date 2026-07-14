import { prisma } from "@/lib/prisma";
import type { AgentUsage } from "@/server/agent/types";

/**
 * Registra un evento de uso de IA (solo metadata: tokens, latencia, éxito).
 * NUNCA guarda claves, prompts ni contenido de mensajes. Un fallo de registro
 * no debe romper la conversación.
 */
export async function recordAiUsage(input: {
  organizationId: string;
  conversationId?: string | null;
  messageId?: string | null;
  provider: string;
  usage?: AgentUsage | null;
  latencyMs: number;
  success: boolean;
  errorType?: string | null;
}) {
  try {
    await prisma.aiUsageEvent.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        provider: input.usage?.provider ?? input.provider,
        model: input.usage?.model ?? "",
        inputTokens: input.usage?.inputTokens ?? 0,
        outputTokens: input.usage?.outputTokens ?? 0,
        cacheReadTokens: input.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: input.usage?.cacheWriteTokens ?? null,
        latencyMs: Math.max(0, Math.round(input.latencyMs)),
        success: input.success,
        errorType: input.errorType ?? null,
        toolCallsCount: input.usage?.toolCallsCount ?? 0,
      },
    });
  } catch (error) {
    console.error(
      "[VantixApp] No se pudo registrar el uso de IA:",
      error instanceof Error ? error.name : "unknown_error"
    );
  }
}
