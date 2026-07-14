import type { AutomationEventType } from "@/server/automation/constants";

export type AutomationEventInput = {
  organizationId: string;
  type: AutomationEventType | string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
};

export type EmitResult =
  | { ok: true; eventId: string; duplicate: boolean }
  | { ok: false; error: string; code: EmitErrorCode };

export type EmitErrorCode =
  | "organization_not_found"
  | "invalid_type"
  | "invalid_payload"
  | "payload_too_large"
  | "internal_error";

/** Resultado del envío del evento al proveedor (n8n o mock). */
export type DispatchResult =
  | {
      ok: true;
      /** Si true, el resultado final llega por callback; si false, ya terminó. */
      awaitingCallback: boolean;
      externalExecutionId?: string | null;
      responseMeta?: Record<string, unknown> | null;
    }
  | {
      ok: false;
      retryable: boolean;
      errorCode: string;
      errorMessage: string;
    };

/** Cuerpo exacto que se firma y envía a n8n. */
export type AutomationWebhookPayload = {
  eventId: string;
  runId: string;
  organizationId: string;
  type: string;
  timestamp: number;
  schemaVersion: number;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type CallbackStatus = "succeeded" | "failed";

export type CallbackInput = {
  eventId: string;
  runId: string;
  organizationId: string;
  timestamp: number;
  status: CallbackStatus;
  externalExecutionId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  responseMeta?: Record<string, unknown> | null;
};
