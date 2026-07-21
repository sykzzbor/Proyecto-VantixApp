import {
  getAIProviderMode,
  isAIProviderConfigured,
  type AIProviderMode,
} from "@/server/agent/config";
import { runAnthropicProvider } from "@/server/agent/providers/anthropic";
import { runOpenAIProvider } from "@/server/agent/providers/openai";
import {
  AgentProviderError,
  type AgentProviderErrorCode,
  type AgentProviderRunner,
  type AgentRunParams,
  type AgentRunResult,
} from "@/server/agent/types";

export type { AgentHistoryMessage, AgentRunResult } from "@/server/agent/types";

export class AgentRunError extends Error {
  constructor(
    public readonly code: "not_configured" | "provider_error",
    /** Código específico del proveedor, solo para logs y mensajes seguros. */
    public readonly providerCode: AgentProviderErrorCode = code
  ) {
    super("No se pudo generar la respuesta del agente.");
    this.name = "AgentRunError";
  }
}

/**
 * Mensaje seguro y claro para el chat según el código del proveedor. Nunca
 * incluye detalles técnicos, claves ni cuerpos de error.
 */
export function agentErrorMessage(code: AgentProviderErrorCode): string {
  switch (code) {
    case "not_configured":
      return "El proveedor de IA no está configurado correctamente.";
    case "auth_error":
      return "El proveedor de IA rechazó las credenciales. Revisá la configuración.";
    case "rate_limited":
      return "El proveedor de IA está recibiendo demasiadas solicitudes. Probá de nuevo en unos segundos.";
    case "insufficient_quota":
      return "La cuenta del proveedor de IA no tiene saldo o cuota disponible.";
    case "timeout":
      return "El proveedor de IA tardó demasiado en responder. Probá de nuevo.";
    case "deadline_exceeded":
      return "La consulta tardó demasiado y se cortó para no dejarte esperando. Probá de nuevo o reformulá el mensaje más corto.";
    case "overloaded":
      return "El proveedor de IA está sobrecargado en este momento. Probá de nuevo en unos segundos.";
    case "empty_response":
      return "El agente no generó una respuesta. Probá de nuevo o reformulá el mensaje.";
    default:
      return "No se pudo generar la respuesta. Probá de nuevo en unos segundos.";
  }
}

type RunAgentDependencies = {
  provider?: AIProviderMode;
  configured?: boolean;
  openaiRunner?: AgentProviderRunner;
  anthropicRunner?: AgentProviderRunner;
};

export async function runAgent(
  params: AgentRunParams,
  dependencies: RunAgentDependencies = {}
): Promise<AgentRunResult> {
  const provider = dependencies.provider ?? getAIProviderMode();
  const configured =
    dependencies.configured ?? isAIProviderConfigured(provider);
  if (provider === "demo" || !configured) {
    throw new AgentRunError("not_configured");
  }

  const runner =
    provider === "anthropic"
      ? (dependencies.anthropicRunner ?? runAnthropicProvider)
      : (dependencies.openaiRunner ?? runOpenAIProvider);

  try {
    return await runner(params);
  } catch (error) {
    const providerCode: AgentProviderErrorCode =
      error instanceof AgentProviderError ? error.code : "provider_error";
    console.error(
      `[VantixApp] Error del proveedor de IA provider=${provider} code=${providerCode}`
    );
    throw new AgentRunError(
      providerCode === "not_configured" ? "not_configured" : "provider_error",
      providerCode
    );
  }
}
