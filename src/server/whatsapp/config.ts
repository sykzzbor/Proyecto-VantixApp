import { isIP } from "node:net";
import { normalizePublicOrigin } from "@/lib/public-domain";

const GRAPH_API_VERSION_PATTERN = /^v\d{1,3}\.\d{1,2}$/;
const META_PUBLIC_ID_PATTERN = /^\d{5,32}$/;
const ENCRYPTION_KEY_PATTERN = /^(?:[a-fA-F0-9]{64}|[A-Za-z0-9+/]{43}=?)$/;
const META_WEBHOOK_PATH = "/api/webhooks/whatsapp";
const YCLOUD_WEBHOOK_PATH = "/api/webhooks/ycloud";

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

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** Evita declarar operativo un webhook que Meta no puede alcanzar. */
function isPrivateOrLoopbackHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  const ipVersion = isIP(host);
  if (
    isLoopbackHostname(host) ||
    host === "0.0.0.0" ||
    host === "::" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  if (ipVersion === 0 && !host.includes(".")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    host
  );
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [first, second] = octets;
    if (first === 0 || first === 10 || first === 127 || first! >= 224) {
      return true;
    }
    if (first === 100 && second! >= 64 && second! <= 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 172 && second! >= 16 && second! <= 31) return true;
    if (first === 192 && second === 168) return true;
    if (first === 198 && (second === 18 || second === 19)) return true;
  }

  // Loopback, ULA, link-local e IPv4-mapped IPv6.
  return ipVersion === 6 && (
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    /^fe[89ab]/.test(host) ||
    host.startsWith("::ffff:")
  );
}

export function getWhatsappVerifyToken(): string {
  return requireServerEnv("WHATSAPP_VERIFY_TOKEN");
}

export function getMetaAppSecret(): string {
  const secret = requireServerEnv("META_APP_SECRET");
  if (secret.length < 16 || secret.length > 512) {
    throw new WhatsappConfigurationError();
  }
  return secret;
}

export function getYCloudWebhookSecret(): string {
  const secret = requireServerEnv("YCLOUD_WEBHOOK_SECRET");
  if (secret.length < 16 || secret.length > 512) {
    throw new WhatsappConfigurationError();
  }
  return secret;
}

export function getMetaAppId(): string {
  const appId = requireServerEnv("META_APP_ID");
  if (!META_PUBLIC_ID_PATTERN.test(appId)) {
    throw new WhatsappConfigurationError(
      "La aplicación de Meta configurada no es válida."
    );
  }
  return appId;
}

export function getMetaEmbeddedSignupConfigurationId(): string {
  const configurationId = requireServerEnv(
    "META_EMBEDDED_SIGNUP_CONFIG_ID"
  );
  if (!META_PUBLIC_ID_PATTERN.test(configurationId)) {
    throw new WhatsappConfigurationError(
      "La configuración de Embedded Signup no es válida."
    );
  }
  return configurationId;
}

export function getCredentialsEncryptionKey(): string {
  const key = requireServerEnv("CREDENTIALS_ENCRYPTION_KEY");
  if (!ENCRYPTION_KEY_PATTERN.test(key)) {
    throw new WhatsappConfigurationError();
  }
  return key;
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

export type MetaEmbeddedSignupMissingCategory =
  | "meta_application"
  | "embedded_signup_configuration";

/** Estado público seguro: solo expone identificadores que Meta declara públicos. */
export function getMetaEmbeddedSignupPublicConfiguration() {
  let appId: string | null = null;
  let configurationId: string | null = null;
  let graphApiVersion: string | null = null;
  const missingCategories: MetaEmbeddedSignupMissingCategory[] = [];

  try {
    appId = getMetaAppId();
    getMetaAppSecret();
    getCredentialsEncryptionKey();
    graphApiVersion = getMetaGraphApiVersion();
  } catch {
    missingCategories.push("meta_application");
  }

  try {
    configurationId = getMetaEmbeddedSignupConfigurationId();
  } catch {
    missingCategories.push("embedded_signup_configuration");
  }

  return {
    available: missingCategories.length === 0,
    appId,
    configurationId,
    graphApiVersion,
    missingCategories,
  };
}

/** Confirma solo preparación local; no afirma que Meta ya envió un webhook. */
export function isWhatsappWebhookRuntimeConfigured(): boolean {
  try {
    getWhatsappVerifyToken();
    getMetaAppSecret();
    getWhatsappWebhookUrl();
    return true;
  } catch {
    return false;
  }
}

export function isYCloudWebhookRuntimeConfigured(): boolean {
  try {
    getYCloudWebhookSecret();
    getYCloudWebhookUrl();
    return true;
  } catch {
    return false;
  }
}

export function isWhatsappDevMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.WHATSAPP_DEV_MODE?.trim().toLowerCase() === "true"
  );
}

function getPublicWebhookUrl(path: string): string {
  const baseUrl = normalizePublicOrigin(process.env.BETTER_AUTH_URL);
  if (!baseUrl) throw new WhatsappConfigurationError();

  try {
    const url = new URL(path, baseUrl);
    const localDevelopmentHttp =
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      isLoopbackHostname(url.hostname);
    if (url.protocol !== "https:" && !localDevelopmentHttp) {
      throw new Error("invalid protocol");
    }
    if (
      process.env.NODE_ENV === "production" &&
      isPrivateOrLoopbackHostname(url.hostname)
    ) {
      throw new Error("private host");
    }
    return url.toString();
  } catch {
    throw new WhatsappConfigurationError(
      "La URL publica de la aplicacion no es valida."
    );
  }
}

export function getWhatsappWebhookUrl(): string {
  return getPublicWebhookUrl(META_WEBHOOK_PATH);
}

export function getYCloudWebhookUrl(): string {
  return getPublicWebhookUrl(YCLOUD_WEBHOOK_PATH);
}
