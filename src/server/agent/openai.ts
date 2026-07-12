import OpenAI from "openai";

const DEFAULT_MODEL = "gpt-5-mini";
const REQUEST_TIMEOUT_MS = 30_000;

let client: OpenAI | null = null;
let clientKey: string | null = null;

export type AIProviderMode = "openai" | "demo";

/**
 * `demo` deshabilita explícitamente cualquier llamada paga. Para preservar
 * instalaciones anteriores, una clave existente sin AI_PROVIDER se interpreta
 * como OpenAI; una instalación nueva parte en demo desde .env.example.
 */
export function getAIProviderMode(
  env: { AI_PROVIDER?: string; OPENAI_API_KEY?: string } = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  }
): AIProviderMode {
  const provider = env.AI_PROVIDER?.trim().toLowerCase();
  if (provider === "demo") return "demo";
  if (provider && provider !== "openai") return "demo";
  return env.OPENAI_API_KEY?.trim() ? "openai" : "demo";
}

/** La clave vive solo en el servidor: nunca se envía al navegador. */
export function isAgentConfigured(): boolean {
  return getAIProviderMode() === "openai";
}

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  // Se recrea si la clave cambió (por ejemplo, tras editar .env en desarrollo).
  if (!client || clientKey !== apiKey) {
    client = new OpenAI({
      apiKey,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
    clientKey = apiKey;
  }
  return client;
}

export function getAgentModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}
