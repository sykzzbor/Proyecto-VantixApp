const GRAPH_API_VERSION_PATTERN = /^v\d{1,3}\.\d{1,2}$/;
const WEBHOOK_PATH = "/api/webhooks/whatsapp";

export const META_REQUEST_TIMEOUT_MS = 10_000;

export class WhatsappConfigurationError extends Error {
  constructor(message = "La configuracion de WhatsApp no esta completa.") {
    super(message);
    this.name = "WhatsappConfigurationError";
  }
}

function requireServerEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new WhatsappConfigurationError();
  }
  return value;
}

export function getWhatsappVerifyToken(): string {
  return requireServerEnv("WHATSAPP_VERIFY_TOKEN");
}

export function getMetaAppSecret(): string {
  return requireServerEnv("META_APP_SECRET");
}

export function getCredentialsEncryptionKey(): string {
  return requireServerEnv("CREDENTIALS_ENCRYPTION_KEY");
}

export function getMetaGraphApiVersion(): string {
  const version = requireServerEnv("META_GRAPH_API_VERSION");
  if (!GRAPH_API_VERSION_PATTERN.test(version)) {
    throw new WhatsappConfigurationError(
      "La version configurada de Meta Graph API no es valida."
    );
  }
  return version;
}

export function getMetaGraphApiBaseUrl(): string {
  return `https://graph.facebook.com/${getMetaGraphApiVersion()}`;
}

export function isWhatsappDevMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.WHATSAPP_DEV_MODE?.trim().toLowerCase() === "true"
  );
}

export function getWhatsappWebhookUrl(): string {
  const baseUrl = process.env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) throw new WhatsappConfigurationError();

  try {
    const url = new URL(WEBHOOK_PATH, baseUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("invalid protocol");
    }
    return url.toString();
  } catch {
    throw new WhatsappConfigurationError(
      "La URL publica de la aplicacion no es valida."
    );
  }
}
