import type { AgentToolContext } from "@/server/agent/tools";

export type AgentHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentRunParams = {
  ctx: AgentToolContext;
  instructions: string;
  history: AgentHistoryMessage[];
  userMessage: string;
};

export type AgentUsage = {
  provider: "anthropic" | "openai";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  toolCallsCount: number;
};

export type AgentRunResult = {
  reply: string;
  humanTakeover: boolean;
  usage?: AgentUsage;
};

export type AgentProviderRunner = (
  params: AgentRunParams
) => Promise<AgentRunResult>;

export class AgentProviderError extends Error {
  constructor(
    public readonly code:
      | "not_configured"
      | "provider_error"
      | "empty_response"
      | "tool_round_limit"
  ) {
    super(code);
    this.name = "AgentProviderError";
  }
}
