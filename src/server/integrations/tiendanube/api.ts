import { z } from "zod";
import {
  TIENDANUBE_MAX_RESPONSE_BYTES,
  TIENDANUBE_MAX_SYNC_PAGES,
  TIENDANUBE_PAGE_SIZE,
  TIENDANUBE_REQUEST_TIMEOUT_MS,
  TIENDANUBE_SCOPES,
  TIENDANUBE_WEBHOOK_EVENTS,
  getTiendanubeAppId,
  getTiendanubeClientSecret,
  getTiendanubeUserAgent,
  getTiendanubeWebhookUrl,
} from "@/server/integrations/tiendanube/config";

const API_BASE = "https://api.tiendanube.com/v1";
const TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";
const idSchema = z.union([z.string().min(1).max(64), z.number().int().nonnegative()]).transform(String);
const nullableText = (max: number) => z.string().max(max).nullable().optional();
const localizedSchema = z.record(z.string().max(16), z.string().max(20_000)).optional().default({});

const tokenSchema = z.object({
  access_token: z.string().min(10).max(4096),
  token_type: z.string().max(40).optional(),
  scope: z.string().max(1000).optional(),
  user_id: idSchema,
}).passthrough();

const storeSchema = z.object({
  id: idSchema,
  name: localizedSchema,
  original_domain: nullableText(255),
  main_language: nullableText(16),
}).passthrough();

const variantSchema = z.object({
  id: idSchema,
  sku: nullableText(160),
  price: z.union([z.string(), z.number(), z.null()]).optional(),
  promotional_price: z.union([z.string(), z.number(), z.null()]).optional(),
  stock: z.union([z.number().int(), z.string(), z.null()]).optional(),
  stock_management: z.boolean().optional().default(false),
  values: z.array(localizedSchema).max(20).optional().default([]),
}).passthrough();

const productSchema = z.object({
  id: idSchema,
  name: localizedSchema,
  description: localizedSchema,
  handle: localizedSchema,
  published: z.boolean().optional().default(true),
  variants: z.array(variantSchema).max(1000).optional().default([]),
  created_at: nullableText(60),
  updated_at: nullableText(60),
}).passthrough();

const customerSchema = z.object({
  id: idSchema,
  name: nullableText(200),
  email: nullableText(254),
  phone: nullableText(40),
  total_spent: z.union([z.string(), z.number(), z.null()]).optional(),
  total_spent_currency: nullableText(8),
  active: z.boolean().nullable().optional(),
  created_at: nullableText(60),
  updated_at: nullableText(60),
}).passthrough();

const orderLineSchema = z.object({
  name: z.string().max(300).optional(),
  quantity: z.number().int().min(0).max(100_000).optional(),
  price: z.union([z.string(), z.number(), z.null()]).optional(),
  sku: nullableText(160),
}).passthrough();

const orderSchema = z.object({
  id: idSchema,
  number: z.union([z.string(), z.number()]).optional().transform((value) => value === undefined ? null : String(value)),
  status: z.string().min(1).max(80),
  payment_status: nullableText(80),
  shipping_status: nullableText(80),
  currency: nullableText(8),
  total: z.union([z.string(), z.number(), z.null()]).optional(),
  customer: z.object({ id: idSchema.optional(), name: nullableText(200) }).passthrough().nullable().optional(),
  products: z.array(orderLineSchema).max(500).optional().default([]),
  created_at: nullableText(60),
  updated_at: nullableText(60),
}).passthrough();

const webhookSchema = z.object({
  id: idSchema,
  event: z.string().max(80),
  url: z.string().url().max(1000),
}).passthrough();

export type TiendanubeTokens = {
  accessToken: string;
  storeId: string;
  scopes: string[];
};
export type TiendanubeStore = z.infer<typeof storeSchema>;
export type TiendanubeProductRemote = z.infer<typeof productSchema>;
export type TiendanubeCustomerRemote = z.infer<typeof customerSchema>;
export type TiendanubeOrderRemote = z.infer<typeof orderSchema>;

export type TiendanubeErrorCode =
  | "not_configured"
  | "authorization_expired"
  | "permission_denied"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "remote_unavailable"
  | "invalid_response"
  | "invalid_request"
  | "not_found";

export class TiendanubeApiError extends Error {
  constructor(
    readonly code: TiendanubeErrorCode,
    readonly safeMessage: string,
    readonly retryable = false
  ) {
    super(safeMessage);
    this.name = "TiendanubeApiError";
  }
}

function statusError(status: number, context: string): TiendanubeApiError {
  console.error(`[VantixApp] Tiendanube endpoint=${context} status=${status}`);
  if (status === 401) return new TiendanubeApiError("authorization_expired", "La autorización de Tiendanube ya no es válida. Reconectá la tienda.");
  if (status === 403) return new TiendanubeApiError("permission_denied", "Tiendanube no autorizó esta operación.");
  if (status === 404) return new TiendanubeApiError("not_found", "No encontramos el recurso solicitado en Tiendanube.");
  if (status === 429) return new TiendanubeApiError("rate_limited", "Tiendanube limitó temporalmente las solicitudes.", true);
  if (status >= 500) return new TiendanubeApiError("remote_unavailable", "Tiendanube no está disponible temporalmente.", true);
  return new TiendanubeApiError("invalid_request", "Tiendanube rechazó la solicitud.");
}

async function readJsonLimited(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > TIENDANUBE_MAX_RESPONSE_BYTES) {
    throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió una respuesta demasiado grande.");
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > TIENDANUBE_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió una respuesta demasiado grande.");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as unknown;
  } catch {
    throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió una respuesta no válida.");
  }
}

async function remoteFetch(
  input: { url: string; context: string; method?: "GET" | "POST"; headers?: Record<string, string>; body?: string; retries?: number },
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const retries = Math.min(Math.max(input.retries ?? 0, 0), 1);
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIENDANUBE_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(input.url, {
        method: input.method ?? "GET",
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) {
        const error = statusError(response.status, input.context);
        if (error.retryable && attempt < retries) continue;
        throw error;
      }
      if (response.status === 204) return null;
      return await readJsonLimited(response);
    } catch (error) {
      if (error instanceof TiendanubeApiError) throw error;
      const safe = controller.signal.aborted
        ? new TiendanubeApiError("timeout", "Tiendanube no respondió a tiempo.", true)
        : new TiendanubeApiError("network_error", "No se pudo conectar con Tiendanube.", true);
      if (attempt < retries) continue;
      throw safe;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function apiHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=utf-8",
    "User-Agent": getTiendanubeUserAgent(),
  };
}

function resourceUrl(storeId: string, path: string): string {
  if (!/^\d{1,30}$/.test(storeId)) throw new TiendanubeApiError("invalid_request", "La tienda no es válida.");
  return `${API_BASE}/${encodeURIComponent(storeId)}/${path.replace(/^\//, "")}`;
}

function parseList<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió datos no válidos.");
  return parsed.data;
}

export function buildTiendanubeAuthUrl(state: string): string {
  const url = new URL(`https://www.tiendanube.com/apps/${encodeURIComponent(getTiendanubeAppId())}/authorize`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeTiendanubeCode(code: string, fetchImpl?: typeof fetch): Promise<TiendanubeTokens> {
  const raw = await remoteFetch({
    url: TOKEN_URL,
    context: "oauth_token",
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", "User-Agent": getTiendanubeUserAgent() },
    body: JSON.stringify({
      client_id: getTiendanubeAppId(),
      client_secret: getTiendanubeClientSecret(),
      grant_type: "authorization_code",
      code,
    }),
  }, fetchImpl);
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió una autorización no válida.");
  const scopes = (parsed.data.scope ?? "").split(/[\s,]+/).filter(Boolean);
  return { accessToken: parsed.data.access_token, storeId: parsed.data.user_id, scopes };
}

export async function getTiendanubeStore(accessToken: string, storeId: string, fetchImpl?: typeof fetch): Promise<TiendanubeStore> {
  const raw = await remoteFetch({
    url: resourceUrl(storeId, "store?fields=id,name,original_domain,main_language"),
    context: "store",
    headers: apiHeaders(accessToken),
    retries: 1,
  }, fetchImpl);
  const parsed = storeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== storeId) {
    throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió una tienda no válida.");
  }
  return parsed.data;
}

async function listAll<T>(input: {
  accessToken: string;
  storeId: string;
  resource: string;
  context: string;
  schema: z.ZodType<T>;
  fetchImpl?: typeof fetch;
}): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= TIENDANUBE_MAX_SYNC_PAGES; page += 1) {
    const query = new URLSearchParams({ page: String(page), per_page: String(TIENDANUBE_PAGE_SIZE) });
    const raw = await remoteFetch({
      url: resourceUrl(input.storeId, `${input.resource}?${query}`),
      context: input.context,
      headers: apiHeaders(input.accessToken),
      retries: 1,
    }, input.fetchImpl);
    const rows = parseList(raw, input.schema);
    result.push(...rows);
    if (rows.length < TIENDANUBE_PAGE_SIZE) return result;
  }
  throw new TiendanubeApiError("invalid_response", "La tienda supera el límite seguro de sincronización. Contactá a soporte.");
}

export function listTiendanubeProducts(accessToken: string, storeId: string, fetchImpl?: typeof fetch) {
  return listAll({ accessToken, storeId, resource: "products", context: "products", schema: productSchema, fetchImpl });
}
export function listTiendanubeCustomers(accessToken: string, storeId: string, fetchImpl?: typeof fetch) {
  return listAll({ accessToken, storeId, resource: "customers", context: "customers", schema: customerSchema, fetchImpl });
}
export function listTiendanubeOrders(accessToken: string, storeId: string, fetchImpl?: typeof fetch) {
  return listAll({ accessToken, storeId, resource: "orders", context: "orders", schema: orderSchema, fetchImpl });
}

export async function getTiendanubeProduct(accessToken: string, storeId: string, id: string, fetchImpl?: typeof fetch) {
  const raw = await remoteFetch({ url: resourceUrl(storeId, `products/${encodeURIComponent(id)}`), context: "product", headers: apiHeaders(accessToken), retries: 1 }, fetchImpl);
  const parsed = productSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== id) throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió un producto no válido.");
  return parsed.data;
}

export async function getTiendanubeOrder(accessToken: string, storeId: string, id: string, fetchImpl?: typeof fetch) {
  const raw = await remoteFetch({ url: resourceUrl(storeId, `orders/${encodeURIComponent(id)}`), context: "order", headers: apiHeaders(accessToken), retries: 1 }, fetchImpl);
  const parsed = orderSchema.safeParse(raw);
  if (!parsed.success || parsed.data.id !== id) throw new TiendanubeApiError("invalid_response", "Tiendanube devolvió un pedido no válido.");
  return parsed.data;
}

export async function ensureTiendanubeWebhooks(accessToken: string, storeId: string, fetchImpl?: typeof fetch): Promise<void> {
  const raw = await remoteFetch({ url: resourceUrl(storeId, "webhooks"), context: "webhooks_list", headers: apiHeaders(accessToken), retries: 1 }, fetchImpl);
  const existing = parseList(raw, webhookSchema);
  const webhookUrl = getTiendanubeWebhookUrl();
  const current = new Set(existing.filter((item) => item.url === webhookUrl).map((item) => item.event));
  for (const event of TIENDANUBE_WEBHOOK_EVENTS) {
    if (current.has(event)) continue;
    await remoteFetch({
      url: resourceUrl(storeId, "webhooks"),
      context: "webhook_create",
      method: "POST",
      headers: apiHeaders(accessToken),
      body: JSON.stringify({ event, url: webhookUrl }),
    }, fetchImpl);
  }
}

export function hasRequiredTiendanubeScopes(scopes: readonly string[]): boolean {
  return TIENDANUBE_SCOPES.every((scope) => scopes.includes(scope));
}
