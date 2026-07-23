export const TIENDANUBE_SCOPES = [
  "read_products",
  "read_customers",
  "read_orders",
] as const;

export const TIENDANUBE_WEBHOOK_EVENTS = [
  "product/created",
  "product/updated",
  "product/deleted",
  "order/created",
  "order/updated",
  "order/paid",
  "order/cancelled",
  "app/uninstalled",
  "app/suspended",
  "app/resumed",
] as const;

export const TIENDANUBE_REQUEST_TIMEOUT_MS = 10_000;
export const TIENDANUBE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const TIENDANUBE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const TIENDANUBE_MAX_SYNC_PAGES = 10;
export const TIENDANUBE_PAGE_SIZE = 100;

export class TiendanubeConfigurationError extends Error {
  constructor(message = "Tiendanube no está configurado.") {
    super(message);
    this.name = "TiendanubeConfigurationError";
  }
}

function required(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new TiendanubeConfigurationError(`Falta ${label}.`);
  return normalized;
}

export function getTiendanubeAppId(): string {
  const value = required(process.env.TIENDANUBE_APP_ID, "la aplicación de Tiendanube");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new TiendanubeConfigurationError("La aplicación de Tiendanube no es válida.");
  }
  return value;
}

export function getTiendanubeClientSecret(): string {
  return required(process.env.TIENDANUBE_CLIENT_SECRET, "la credencial privada de Tiendanube");
}

export function getTiendanubeAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.BETTER_AUTH_URL?.trim();
  let url: URL;
  try {
    url = new URL(required(raw, "la URL pública de VantixApp"));
  } catch (error) {
    if (error instanceof TiendanubeConfigurationError) throw error;
    throw new TiendanubeConfigurationError("La URL pública de VantixApp no es válida.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
    throw new TiendanubeConfigurationError("La URL pública de VantixApp debe usar HTTPS.");
  }
  return url.origin;
}

export function getTiendanubeRedirectUri(): string {
  return new URL("/api/integrations/tiendanube/callback", getTiendanubeAppUrl()).toString();
}

export function getTiendanubeWebhookUrl(): string {
  return new URL("/api/webhooks/tiendanube", getTiendanubeAppUrl()).toString();
}

export function getTiendanubeUserAgent(): string {
  return `VantixApp (${getTiendanubeAppUrl()})`;
}

export type TiendanubeConfigurationIssue = "oauth_credentials" | "application_url";

export function getTiendanubeConfigurationStatus():
  | { configured: true; issue: null; message: null }
  | { configured: false; issue: TiendanubeConfigurationIssue; message: string } {
  if (!process.env.TIENDANUBE_APP_ID?.trim() || !process.env.TIENDANUBE_CLIENT_SECRET?.trim()) {
    return {
      configured: false,
      issue: "oauth_credentials",
      message: "Falta completar la aplicación de Tiendanube.",
    };
  }
  try {
    getTiendanubeRedirectUri();
  } catch {
    return {
      configured: false,
      issue: "application_url",
      message: "Falta configurar una URL pública HTTPS válida.",
    };
  }
  return { configured: true, issue: null, message: null };
}
