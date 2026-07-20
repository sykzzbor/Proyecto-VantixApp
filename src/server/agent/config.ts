export type AIProviderMode = "demo" | "openai" | "anthropic";

export type AIProviderEnvironment = {
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

function currentEnvironment(): AIProviderEnvironment {
  return {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
  };
}

/**
 * `demo` nunca hace llamadas pagas. La compatibilidad legacy conserva OpenAI
 * cuando existe OPENAI_API_KEY y AI_PROVIDER no fue definido.
 */
export function getAIProviderMode(
  env: AIProviderEnvironment = currentEnvironment()
): AIProviderMode {
  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  if (provider === "demo") return "demo";
  if (provider === "openai") return "openai";
  if (provider === "anthropic") return "anthropic";
  if (provider) return "demo";
  return env.OPENAI_API_KEY?.trim() ? "openai" : "demo";
}

export function isAIProviderConfigured(
  provider: AIProviderMode,
  env: AIProviderEnvironment = currentEnvironment()
): boolean {
  if (provider === "demo") return false;
  if (provider === "openai") return Boolean(env.OPENAI_API_KEY?.trim());
  return Boolean(
    env.ANTHROPIC_API_KEY?.trim() && env.ANTHROPIC_MODEL?.trim()
  );
}

/** Solo valida variables del servidor; nunca devuelve claves. */
export function isAgentConfigured(
  env: AIProviderEnvironment = currentEnvironment()
): boolean {
  const provider = getAIProviderMode(env);
  return isAIProviderConfigured(provider, env);
}

export function getAnthropicModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() ?? "";
}

export type AgentConfigStatus = "ready" | "demo" | "misconfigured";

/**
 * Distingue tres estados para dar un mensaje preciso al chat:
 * - `ready`: proveedor real con credenciales y modelo.
 * - `demo`: modo demostración deliberado (no hay proveedor pago).
 * - `misconfigured`: se eligió un proveedor real pero falta la clave o el
 *   modelo (por ejemplo `AI_PROVIDER=anthropic` sin `ANTHROPIC_MODEL`).
 */
export function getAgentConfigStatus(
  env: AIProviderEnvironment = currentEnvironment()
): AgentConfigStatus {
  const provider = getAIProviderMode(env);
  if (provider === "demo") return "demo";
  return isAIProviderConfigured(provider, env) ? "ready" : "misconfigured";
}
