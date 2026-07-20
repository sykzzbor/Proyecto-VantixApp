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

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 1200;

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
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 1,
    });
    clientKey = apiKey;
  }
  return client;
}

export type AnthropicMessageCreator = (
  request: MessageCreateParamsNonStreaming
) => Promise<Message>;

type AnthropicProviderDependencies = {
  createMessage?: AnthropicMessageCreator;
  executeTool?: (
    ctx: AgentToolContext,
    name: string,
    input: unknown
  ) => Promise<string>;
  model?: string;
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
  const messages: MessageParam[] = [
    ...params.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user", content: params.userMessage },
  ];

  let toolRounds = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let toolCallsCount = 0;
  while (true) {
    // Al agotar las rondas de herramientas se fuerza una respuesta de texto
    // (sin tools) en vez de cortar la conversación con un error: el cliente
    // igual recibe una respuesta útil.
    const allowTools = toolRounds < MAX_TOOL_ROUNDS;
    let response: Message;
    try {
      response = await createMessage({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: params.instructions,
        messages,
        tools: allowTools ? ANTHROPIC_AGENT_TOOLS : [],
      });
    } catch (error) {
      // Cualquier error del SDK se traduce a un código seguro (sin datos).
      throw new AgentProviderError(classifyAnthropicError(error));
    }
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
        `[VantixApp] agente ok provider=anthropic org=${params.ctx.organizationId} stop=${response.stop_reason} tokens_in=${response.usage.input_tokens} tokens_out=${response.usage.output_tokens}`
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

    const toolResults: ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      const content = await runTool(
        params.ctx,
        toolUse.name,
        toolUse.input
      );
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content,
        ...(toolResultIsError(content) ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: toolResults });
  }
}
