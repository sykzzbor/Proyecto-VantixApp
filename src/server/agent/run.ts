import type {
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
} from "openai/resources/responses/responses";
import { getAgentModel, getOpenAIClient } from "@/server/agent/openai";
import {
  AGENT_TOOLS,
  executeAgentTool,
  type AgentToolContext,
} from "@/server/agent/tools";

/** Rondas máximas de herramientas por mensaje (control de costos). */
const MAX_TOOL_ROUNDS = 4;
const MAX_OUTPUT_TOKENS = 1200;

export type AgentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentRunResult = {
  reply: string;
  humanTakeover: boolean;
};

/** Error controlado del agente: el endpoint lo traduce a una respuesta genérica. */
export class AgentRunError extends Error {}

export async function runAgent(params: {
  ctx: AgentToolContext;
  instructions: string;
  history: AgentHistoryMessage[];
  userMessage: string;
}): Promise<AgentRunResult> {
  const client = getOpenAIClient();
  const model = getAgentModel();

  const baseRequest = {
    model,
    instructions: params.instructions,
    tools: AGENT_TOOLS,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    // En modelos con razonamiento, el esfuerzo mínimo alcanza para este
    // caso de uso y reduce costo y latencia.
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

  try {
    let response = await client.responses.create({ ...baseRequest, input });

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const toolCalls = response.output.filter(
        (item): item is ResponseFunctionToolCall => item.type === "function_call"
      );
      if (toolCalls.length === 0) break;

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
    }

    // Registro básico de uso, sin contenido ni datos sensibles.
    console.info(
      `[VantixApp] agente ok org=${params.ctx.organizationId} tokens_in=${response.usage?.input_tokens ?? "?"} tokens_out=${response.usage?.output_tokens ?? "?"}`
    );

    return {
      reply: response.output_text.trim(),
      humanTakeover: params.ctx.flags.humanTakeover,
    };
  } catch (error) {
    // Nunca registrar claves ni payloads: solo el tipo de error.
    console.error(
      "[VantixApp] Error de OpenAI:",
      error instanceof Error ? `${error.name}: ${error.message}` : "desconocido"
    );
    throw new AgentRunError("No se pudo generar la respuesta del agente.");
  }
}
