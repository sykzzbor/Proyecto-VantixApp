import {
  getN8nConfigurationFingerprint,
  getN8nConfigurationState,
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
import { prisma } from "@/lib/prisma";

const CONNECTION_PROBE_SOURCE = "connection-test";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Identifica el único evento que puede probar n8n antes de activar el proveedor.
 * La forma es intencionalmente estricta para que el bypass nunca alcance eventos
 * con datos o side effects reales.
 */
export function isN8nConnectionProbeEvent(input: {
  type: string;
  payload: unknown;
}): boolean {
  if (input.type !== "automation.test" || !isRecord(input.payload)) return false;
  const keys = Object.keys(input.payload).sort();
  return (
    keys.length === 2 &&
    keys[0] === "configurationFingerprint" &&
    keys[1] === "source" &&
    input.payload.source === CONNECTION_PROBE_SOURCE &&
    typeof input.payload.configurationFingerprint === "string" &&
    /^[a-f0-9]{64}$/.test(input.payload.configurationFingerprint)
  );
}

export function getN8nConnectionProbeFingerprint(input: {
  type: string;
  payload: unknown;
}): string | null {
  return isN8nConnectionProbeEvent(input) && isRecord(input.payload)
    ? (input.payload.configurationFingerprint as string)
    : null;
}

export function canDispatchN8nEvent(input: {
  connectionProbe: boolean;
  allowUnverifiedProbe: boolean;
  organizationReady: boolean;
}): boolean {
  return input.connectionProbe
    ? input.allowUnverifiedProbe
    : input.organizationReady;
}

/** Readiness persistida: solo un callback exitoso del probe puede habilitarla. */
export async function isN8nOrganizationReady(
  organizationId: string
): Promise<boolean> {
  const connection = await prisma.integrationConnection.findUnique({
    where: {
      organizationId_provider: { organizationId, provider: "n8n" },
    },
    select: {
      enabled: true,
      status: true,
      lastCallbackAt: true,
      externalId: true,
    },
  });
  const currentFingerprint = getN8nConfigurationFingerprint();
  return Boolean(
    connection?.enabled &&
      connection.status === "CONNECTED" &&
      connection.lastCallbackAt &&
      currentFingerprint &&
      connection.externalId === currentFingerprint
  );
}

async function recordConnectionResult(input: {
  organizationId: string;
  sent: boolean;
  errorCode?: string;
}) {
  try {
    const now = new Date();
    await prisma.integrationConnection.upsert({
      where: {
        organizationId_provider: {
          organizationId: input.organizationId,
          provider: "n8n",
        },
      },
      create: {
        organizationId: input.organizationId,
        provider: "n8n",
        enabled: false,
        // Un HTTP 2xx solo confirma recepción; la conexión queda habilitada
        // exclusivamente cuando vuelve el callback firmado del probe.
        status: input.sent ? "DISCONNECTED" : "ERROR",
        lastEventAt: input.sent ? now : null,
        lastError: input.sent ? null : input.errorCode?.slice(0, 120),
      },
      update: {
        ...(input.sent ? { lastEventAt: now } : {}),
        lastError: input.sent ? null : input.errorCode?.slice(0, 120),
      },
    });
    if (input.sent) {
      await prisma.integrationConnection.updateMany({
        where: {
          organizationId: input.organizationId,
          provider: "n8n",
          enabled: false,
        },
        data: { status: "DISCONNECTED" },
      });
    } else {
      // Una conexión ya verificada conserva su readiness para poder reintentar
      // fallos transitorios. Antes del primer callback sí refleja ERROR.
      await prisma.integrationConnection.updateMany({
        where: {
          organizationId: input.organizationId,
          provider: "n8n",
          enabled: false,
        },
        data: { status: "ERROR" },
      });
    }
  } catch {
    // La telemetría nunca cambia el resultado real del dispatch.
  }
}

type N8nProviderOptions = {
  allowUnverifiedProbe?: boolean;
};

/**
 * Envía el evento a n8n mediante un webhook firmado (HMAC SHA-256). La URL sale
 * SIEMPRE de la configuración del servidor (validada contra SSRF), nunca del
 * navegador. Los errores nunca exponen la respuesta cruda de n8n.
 */
export class N8nProvider implements AutomationProvider {
  readonly name = "n8n";
  private readonly allowUnverifiedProbe: boolean;

  constructor(options: N8nProviderOptions = {}) {
    this.allowUnverifiedProbe = options.allowUnverifiedProbe === true;
  }

  async dispatch(payload: AutomationWebhookPayload): Promise<DispatchResult> {
    const connectionProbe = isN8nConnectionProbeEvent(payload);
    const organizationReady = connectionProbe
      ? false
      : await isN8nOrganizationReady(payload.organizationId);
    if (
      !canDispatchN8nEvent({
        connectionProbe,
        allowUnverifiedProbe: this.allowUnverifiedProbe,
        organizationReady,
      })
    ) {
      return {
        ok: false,
        retryable: true,
        errorCode: connectionProbe
          ? "invalid_connection_probe"
          : "integration_not_verified",
        errorMessage: connectionProbe
          ? "La prueba de conexión no fue autorizada."
          : "La conexión con n8n todavía no fue verificada.",
      };
    }

    let url: URL;
    let secret: string;
    let timeoutMs: number;
    try {
      // El probe también exige que toda la preparación del runtime esté lista.
      // La ruta de prueba devuelve las categorías seguras antes de llegar aquí.
      if (!getN8nConfigurationState().complete) {
        throw new Error("incomplete_configuration");
      }
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
        await recordConnectionResult({
          organizationId: payload.organizationId,
          sent: true,
        });
        return {
          ok: true,
          awaitingCallback: true,
          externalExecutionId: response.headers.get("x-n8n-execution-id"),
        };
      }
      // 5xx y 429 se reintentan; otros 4xx no.
      const retryable = response.status === 429 || response.status >= 500;
      await recordConnectionResult({
        organizationId: payload.organizationId,
        sent: false,
        errorCode: `http_${response.status}`,
      });
      return {
        ok: false,
        retryable,
        errorCode: `http_${response.status}`,
        errorMessage: `n8n respondió con estado ${response.status}.`,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      await recordConnectionResult({
        organizationId: payload.organizationId,
        sent: false,
        errorCode: isAbort ? "timeout" : "network_error",
      });
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
