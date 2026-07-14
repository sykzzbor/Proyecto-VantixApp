import type {
  AutomationWebhookPayload,
  DispatchResult,
} from "@/server/automation/types";
import type { AutomationProvider } from "@/server/automation/providers/provider";

export type MockMode =
  | "success"
  | "temporary_error"
  | "permanent_error"
  | "callback";

function readMockMode(payload: AutomationWebhookPayload): MockMode {
  const raw = payload.payload?.["mock"];
  if (
    raw === "temporary_error" ||
    raw === "permanent_error" ||
    raw === "callback" ||
    raw === "success"
  ) {
    return raw;
  }
  return "success";
}

/**
 * Proveedor simulado para probar toda la infraestructura sin una cuenta de n8n.
 * El modo se controla con `payload.mock`.
 */
export class MockProvider implements AutomationProvider {
  readonly name = "mock";

  async dispatch(payload: AutomationWebhookPayload): Promise<DispatchResult> {
    switch (readMockMode(payload)) {
      case "temporary_error":
        return {
          ok: false,
          retryable: true,
          errorCode: "mock_temporary",
          errorMessage: "Error temporal simulado.",
        };
      case "permanent_error":
        return {
          ok: false,
          retryable: false,
          errorCode: "mock_permanent",
          errorMessage: "Error definitivo simulado.",
        };
      case "callback":
        // n8n aceptó; el resultado llegará por un callback firmado posterior.
        return {
          ok: true,
          awaitingCallback: true,
          externalExecutionId: `mock-${payload.eventId}`,
        };
      case "success":
      default:
        // Éxito completo simulado (ejecución + callback exitoso colapsados).
        return {
          ok: true,
          awaitingCallback: false,
          externalExecutionId: `mock-${payload.eventId}`,
          responseMeta: { simulated: true },
        };
    }
  }
}
