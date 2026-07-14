/**
 * Constantes de la infraestructura de automatización (Etapa 6A).
 */

/** Versión del esquema del webhook enviado a n8n. */
export const AUTOMATION_SCHEMA_VERSION = 1;

/** Tipos de evento admitidos por el contrato versionado. */
export const AUTOMATION_EVENT_TYPES = [
  "conversation.handoff_requested",
  "conversation.followup_due",
  "conversation.closed",
  "customer.created",
  "whatsapp.message_failed",
  "knowledge.document_failed",
  "ai.provider_failed",
  "automation.test",
] as const;

export type AutomationEventType = (typeof AUTOMATION_EVENT_TYPES)[number];

export function isAutomationEventType(value: string): value is AutomationEventType {
  return (AUTOMATION_EVENT_TYPES as readonly string[]).includes(value);
}

/** Tope de tamaño del payload (defensa contra payloads gigantes). */
export const MAX_PAYLOAD_BYTES = 32 * 1024; // 32 KB

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Ventana de tolerancia para el timestamp de los callbacks (anti-replay). */
export const CALLBACK_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000; // 5 minutos

/** Un evento en PROCESSING más viejo que esto se considera "colgado" y se recupera. */
export const PROCESSING_STALE_MS = 5 * 60 * 1000; // 5 minutos

/** Cantidad de eventos que procesa cada corrida del dispatcher. */
export const DISPATCH_BATCH_SIZE = 20;

/** Backoff exponencial. */
export const BACKOFF_BASE_MS = 30_000; // 30 s
export const BACKOFF_MAX_MS = 60 * 60 * 1000; // 1 h
