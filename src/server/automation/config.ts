import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "@/server/automation/constants";

/**
 * Configuración de la automatización. Todos los secretos viven SOLO en el
 * servidor (variables de entorno). La URL de n8n nunca proviene del navegador.
 */

export type AutomationProviderMode = "mock" | "n8n";

export class AutomationConfigurationError extends Error {
  constructor(message = "La configuración de automatización no está completa.") {
    super(message);
    this.name = "AutomationConfigurationError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new AutomationConfigurationError(`Falta la variable ${name}.`);
  return value;
}

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Proveedor activo. Por defecto `mock` para no exigir una cuenta de n8n. */
export function getAutomationProviderMode(): AutomationProviderMode {
  return process.env.AUTOMATION_PROVIDER?.trim().toLowerCase() === "n8n"
    ? "n8n"
    : "mock";
}

export function getMaxAttempts(): number {
  const raw = Number(process.env.AUTOMATION_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw >= 1 && raw <= 20
    ? Math.floor(raw)
    : DEFAULT_MAX_ATTEMPTS;
}

export function getRequestTimeoutMs(): number {
  const raw = Number(process.env.AUTOMATION_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 1000 && raw <= 60_000
    ? Math.floor(raw)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

export function getN8nWebhookSecret(): string {
  return requireEnv("N8N_WEBHOOK_SECRET");
}

export function getN8nCallbackSecret(): string {
  return requireEnv("N8N_CALLBACK_SECRET");
}

export function getCronSecret(): string {
  return requireEnv("AUTOMATION_CRON_SECRET");
}

/** Estado seguro para UI: nunca devuelve nombres ni valores de credenciales. */
export function isDispatcherConfigured(): boolean {
  try {
    getCronSecret();
    return true;
  } catch {
    return false;
  }
}

/** Estado seguro para UI: nunca devuelve nombres ni valores de credenciales. */
export function isCallbackConfigured(): boolean {
  try {
    getN8nCallbackSecret();
    return true;
  } catch {
    return false;
  }
}

/** Bloques de red privados / loopback que no deben ser destino del webhook (SSRF). */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  // IPv4 privados y loopback.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  // IPv6 loopback / ULA.
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  return false;
}

/**
 * URL del webhook de n8n, validada contra SSRF. Debe ser HTTPS (o HTTP solo en
 * desarrollo) y nunca apuntar a una red privada/loopback en producción.
 */
export function getN8nWebhookUrl(): URL {
  const raw = requireEnv("N8N_WEBHOOK_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AutomationConfigurationError("N8N_WEBHOOK_URL no es una URL válida.");
  }
  const httpsOk = url.protocol === "https:";
  const httpDevOk = url.protocol === "http:" && isDev();
  if (!httpsOk && !httpDevOk) {
    throw new AutomationConfigurationError("N8N_WEBHOOK_URL debe usar HTTPS.");
  }
  if (!isDev() && isPrivateHostname(url.hostname)) {
    throw new AutomationConfigurationError(
      "N8N_WEBHOOK_URL no puede apuntar a una red privada o loopback."
    );
  }
  return url;
}

/** Indica si n8n está configurado sin exponer los valores. */
export function isN8nConfigured(): boolean {
  try {
    getN8nWebhookUrl();
    getN8nWebhookSecret();
    getN8nCallbackSecret();
    return true;
  } catch {
    return false;
  }
}
