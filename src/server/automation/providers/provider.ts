import type {
  AutomationWebhookPayload,
  DispatchResult,
} from "@/server/automation/types";

/** Contrato de un proveedor de automatización (n8n real o mock). */
export interface AutomationProvider {
  readonly name: string;
  dispatch(payload: AutomationWebhookPayload): Promise<DispatchResult>;
}
