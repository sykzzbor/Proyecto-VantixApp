import type {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
  FunctionTool,
  Response,
} from "openai/resources/responses/responses";
import { getAgentModel, getOpenAIClient } from "@/server/agent/openai";
import {
  AGENT_TOOLS,
  executeAgentTool,
} from "@/server/agent/tools";
import type { AgentRunParams, AgentRunResult } from "@/server/agent/types";
import { TIENDANUBE_AGENT_TOOL_NAMES } from "@/server/integrations/tiendanube/agent-tools";
import { WOOCOMMERCE_AGENT_TOOL_NAMES } from "@/server/integrations/woocommerce/agent-tools";

const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 1200;

export const OPENAI_AGENT_TOOLS: FunctionTool[] = AGENT_TOOLS.map((tool) => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  strict: true,
  parameters: tool.inputSchema,
}));

const APPOINTMENT_TOOL_NAMES = new Set([
  "check_appointment_availability",
  "create_appointment",
  "reschedule_appointment",
  "cancel_appointment",
]);

export function openAiToolsForCapabilities(capabilities: AgentRunParams["capabilities"]): FunctionTool[] {
  if (!capabilities) return OPENAI_AGENT_TOOLS;
  return OPENAI_AGENT_TOOLS.filter((tool) => {
    if (APPOINTMENT_TOOL_NAMES.has(tool.name)) return capabilities.appointments === true;
    if (tool.name === "search_knowledge") return capabilities.knowledge === true;
    if (TIENDANUBE_AGENT_TOOL_NAMES.has(tool.name)) {
      return (capabilities.tiendanube ?? capabilities.commerce) === true;
    }
    if (WOOCOMMERCE_AGENT_TOOL_NAMES.has(tool.name)) {
      return (capabilities.woocommerce ?? capabilities.commerce) === true;
    }
    return true;
  });
}

export async function runOpenAIProvider(
  params: AgentRunParams
): Promise<AgentRunResult> {
  const client = getOpenAIClient();
  const model = getAgentModel();
  const baseRequest = {
    model,
    instructions: params.instructions,
    tools: openAiToolsForCapabilities(params.capabilities),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    ...(model.startsWith("gpt-5")
      ? { reasoning: { effort: "minimal" as const } }
      : {}),
  };
  const input: ResponseInput = [
    ...params.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    { role: "user" as const, content: params.userMessage },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let toolCallsCount = 0;
  const accumulate = (response: Response) => {
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
    cacheReadTokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
  };

  let response = await client.responses.create({ ...baseRequest, input });
  accumulate(response);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const toolCalls = response.output.filter(
      (item): item is ResponseFunctionToolCall => item.type === "function_call"
    );
    if (toolCalls.length === 0) break;
    toolCallsCount += toolCalls.length;

    const outputs: ResponseInputItem.FunctionCallOutput[] = [];
    for (const call of toolCalls) {
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: await executeAgentTool(params.ctx, call.name, call.arguments),
      });
    }

    response = await client.responses.create({
      ...baseRequest,
      previous_response_id: response.id,
      input: outputs,
    });
    accumulate(response);
  }

  console.info(
    `[VantixApp] agente ok provider=openai org=${params.ctx.organizationId} tokens_in=${inputTokens} tokens_out=${outputTokens}`
  );

  return {
    reply: response.output_text.trim(),
    humanTakeover: params.ctx.flags.humanTakeover,
    usage: {
      provider: "openai",
      model,
      inputTokens,
      outputTokens,
      cacheReadTokens: cacheReadTokens || undefined,
      toolCallsCount,
    },
  };
}
