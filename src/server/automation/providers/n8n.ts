import {
  getN8nWebhookSecret,
  getN8nWebhookUrl,
  getRequestTimeoutMs,
} from "@/server/automation/config";
import { signAutomationBody } from "@/server/automation/signature";
import type {
  AutomationWebhookPayload,
  DispatchResult,
} from "@/server/automation/types";
import type { AutomationProvider } from "@/server/automation/providers/provider";

/**
 * Envía el evento a n8n mediante un webhook firmado (HMAC SHA-256). La URL sale
 * SIEMPRE de la configuración del servidor (validada contra SSRF), nunca del
 * navegador. Los errores nunca exponen la respuesta cruda de n8n.
 */
export class N8nProvider implements AutomationProvider {
  readonly name = "n8n";

  async dispatch(payload: AutomationWebhookPayload): Promise<DispatchResult> {
    let url: URL;
    let secret: string;
    let timeoutMs: number;
    try {
      url = getN8nWebhookUrl();
      secret = getN8nWebhookSecret();
      timeoutMs = getRequestTimeoutMs();
    } catch {
      return {
        ok: false,
        retryable: false,
        errorCode: "not_configured",
        errorMessage: "n8n no está configurado.",
      };
    }

    const body = JSON.stringify(payload);
    const signature = signAutomationBody(body, secret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vantix-event-id": payload.eventId,
          "x-vantix-timestamp": String(payload.timestamp),
          "x-vantix-signature": signature,
          "x-vantix-schema-version": String(payload.schemaVersion),
        },
        body,
        signal: controller.signal,
        redirect: "error", // No seguir redirects (defensa SSRF).
      });

      if (response.ok) {
        return {
          ok: true,
          awaitingCallback: true,
          externalExecutionId: response.headers.get("x-n8n-execution-id"),
        };
      }
      // 5xx y 429 se reintentan; otros 4xx no.
      const retryable = response.status === 429 || response.status >= 500;
      return {
        ok: false,
        retryable,
        errorCode: `http_${response.status}`,
        errorMessage: `n8n respondió con estado ${response.status}.`,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        retryable: true,
        errorCode: isAbort ? "timeout" : "network_error",
        errorMessage: isAbort
          ? "Se agotó el tiempo de espera al contactar n8n."
          : "No se pudo contactar n8n.",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
