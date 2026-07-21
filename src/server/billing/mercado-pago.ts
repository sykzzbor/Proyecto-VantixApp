import { createHmac, timingSafeEqual } from "node:crypto";
import {
  BillingProviderError,
  type BillingProvider,
  type BillingAuthorizedPayment,
  type BillingProviderSubscription,
  type CreateBillingSubscriptionInput,
  type CreatedBillingSubscription,
} from "@/server/billing/provider";

const MERCADO_PAGO_API = "https://api.mercadopago.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 128 * 1024;

type MercadoPagoEnv = {
  MERCADO_PAGO_ACCESS_TOKEN?: string;
  MERCADO_PAGO_WEBHOOK_SECRET?: string;
  NEXT_PUBLIC_APP_URL?: string;
};

type MercadoPagoRawSubscription = {
  id?: unknown;
  status?: unknown;
  external_reference?: unknown;
  payer_id?: unknown;
  init_point?: unknown;
  date_created?: unknown;
  last_modified?: unknown;
  auto_recurring?: {
    transaction_amount?: unknown;
    currency_id?: unknown;
    next_payment_date?: unknown;
    start_date?: unknown;
  };
};

type MercadoPagoRawAuthorizedPayment = {
  id?: unknown;
  preapproval_id?: unknown;
  currency_id?: unknown;
  transaction_amount?: unknown;
  last_modified?: unknown;
  summarized?: unknown;
  payment?: { status?: unknown };
};

export type MercadoPagoConfiguration = {
  configured: boolean;
  missing: Array<"access_token" | "webhook_secret" | "app_url">;
  appUrl: string | null;
};

function validPublicAppUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function getMercadoPagoConfiguration(
  env: MercadoPagoEnv = process.env as unknown as MercadoPagoEnv
): MercadoPagoConfiguration {
  const missing: MercadoPagoConfiguration["missing"] = [];
  if (!env.MERCADO_PAGO_ACCESS_TOKEN?.trim()) missing.push("access_token");
  if (!env.MERCADO_PAGO_WEBHOOK_SECRET?.trim()) missing.push("webhook_secret");
  const appUrl = validPublicAppUrl(env.NEXT_PUBLIC_APP_URL);
  if (!appUrl) missing.push("app_url");
  return { configured: missing.length === 0, missing, appUrl };
}

function toDate(value: unknown): Date | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}

function parseSubscription(value: unknown): BillingProviderSubscription {
  if (!value || typeof value !== "object") {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
  const raw = value as MercadoPagoRawSubscription;
  const status = raw.status;
  if (
    typeof raw.id !== "string" ||
    !["pending", "authorized", "paused", "cancelled"].includes(String(status))
  ) {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
  const amount = Number(raw.auto_recurring?.transaction_amount);
  return {
    id: raw.id,
    status: status as BillingProviderSubscription["status"],
    externalReference:
      typeof raw.external_reference === "string" ? raw.external_reference : null,
    payerId:
      typeof raw.payer_id === "string" || typeof raw.payer_id === "number"
        ? String(raw.payer_id)
        : null,
    amountArs: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency:
      typeof raw.auto_recurring?.currency_id === "string"
        ? raw.auto_recurring.currency_id
        : null,
    nextPaymentAt: toDate(raw.auto_recurring?.next_payment_date),
    startedAt:
      toDate(raw.auto_recurring?.start_date) ?? toDate(raw.date_created),
    lastModifiedAt: toDate(raw.last_modified),
  };
}

function parseAuthorizedPayment(value: unknown): BillingAuthorizedPayment {
  if (!value || typeof value !== "object") {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
  const raw = value as MercadoPagoRawAuthorizedPayment;
  const rawPaymentStatus = String(raw.payment?.status ?? raw.summarized ?? "");
  const paymentStatus =
    rawPaymentStatus === "approved"
      ? "approved"
      : rawPaymentStatus === "rejected"
        ? "rejected"
        : ["pending", "in_process", "scheduled"].includes(rawPaymentStatus)
          ? "pending"
          : null;
  const amount = Number(raw.transaction_amount);
  if (
    (typeof raw.id !== "string" && typeof raw.id !== "number") ||
    typeof raw.preapproval_id !== "string" ||
    !paymentStatus ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    typeof raw.currency_id !== "string"
  ) {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
  return {
    id: String(raw.id),
    subscriptionId: raw.preapproval_id,
    paymentStatus,
    amountArs: amount,
    currency: raw.currency_id,
    lastModifiedAt: toDate(raw.last_modified),
  };
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BillingProviderError(
      "invalid_provider_response",
      "Mercado Pago devolvió una respuesta inesperada."
    );
  }
}

export class MercadoPagoBillingProvider implements BillingProvider {
  readonly name = "MERCADO_PAGO" as const;

  constructor(
    private readonly options: {
      env?: MercadoPagoEnv;
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    } = {}
  ) {}

  private get env(): MercadoPagoEnv {
    return this.options.env ?? (process.env as unknown as MercadoPagoEnv);
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const accessToken = this.env.MERCADO_PAGO_ACCESS_TOKEN?.trim();
    if (!accessToken) {
      throw new BillingProviderError(
        "not_configured",
        "La facturación todavía no está configurada."
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        `${MERCADO_PAGO_API}${path}`,
        {
          ...init,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            ...init.headers,
          },
          signal: controller.signal,
          cache: "no-store",
        }
      );
      const body = await readJsonResponse(response);
      if (!response.ok) {
        throw new BillingProviderError(
          "provider_rejected",
          "Mercado Pago rechazó la operación. Revisá la configuración de facturación."
        );
      }
      return body;
    } catch (error) {
      if (error instanceof BillingProviderError) throw error;
      throw new BillingProviderError(
        "provider_unavailable",
        "Mercado Pago no está disponible en este momento."
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async createSubscription(
    input: CreateBillingSubscriptionInput
  ): Promise<CreatedBillingSubscription> {
    const body = await this.request("/preapproval", {
      method: "POST",
      body: JSON.stringify({
        reason: `VantixApp · ${input.plan}`,
        external_reference: input.externalReference,
        payer_email: input.payerEmail,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: input.amountArs,
          currency_id: "ARS",
        },
        back_url: input.returnUrl,
        status: "pending",
      }),
    });
    const parsed = parseSubscription(body);
    const checkoutUrl =
      body && typeof body === "object" &&
      typeof (body as MercadoPagoRawSubscription).init_point === "string"
        ? (body as MercadoPagoRawSubscription).init_point as string
        : null;
    if (!isMercadoPagoCheckoutUrl(checkoutUrl)) {
      throw new BillingProviderError(
        "invalid_provider_response",
        "Mercado Pago no devolvió un enlace de pago válido."
      );
    }
    if (
      parsed.externalReference !== input.externalReference ||
      parsed.amountArs === null ||
      parsed.currency !== "ARS" ||
      Math.abs(parsed.amountArs - input.amountArs) > 0.01
    ) {
      throw new BillingProviderError(
        "amount_mismatch",
        "El importe configurado en Mercado Pago no coincide con la cotización mostrada."
      );
    }
    return { ...parsed, checkoutUrl };
  }

  async getSubscription(externalSubscriptionId: string) {
    return parseSubscription(
      await this.request(
        `/preapproval/${encodeURIComponent(externalSubscriptionId)}`,
        { method: "GET" }
      )
    );
  }

  async getAuthorizedPayment(externalPaymentId: string) {
    return parseAuthorizedPayment(
      await this.request(
        `/authorized_payments/${encodeURIComponent(externalPaymentId)}`,
        { method: "GET" }
      )
    );
  }

  async cancelSubscription(externalSubscriptionId: string) {
    return parseSubscription(
      await this.request(
        `/preapproval/${encodeURIComponent(externalSubscriptionId)}`,
        { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }
      )
    );
  }
}

function isMercadoPagoCheckoutUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "mercadopago.com" ||
        url.hostname.endsWith(".mercadopago.com") ||
        url.hostname === "mercadopago.com.ar" ||
        url.hostname.endsWith(".mercadopago.com.ar"))
    );
  } catch {
    return false;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyMercadoPagoWebhookSignature(input: {
  signatureHeader: string | null;
  requestId: string | null;
  dataId: string | null;
  secret: string;
  now?: number;
  toleranceMs?: number;
}): boolean {
  const signatureParts = new Map(
    (input.signatureHeader ?? "")
      .split(",")
      .map((part) => part.trim().split("=", 2) as [string, string])
  );
  const timestamp = signatureParts.get("ts") ?? "";
  const signature = signatureParts.get("v1") ?? "";
  if (!timestamp || !signature || !input.requestId || !input.dataId) return false;
  const numeric = Number(timestamp);
  if (!Number.isFinite(numeric)) return false;
  const timestampMs = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  const now = input.now ?? Date.now();
  if (Math.abs(now - timestampMs) > (input.toleranceMs ?? 5 * 60 * 1_000)) {
    return false;
  }
  // Mercado Pago exige minúsculas para data.id alfanuméricos al construir
  // el manifest de la firma.
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", input.secret)
    .update(manifest, "utf8")
    .digest("hex");
  return safeEqual(signature.toLowerCase(), expected);
}
