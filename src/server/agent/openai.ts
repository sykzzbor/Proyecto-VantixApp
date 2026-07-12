import OpenAI from "openai";

export {
  getAIProviderMode,
  isAgentConfigured,
  isAIProviderConfigured,
} from "@/server/agent/config";
export type {
  AIProviderEnvironment,
  AIProviderMode,
} from "@/server/agent/config";

const DEFAULT_MODEL = "gpt-5-mini";
const REQUEST_TIMEOUT_MS = 30_000;

let client: OpenAI | null = null;
let clientKey: string | null = null;

/** La clave vive solo en el servidor: nunca se envía al navegador. */
export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
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
