import {
  getAIProviderMode,
  isAIProviderConfigured,
  type AIProviderMode,
} from "@/server/agent/config";
import { runAnthropicProvider } from "@/server/agent/providers/anthropic";
import { runOpenAIProvider } from "@/server/agent/providers/openai";
import {
  AgentProviderError,
  type AgentProviderRunner,
  type AgentRunParams,
  type AgentRunResult,
} from "@/server/agent/types";

export type { AgentHistoryMessage, AgentRunResult } from "@/server/agent/types";

export class AgentRunError extends Error {
  constructor(
    public readonly code: "not_configured" | "provider_error"
  ) {
    super("No se pudo generar la respuesta del agente.");
    this.name = "AgentRunError";
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
    console.error(
      `[VantixApp] Error del proveedor de IA provider=${provider}:`,
      error instanceof AgentProviderError ? error.code : error instanceof Error ? error.name : "unknown_error"
    );
    throw new AgentRunError(
      error instanceof AgentProviderError && error.code === "not_configured"
        ? "not_configured"
        : "provider_error"
    );
  }
}
