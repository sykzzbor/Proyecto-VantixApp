import { normalizePublicOrigin } from "@/lib/public-domain";

export const WOOCOMMERCE_REQUEST_TIMEOUT_MS = 10_000;
export const WOOCOMMERCE_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const WOOCOMMERCE_MAX_SYNC_PAGES = 10;
export const WOOCOMMERCE_PAGE_SIZE = 100;
export const WOOCOMMERCE_MAX_VARIABLE_PRODUCTS = 200;

export const WOOCOMMERCE_WEBHOOK_TOPICS = [
  "product.created",
  "product.updated",
  "product.deleted",
  "customer.created",
  "customer.updated",
  "customer.deleted",
  "order.created",
  "order.updated",
  "order.deleted",
] as const;

export type WooCommerceConfigurationIssue = "application_url";

export class WooCommerceConfigurationError extends Error {
  constructor(message = "WooCommerce no está configurado.") {
    super(message);
    this.name = "WooCommerceConfigurationError";
  }
}

function isLocalHostname(hostname: string): boolean {
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

export function getWooCommerceAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim();
  if (!raw) {
    throw new WooCommerceConfigurationError(
      "Falta configurar la URL pública de VantixApp."
    );
  }
  let url: URL;
  try {
    const origin = normalizePublicOrigin(raw);
    if (!origin) throw new Error("invalid origin");
    url = new URL(origin);
  } catch {
    throw new WooCommerceConfigurationError(
      "La URL pública de VantixApp no es válida."
    );
  }
  if (
    url.protocol !== "https:" &&
    !(process.env.NODE_ENV !== "production" && isLocalHostname(url.hostname))
  ) {
    throw new WooCommerceConfigurationError(
      "La URL pública de VantixApp debe usar HTTPS."
    );
  }
  return url.origin;
}

export function getWooCommerceWebhookUrl(webhookKey: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(webhookKey)) {
    throw new WooCommerceConfigurationError("La conexión no es válida.");
  }
  return new URL(
    `/api/webhooks/woocommerce/${encodeURIComponent(webhookKey)}`,
    getWooCommerceAppUrl()
  ).toString();
}

export function getWooCommerceConfigurationStatus():
  | { configured: true; issue: null; message: null }
  | {
      configured: false;
      issue: WooCommerceConfigurationIssue;
      message: string;
    } {
  try {
    getWooCommerceAppUrl();
    return { configured: true, issue: null, message: null };
  } catch {
    return {
      configured: false,
      issue: "application_url",
      message: "Falta configurar una URL pública HTTPS válida.",
    };
  }
}
