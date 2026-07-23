import { isIP } from "node:net";
import { z } from "zod";
import {
  WOOCOMMERCE_MAX_RESPONSE_BYTES,
  WOOCOMMERCE_MAX_SYNC_PAGES,
  WOOCOMMERCE_MAX_VARIABLE_PRODUCTS,
  WOOCOMMERCE_PAGE_SIZE,
  WOOCOMMERCE_REQUEST_TIMEOUT_MS,
  WOOCOMMERCE_WEBHOOK_TOPICS,
  getWooCommerceWebhookUrl,
} from "@/server/integrations/woocommerce/config";

const idSchema = z.number().int().nonnegative().transform(String);
const nullableText = (max: number) =>
  z.string().max(max).nullable().optional();
const moneySchema = z.union([z.string(), z.number(), z.null()]).optional();
const dateSchema = nullableText(60);

const attributeSchema = z
  .object({
    name: z.string().max(160).optional(),
    option: z.string().max(300).optional(),
    options: z.array(z.string().max(300)).max(100).optional(),
  })
  .passthrough();

const variationSchema = z
  .object({
    id: idSchema,
    sku: nullableText(160),
    price: moneySchema,
    regular_price: moneySchema,
    sale_price: moneySchema,
    manage_stock: z.boolean().optional().default(false),
    stock_quantity: z.number().int().nullable().optional(),
    attributes: z.array(attributeSchema).max(100).optional().default([]),
  })
  .passthrough();

const productSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).max(300),
    description: z.string().max(100_000).optional().default(""),
    short_description: z.string().max(50_000).optional().default(""),
    slug: nullableText(300),
    status: z.string().max(40).optional().default("publish"),
    type: z.string().max(40).optional().default("simple"),
    sku: nullableText(160),
    price: moneySchema,
    regular_price: moneySchema,
    sale_price: moneySchema,
    manage_stock: z.boolean().optional().default(false),
    stock_quantity: z.number().int().nullable().optional(),
    attributes: z.array(attributeSchema).max(100).optional().default([]),
    variations: z.array(z.number().int().nonnegative()).max(10_000).optional().default([]),
    date_created_gmt: dateSchema,
    date_modified_gmt: dateSchema,
  })
  .passthrough();

const customerSchema = z
  .object({
    id: idSchema,
    first_name: z.string().max(100).optional().default(""),
    last_name: z.string().max(100).optional().default(""),
    email: nullableText(254),
    billing: z
      .object({ phone: nullableText(40) })
      .passthrough()
      .nullable()
      .optional(),
    total_spent: moneySchema,
    orders_count: z.number().int().nonnegative().optional(),
    date_created_gmt: dateSchema,
    date_modified_gmt: dateSchema,
  })
  .passthrough();

const orderLineSchema = z
  .object({
    name: z.string().max(300).optional(),
    quantity: z.number().int().min(0).max(100_000).optional(),
    total: moneySchema,
    price: moneySchema,
    sku: nullableText(160),
  })
  .passthrough();

const orderSchema = z
  .object({
    id: idSchema,
    number: z.union([z.string(), z.number()]).transform(String),
    status: z.string().min(1).max(80),
    currency: nullableText(8),
    total: moneySchema,
    customer_id: z.number().int().nonnegative().optional().default(0).transform(String),
    billing: z
      .object({
        first_name: z.string().max(100).optional().default(""),
        last_name: z.string().max(100).optional().default(""),
        email: nullableText(254),
        phone: nullableText(40),
      })
      .passthrough()
      .optional()
      .default({ first_name: "", last_name: "" }),
    line_items: z.array(orderLineSchema).max(500).optional().default([]),
    date_created_gmt: dateSchema,
    date_modified_gmt: dateSchema,
  })
  .passthrough();

const webhookSchema = z
  .object({
    id: idSchema,
    topic: z.string().max(80),
    status: z.string().max(40),
    delivery_url: z.string().url().max(1000),
  })
  .passthrough();

export type WooCommerceCredentials = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};
export type WooCommerceProductRemote = z.infer<typeof productSchema> & {
  resolvedVariants: WooCommerceVariantRemote[];
};
export type WooCommerceVariantRemote = z.infer<typeof variationSchema>;
export type WooCommerceCustomerRemote = z.infer<typeof customerSchema>;
export type WooCommerceOrderRemote = z.infer<typeof orderSchema>;

export type WooCommerceErrorCode =
  | "invalid_url"
  | "authorization_expired"
  | "permission_denied"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "remote_unavailable"
  | "invalid_response"
  | "invalid_request"
  | "not_found"
  | "sync_limit";

export class WooCommerceApiError extends Error {
  constructor(
    readonly code: WooCommerceErrorCode,
    readonly safeMessage: string,
    readonly retryable = false
  ) {
    super(safeMessage);
    this.name = "WooCommerceApiError";
  }
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0
  );
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }
  return isIP(host) === 4 && isPrivateIpv4(host);
}

export function normalizeWooCommerceStoreUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WooCommerceApiError(
      "invalid_url",
      "Ingresá una URL válida de la tienda."
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WooCommerceApiError(
      "invalid_url",
      "La URL de la tienda no debe incluir credenciales ni parámetros."
    );
  }
  if (url.protocol !== "https:") {
    throw new WooCommerceApiError(
      "invalid_url",
      "La tienda debe usar una URL HTTPS."
    );
  }
  if (isPrivateHost(url.hostname)) {
    throw new WooCommerceApiError(
      "invalid_url",
      "La URL de la tienda no puede apuntar a una red privada."
    );
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname === "/" ? "" : pathname}`;
}

function statusError(status: number, context: string): WooCommerceApiError {
  console.error(`[VantixApp] WooCommerce endpoint=${context} status=${status}`);
  if (status === 401) {
    return new WooCommerceApiError(
      "authorization_expired",
      "WooCommerce rechazó las credenciales. Revisá la Consumer Key y la Consumer Secret."
    );
  }
  if (status === 403) {
    return new WooCommerceApiError(
      "permission_denied",
      "Las credenciales no tienen permisos suficientes. Generá claves con acceso de lectura/escritura para registrar webhooks."
    );
  }
  if (status === 404) {
    return new WooCommerceApiError(
      "not_found",
      "No encontramos la API de WooCommerce en esa tienda."
    );
  }
  if (status === 429) {
    return new WooCommerceApiError(
      "rate_limited",
      "WooCommerce limitó temporalmente las solicitudes.",
      true
    );
  }
  if (status >= 500) {
    return new WooCommerceApiError(
      "remote_unavailable",
      "La tienda no está disponible temporalmente.",
      true
    );
  }
  return new WooCommerceApiError(
    "invalid_request",
    "WooCommerce rechazó la solicitud."
  );
}

async function readJsonLimited(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > WOOCOMMERCE_MAX_RESPONSE_BYTES
  ) {
    throw new WooCommerceApiError(
      "invalid_response",
      "WooCommerce devolvió una respuesta demasiado grande."
    );
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
    if (bytes > WOOCOMMERCE_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new WooCommerceApiError(
        "invalid_response",
        "WooCommerce devolvió una respuesta demasiado grande."
      );
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")
    ) as unknown;
  } catch {
    throw new WooCommerceApiError(
      "invalid_response",
      "WooCommerce devolvió una respuesta no válida."
    );
  }
}

function basicAuth(credentials: WooCommerceCredentials): string {
  return `Basic ${Buffer.from(
    `${credentials.consumerKey}:${credentials.consumerSecret}`,
    "utf8"
  ).toString("base64")}`;
}

function endpointUrl(
  credentials: WooCommerceCredentials,
  path: string,
  params?: Record<string, string>
): string {
  const url = new URL(
    `${credentials.storeUrl.replace(/\/+$/, "")}/wp-json/wc/v3/${path.replace(/^\//, "")}`
  );
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function remoteFetch(
  input: {
    credentials: WooCommerceCredentials;
    path: string;
    context: string;
    method?: "GET" | "POST" | "PUT";
    params?: Record<string, string>;
    body?: unknown;
    retries?: number;
  },
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const retries = Math.min(Math.max(input.retries ?? 0, 0), 1);
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      WOOCOMMERCE_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await fetchImpl(
        endpointUrl(input.credentials, input.path, input.params),
        {
          method: input.method ?? "GET",
          headers: {
            Authorization: basicAuth(input.credentials),
            Accept: "application/json",
            ...(input.body
              ? { "Content-Type": "application/json; charset=utf-8" }
              : {}),
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
          signal: controller.signal,
          redirect: "error",
          cache: "no-store",
        }
      );
      if (!response.ok) {
        const error = statusError(response.status, input.context);
        if (error.retryable && attempt < retries) continue;
        throw error;
      }
      if (response.status === 204) return null;
      return await readJsonLimited(response);
    } catch (error) {
      if (error instanceof WooCommerceApiError) throw error;
      const safe = controller.signal.aborted
        ? new WooCommerceApiError(
            "timeout",
            "WooCommerce no respondió a tiempo.",
            true
          )
        : new WooCommerceApiError(
            "network_error",
            "No se pudo conectar con la tienda.",
            true
          );
      if (attempt < retries) continue;
      throw safe;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseList<T>(raw: unknown, schema: z.ZodType<T>): T[] {
  const parsed = z.array(schema).safeParse(raw);
  if (!parsed.success) {
    throw new WooCommerceApiError(
      "invalid_response",
      "WooCommerce devolvió datos no válidos."
    );
  }
  return parsed.data;
}

async function listPaginated<T>(
  credentials: WooCommerceCredentials,
  path: string,
  schema: z.ZodType<T>,
  fetchImpl?: typeof fetch
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; page <= WOOCOMMERCE_MAX_SYNC_PAGES; page += 1) {
    const batch = parseList(
      await remoteFetch(
        {
          credentials,
          path,
          context: path.replace(/\//g, "_"),
          params: {
            per_page: String(WOOCOMMERCE_PAGE_SIZE),
            page: String(page),
          },
          retries: 1,
        },
        fetchImpl
      ),
      schema
    );
    result.push(...batch);
    if (batch.length < WOOCOMMERCE_PAGE_SIZE) return result;
  }
  throw new WooCommerceApiError(
    "sync_limit",
    "La tienda supera el límite seguro de sincronización. Contactá a soporte."
  );
}

export async function validateWooCommerceConnection(
  credentials: WooCommerceCredentials,
  fetchImpl?: typeof fetch
): Promise<{ storeUrl: string; storeName: string }> {
  const normalized = {
    ...credentials,
    storeUrl: normalizeWooCommerceStoreUrl(credentials.storeUrl),
  };
  for (const path of ["products", "customers", "orders"] as const) {
    const raw = await remoteFetch(
      {
        credentials: normalized,
        path,
        context: `validate_${path}`,
        params: { per_page: "1", page: "1" },
      },
      fetchImpl
    );
    if (!Array.isArray(raw)) {
      throw new WooCommerceApiError(
        "invalid_response",
        "WooCommerce devolvió una respuesta no válida."
      );
    }
  }
  const url = new URL(normalized.storeUrl);
  return {
    storeUrl: normalized.storeUrl,
    storeName: url.hostname.replace(/^www\./, "").slice(0, 160),
  };
}

export async function listWooCommerceProducts(
  credentials: WooCommerceCredentials,
  fetchImpl?: typeof fetch
): Promise<WooCommerceProductRemote[]> {
  const products = await listPaginated(
    credentials,
    "products",
    productSchema,
    fetchImpl
  );
  const variable = products.filter(
    (product) => product.type === "variable" || product.variations.length > 0
  );
  if (variable.length > WOOCOMMERCE_MAX_VARIABLE_PRODUCTS) {
    throw new WooCommerceApiError(
      "sync_limit",
      "La tienda supera el límite seguro de productos con variantes. Contactá a soporte."
    );
  }
  const result: WooCommerceProductRemote[] = [];
  for (const product of products) {
    let resolvedVariants: WooCommerceVariantRemote[];
    if (product.type === "variable" || product.variations.length > 0) {
      resolvedVariants = await listPaginated(
        credentials,
        `products/${encodeURIComponent(product.id)}/variations`,
        variationSchema,
        fetchImpl
      );
    } else {
      resolvedVariants = [
        {
          id: product.id,
          sku: product.sku,
          price: product.price,
          regular_price: product.regular_price,
          sale_price: product.sale_price,
          manage_stock: product.manage_stock,
          stock_quantity: product.stock_quantity,
          attributes: product.attributes,
        },
      ];
    }
    result.push({ ...product, resolvedVariants });
  }
  return result;
}

export function listWooCommerceCustomers(
  credentials: WooCommerceCredentials,
  fetchImpl?: typeof fetch
) {
  return listPaginated(credentials, "customers", customerSchema, fetchImpl);
}

export function listWooCommerceOrders(
  credentials: WooCommerceCredentials,
  fetchImpl?: typeof fetch
) {
  return listPaginated(credentials, "orders", orderSchema, fetchImpl);
}

export async function getWooCommerceProduct(
  credentials: WooCommerceCredentials,
  id: string,
  fetchImpl?: typeof fetch
): Promise<WooCommerceProductRemote> {
  if (!/^\d{1,20}$/.test(id)) {
    throw new WooCommerceApiError("invalid_request", "El producto no es válido.");
  }
  const raw = await remoteFetch(
    {
      credentials,
      path: `products/${encodeURIComponent(id)}`,
      context: "product",
    },
    fetchImpl
  );
  const product = productSchema.safeParse(raw);
  if (!product.success || product.data.id !== id) {
    throw new WooCommerceApiError(
      "invalid_response",
      "WooCommerce devolvió un producto no válido."
    );
  }
  let resolvedVariants: WooCommerceVariantRemote[];
  if (product.data.type === "variable" || product.data.variations.length > 0) {
    resolvedVariants = await listPaginated(
      credentials,
      `products/${encodeURIComponent(id)}/variations`,
      variationSchema,
      fetchImpl
    );
  } else {
    resolvedVariants = [
      {
        id: product.data.id,
        sku: product.data.sku,
        price: product.data.price,
        regular_price: product.data.regular_price,
        sale_price: product.data.sale_price,
        manage_stock: product.data.manage_stock,
        stock_quantity: product.data.stock_quantity,
        attributes: product.data.attributes,
      },
    ];
  }
  return { ...product.data, resolvedVariants };
}

async function getResource<T>(
  credentials: WooCommerceCredentials,
  resource: "customers" | "orders",
  id: string,
  schema: z.ZodType<T>,
  fetchImpl?: typeof fetch
): Promise<T> {
  if (!/^\d{1,20}$/.test(id)) {
    throw new WooCommerceApiError("invalid_request", "El recurso no es válido.");
  }
  const parsed = schema.safeParse(
    await remoteFetch(
      {
        credentials,
        path: `${resource}/${encodeURIComponent(id)}`,
        context: resource.slice(0, -1),
      },
      fetchImpl
    )
  );
  if (!parsed.success) {
    throw new WooCommerceApiError(
      "invalid_response",
      "WooCommerce devolvió un recurso no válido."
    );
  }
  return parsed.data;
}

export function getWooCommerceCustomer(
  credentials: WooCommerceCredentials,
  id: string,
  fetchImpl?: typeof fetch
) {
  return getResource(credentials, "customers", id, customerSchema, fetchImpl);
}

export function getWooCommerceOrder(
  credentials: WooCommerceCredentials,
  id: string,
  fetchImpl?: typeof fetch
) {
  return getResource(credentials, "orders", id, orderSchema, fetchImpl);
}

export async function ensureWooCommerceWebhooks(
  credentials: WooCommerceCredentials,
  webhookKey: string,
  webhookSecret: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const deliveryUrl = getWooCommerceWebhookUrl(webhookKey);
  const existing = parseList(
    await remoteFetch(
      {
        credentials,
        path: "webhooks",
        context: "webhooks_list",
        params: { per_page: "100", page: "1" },
      },
      fetchImpl
    ),
    webhookSchema
  );
  for (const topic of WOOCOMMERCE_WEBHOOK_TOPICS) {
    const match = existing.find(
      (item) => item.topic === topic && item.delivery_url === deliveryUrl
    );
    await remoteFetch(
      {
        credentials,
        path: match ? `webhooks/${encodeURIComponent(match.id)}` : "webhooks",
        context: match ? "webhook_update" : "webhook_create",
        method: match ? "PUT" : "POST",
        body: {
          name: `VantixApp · ${topic}`,
          topic,
          delivery_url: deliveryUrl,
          secret: webhookSecret,
          status: "active",
        },
      },
      fetchImpl
    );
  }
}
