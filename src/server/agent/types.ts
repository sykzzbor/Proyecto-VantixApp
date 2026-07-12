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

export type AgentRunResult = {
  reply: string;
  humanTakeover: boolean;
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
