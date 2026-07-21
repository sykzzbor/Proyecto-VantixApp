import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlockParam,
  Message,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { getAnthropicModel } from "@/server/agent/config";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type AgentToolContext,
} from "@/server/agent/tools";
import {
  AgentProviderError,
  type AgentProviderErrorCode,
  type AgentRunParams,
  type AgentRunResult,
} from "@/server/agent/types";

/**
 * Presupuestos de tiempo. La función serverless muere a los 60 s, así que el
 * turno completo del agente tiene que terminar bastante antes para que el
 * cliente reciba una respuesta o un error visible en vez de una conexión
 * cortada.
 */
const DEFAULT_DEADLINE_MS = 25_000;
/** Techo por llamada individual (se recorta al presupuesto restante). */
const PER_CALL_TIMEOUT_MS = 20_000;
/** Por debajo de esto ya no hay tiempo para otra llamada. */
const MIN_CALL_BUDGET_MS = 3_000;
/** Por debajo de esto se dejan de ofrecer tools para forzar una respuesta. */
const TOOLS_MIN_BUDGET_MS = 12_000;
const MAX_TOOL_ROUNDS = 2;
const MAX_OUTPUT_TOKENS = 1200;

/** Herramientas que solo tienen sentido con la agenda operativa. */
const APPOINTMENT_TOOL_NAMES = new Set([
  "check_appointment_availability",
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
]);

/**
 * Saludos y cortesías que no necesitan ninguna herramienta. Se exige que el
 * mensaje sea únicamente eso: "hola" entra, "hola, ¿tienen turnos?" no. Las
 * confirmaciones ("sí", "dale") quedan fuera a propósito, porque suelen
 * confirmar una reserva y sí necesitan herramientas.
 */
const SMALL_TALK =
  /^(hola|holis|buenas|buen dia|buenas tardes|buenas noches|hey|que tal|como estas|gracias|muchas gracias|mil gracias|chau|adios|hasta luego|nos vemos)[\s!.,¡?]*$/;

export function isSmallTalk(message: string): boolean {
  const normalized = message
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  return normalized.length <= 40 && SMALL_TALK.test(normalized);
}

/**
 * Traduce un error del SDK de Anthropic a un código interno seguro (sin
 * exponer mensajes, headers ni cuerpos). El código sirve para logs y para
 * elegir el mensaje visible del chat.
 */
export function classifyAnthropicError(error: unknown): AgentProviderErrorCode {
  if (error instanceof AgentProviderError) return error.code;
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const name = error instanceof Error ? error.name : "";
  if (name.includes("Timeout") || name.includes("Connection")) return "timeout";
  if (status === 401 || status === 403) return "auth_error";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 404 || status === 422) return "bad_request";
  if (status === 529) return "overloaded";
  // Créditos/saldo agotado suele llegar como 400 con tipo billing, pero el SDK
  // lo expone en el nombre del error en algunas versiones.
  if (/quota|credit|billing|insufficient/i.test(name)) return "insufficient_quota";
  return "provider_error";
}

let client: Anthropic | null = null;
let clientKey: string | null = null;

export const ANTHROPIC_AGENT_TOOLS: Tool[] = AGENT_TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  input_schema: tool.inputSchema,
  strict: true,
}));

export function getAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!client || clientKey !== apiKey) {
    client = new Anthropic({
      apiKey,
      timeout: PER_CALL_TIMEOUT_MS,
      // Sin reintentos automáticos: un retry duplica el tiempo de la llamada y
      // hace estallar el presupuesto del turno. Ante un fallo transitorio el
      // chat muestra el error y ofrece "Reintentar" al usuario.
      maxRetries: 0,
    });
    clientKey = apiKey;
  }
  return client;
}

export type AnthropicMessageCreator = (
  request: MessageCreateParamsNonStreaming,
  options?: { timeout?: number }
) => Promise<Message>;

/** Tools realmente ofrecidas al modelo según lo que la organización tiene activo. */
export function toolsForCapabilities(
  capabilities: AgentRunParams["capabilities"]
): Tool[] {
  if (!capabilities) return ANTHROPIC_AGENT_TOOLS;
  return ANTHROPIC_AGENT_TOOLS.filter((tool) => {
    if (APPOINTMENT_TOOL_NAMES.has(tool.name)) {
      return capabilities.appointments === true;
    }
    if (tool.name === "search_knowledge") return capabilities.knowledge === true;
    return true;
  });
}

type AnthropicProviderDependencies = {
  createMessage?: AnthropicMessageCreator;
  executeTool?: (
    ctx: AgentToolContext,
    name: string,
    input: unknown
  ) => Promise<string>;
  model?: string;
  /** Umbrales de presupuesto; los tests los reducen para no esperar segundos reales. */
  budgets?: { minCallMs?: number; toolsMinMs?: number };
};

function assistantContent(response: Message): ContentBlockParam[] {
  return response.content.flatMap((block): ContentBlockParam[] => {
    if (block.type === "text") {
      return [{ type: "text", text: block.text }];
    }
    if (block.type === "tool_use") {
      return [
        {
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: block.input,
        },
      ];
    }
    return [];
  });
}

/**
 * La API exige que el primer mensaje sea del usuario. El historial recortado a
 * los últimos N puede empezar con una respuesta del asistente —por ejemplo si
 * el equipo contestó desde la bandeja (HUMAN también mapea a `assistant`) o si
 * hubo dos salientes seguidos—, y en ese caso Anthropic rechaza la petición
 * entera con 400 y el chat se queda sin respuesta.
 */
export function normalizeHistory<T extends { role: "user" | "assistant" }>(
  history: T[]
): T[] {
  const firstUser = history.findIndex((message) => message.role === "user");
  return firstUser === -1 ? [] : history.slice(firstUser);
}

function finalText(response: Message): string {
  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toolResultIsError(content: string): boolean {
  try {
    const parsed: unknown = JSON.parse(content);
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        "error" in parsed
    );
  } catch {
    return false;
  }
}

export async function runAnthropicProvider(
  params: AgentRunParams,
  dependencies: AnthropicProviderDependencies = {}
): Promise<AgentRunResult> {
  const model = dependencies.model ?? getAnthropicModel();
  if (!model) throw new AgentProviderError("not_configured");

  const createMessage =
    dependencies.createMessage ??
    ((request) => getAnthropicClient().messages.create(request));
  const runTool = dependencies.executeTool ?? executeAgentTool;
  const history = normalizeHistory(params.history);
  if (history.length !== params.history.length) {
    console.warn(
      `[VantixApp] agent-timing org=${params.ctx.organizationId} stage=history_trimmed dropped=${params.history.length - history.length}`
    );
  }
  const messages: MessageParam[] = [
    ...history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: params.userMessage },
  ];

  const startedAt = Date.now();
  const deadlineAt = startedAt + (params.deadlineMs ?? DEFAULT_DEADLINE_MS);
  const remainingMs = () => deadlineAt - Date.now();
  const minCallBudget = dependencies.budgets?.minCallMs ?? MIN_CALL_BUDGET_MS;
  const toolsMinBudget = dependencies.budgets?.toolsMinMs ?? TOOLS_MIN_BUDGET_MS;
  const org = params.ctx.organizationId;

  // Un saludo o un "gracias" no necesita herramientas: se responde en una sola
  // llamada, sin payload de tools y sin rondas extra.
  const smallTalk = isSmallTalk(params.userMessage);
  const availableTools = smallTalk ? [] : toolsForCapabilities(params.capabilities);

  let toolRounds = 0;
  let calls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let toolCallsCount = 0;
  while (true) {
    const budget = remainingMs();
    // Sin tiempo para otra llamada: se corta con un error visible en vez de
    // dejar que la función serverless muera a los 60 s.
    if (budget < minCallBudget) {
      console.warn(
        `[VantixApp] agent-timing org=${org} stage=deadline calls=${calls} rounds=${toolRounds} elapsed_ms=${Date.now() - startedAt}`
      );
      throw new AgentProviderError("deadline_exceeded");
    }

    // Se dejan de ofrecer tools al agotar las rondas o el presupuesto: así la
    // siguiente llamada devuelve texto sí o sí y el turno termina.
    const allowTools =
      availableTools.length > 0 &&
      toolRounds < MAX_TOOL_ROUNDS &&
      budget >= toolsMinBudget;
    const timeout = Math.min(PER_CALL_TIMEOUT_MS, budget);

    let response: Message;
    const callStartedAt = Date.now();
    calls += 1;
    try {
      response = await createMessage(
        {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: params.instructions,
          messages,
          tools: allowTools ? availableTools : [],
        },
        { timeout }
      );
    } catch (error) {
      const code = classifyAnthropicError(error);
      console.error(
        `[VantixApp] agent-timing org=${org} stage=llm_call n=${calls} ms=${Date.now() - callStartedAt} code=${code}`
      );
      throw new AgentProviderError(code);
    }
    console.info(
      `[VantixApp] agent-timing org=${org} stage=llm_call n=${calls} ms=${Date.now() - callStartedAt} tools_offered=${allowTools ? availableTools.length : 0} stop=${response.stop_reason} tokens_in=${response.usage.input_tokens} tokens_out=${response.usage.output_tokens}`
    );

    inputTokens += response.usage.input_tokens ?? 0;
    outputTokens += response.usage.output_tokens ?? 0;
    cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
    const toolUses = allowTools
      ? response.content.filter(
          (block): block is ToolUseBlock => block.type === "tool_use"
        )
      : [];

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = finalText(response);
      // Un texto no vacío es una respuesta válida aunque el motivo de parada
      // sea "max_tokens" (respuesta larga truncada) u otro distinto de
      // end_turn. Solo se considera error cuando no hay texto para el cliente.
      if (!reply) {
        throw new AgentProviderError("empty_response");
      }
      console.info(
        `[VantixApp] agent-timing org=${org} stage=total ms=${Date.now() - startedAt} calls=${calls} rounds=${toolRounds} tool_calls=${toolCallsCount} small_talk=${smallTalk}`
      );
      return {
        reply,
        humanTakeover: params.ctx.flags.humanTakeover,
        usage: {
          provider: "anthropic",
          model,
          inputTokens,
          outputTokens,
          cacheReadTokens: cacheReadTokens || undefined,
          cacheWriteTokens: cacheWriteTokens || undefined,
          toolCallsCount,
        },
      };
    }

    toolRounds += 1;
    toolCallsCount += toolUses.length;
    messages.push({ role: "assistant", content: assistantContent(response) });

    // En paralelo: varias herramientas en la misma ronda no dependen entre sí
    // y en serie sumaban su latencia (cada consulta a Google puede tardar ~1 s).
    const toolsStartedAt = Date.now();
    const toolResults: ToolResultBlockParam[] = await Promise.all(
      toolUses.map(async (toolUse) => {
        const content = await runTool(params.ctx, toolUse.name, toolUse.input);
        return {
          type: "tool_result" as const,
          tool_use_id: toolUse.id,
          content,
          ...(toolResultIsError(content) ? { is_error: true } : {}),
        };
      })
    );
    console.info(
      `[VantixApp] agent-timing org=${org} stage=tools round=${toolRounds} ms=${Date.now() - toolsStartedAt} count=${toolUses.length} names=${toolUses.map((t) => t.name).join(",")}`
    );
    messages.push({ role: "user", content: toolResults });
  }
}
