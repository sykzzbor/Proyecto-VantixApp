import { z } from "zod";

const YCLOUD_API_BASE_URL = "https://api.ycloud.com/v2";
const YCLOUD_REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PHONE_PAGES = 10;
const MAX_TEXT_LENGTH = 4096;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export type YCloudApiErrorCode =
  | "invalid_configuration"
  | "authentication"
  | "number_not_found"
  | "number_not_operational"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "ycloud_unavailable"
  | "invalid_response"
  | "invalid_request";

export class YCloudApiError extends Error {
  constructor(
    readonly code: YCloudApiErrorCode,
    readonly safeMessage: string,
    readonly retryable = false,
    readonly httpStatus?: number
  ) {
    super(safeMessage);
    this.name = "YCloudApiError";
  }
}

const phoneNumberSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    phoneNumber: z.string().trim().regex(E164_PATTERN),
    displayPhoneNumber: z.string().trim().min(1).max(80).optional(),
    wabaId: z.string().trim().min(1).max(128),
    verifiedName: z.string().trim().min(1).max(200),
    status: z.enum([
      "PENDING",
      "UNVERIFIED",
      "MANUAL_REVIEW",
      "DISCONNECTED",
      "CONNECTED",
      "FLAGGED",
      "WARNED",
      "RATE_LIMITED",
      "BANNED",
      "RESTRICTED",
      "BLOCKED",
      "MIGRATED",
      "UNKNOWN",
    ]),
  })
  .passthrough();

const phoneNumberPageSchema = z
  .object({
    items: z.array(phoneNumberSchema).max(100),
    length: z.number().int().min(0).max(100),
    total: z.number().int().min(0).optional(),
  })
  .passthrough();

const sentMessageSchema = z
  .object({
    id: z.string().trim().min(1).max(255),
    wamid: z.string().trim().min(1).max(512).optional(),
    wabaId: z.string().trim().min(1).max(128),
    from: z.string().trim().regex(E164_PATTERN),
    status: z
      .enum(["accepted", "failed", "sent", "delivered", "read"])
      .optional(),
  })
  .passthrough();

export type YCloudWhatsappAsset = {
  wabaId: string;
  phoneNumberId: string;
  phoneNumber: string;
  displayPhoneNumber: string;
  verifiedName: string;
  status: "CONNECTED";
};

export type YCloudSendResult = {
  messageId: string;
  whatsappMessageId: string | null;
};

type YCloudRequest = {
  path: string;
  apiKey: string;
  method?: "GET" | "POST";
  body?: unknown;
  fetchImpl?: typeof fetch;
};

function assertApiKey(value: string): string {
  const apiKey = value.trim();
  if (apiKey.length < 20 || apiKey.length > 4096) {
    throw new YCloudApiError(
      "invalid_configuration",
      "La API key de YCloud no es válida."
    );
  }
  return apiKey;
}

export function normalizeYCloudPhoneNumber(value: string): string {
  const normalized = value.trim().replace(/[\s()-]/g, "");
  if (!E164_PATTERN.test(normalized)) {
    throw new YCloudApiError(
      "invalid_configuration",
      "El número de WhatsApp debe estar en formato E.164."
    );
  }
  return normalized;
}

async function readLimitedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new YCloudApiError(
      "invalid_response",
      "YCloud devolvió una respuesta no válida."
    );
  }
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new YCloudApiError(
      "invalid_response",
      "YCloud devolvió una respuesta no válida."
    );
  }
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new YCloudApiError(
      "invalid_response",
      "YCloud devolvió una respuesta no válida."
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new YCloudApiError(
      "invalid_response",
      "YCloud devolvió una respuesta no válida."
    );
  }
}

function responseError(status: number): YCloudApiError {
  if (status === 401 || status === 403) {
    return new YCloudApiError(
      "authentication",
      "YCloud rechazó la API key.",
      false,
      status
    );
  }
  if (status === 429) {
    return new YCloudApiError(
      "rate_limited",
      "YCloud limitó temporalmente las solicitudes.",
      true,
      status
    );
  }
  if (status >= 500) {
    return new YCloudApiError(
      "ycloud_unavailable",
      "YCloud no está disponible temporalmente.",
      true,
      status
    );
  }
  return new YCloudApiError(
    "invalid_request",
    "YCloud rechazó la solicitud de WhatsApp.",
    false,
    status
  );
}

async function requestYCloud(input: YCloudRequest): Promise<unknown> {
  const apiKey = assertApiKey(input.apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), YCLOUD_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(
      `${YCLOUD_API_BASE_URL}/${input.path}`,
      {
        method: input.method ?? "GET",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
          ...(input.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      }
    );
  } catch {
    if (controller.signal.aborted) {
      throw new YCloudApiError(
        "timeout",
        "YCloud no respondió dentro del tiempo esperado.",
        true
      );
    }
    throw new YCloudApiError(
      "network_error",
      "No se pudo conectar con YCloud.",
      true
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw responseError(response.status);
  return readLimitedJson(response);
}

export async function resolveYCloudWhatsappAsset(input: {
  apiKey: string;
  phoneNumber: string;
  fetchImpl?: typeof fetch;
}): Promise<YCloudWhatsappAsset> {
  const phoneNumber = normalizeYCloudPhoneNumber(input.phoneNumber);
  for (let page = 1; page <= MAX_PHONE_PAGES; page++) {
    const query = new URLSearchParams({
      page: String(page),
      limit: "100",
      includeTotal: "true",
    });
    const raw = await requestYCloud({
      path: `whatsapp/phoneNumbers?${query.toString()}`,
      apiKey: input.apiKey,
      fetchImpl: input.fetchImpl,
    });
    const parsed = phoneNumberPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new YCloudApiError(
        "invalid_response",
        "YCloud devolvió una respuesta no válida."
      );
    }
    const match = parsed.data.items.find(
      (item) => item.phoneNumber === phoneNumber
    );
    if (match) {
      if (match.status !== "CONNECTED") {
        throw new YCloudApiError(
          "number_not_operational",
          "El número todavía no está operativo en YCloud."
        );
      }
      return {
        wabaId: match.wabaId,
        phoneNumberId: match.id,
        phoneNumber: match.phoneNumber,
        displayPhoneNumber: match.displayPhoneNumber ?? match.phoneNumber,
        verifiedName: match.verifiedName,
        status: "CONNECTED",
      };
    }
    const total = parsed.data.total;
    if (
      parsed.data.length < 100 ||
      (total !== undefined && page * 100 >= total)
    ) {
      break;
    }
  }
  throw new YCloudApiError(
    "number_not_found",
    "La API key no tiene acceso a ese número en YCloud."
  );
}

export async function sendYCloudTextMessage(input: {
  apiKey: string;
  from: string;
  to: string;
  text: string;
  externalId: string;
  expectedWabaId: string;
  fetchImpl?: typeof fetch;
}): Promise<YCloudSendResult> {
  const from = normalizeYCloudPhoneNumber(input.from);
  const to = normalizeYCloudPhoneNumber(input.to);
  const text = input.text.trim();
  if (!text || text.length > MAX_TEXT_LENGTH || input.externalId.length > 255) {
    throw new YCloudApiError(
      "invalid_configuration",
      "El mensaje de WhatsApp no es válido."
    );
  }
  const raw = await requestYCloud({
    path: "whatsapp/messages/sendDirectly",
    method: "POST",
    apiKey: input.apiKey,
    body: {
      from,
      to,
      type: "text",
      text: { body: text },
      externalId: input.externalId,
    },
    fetchImpl: input.fetchImpl,
  });
  const parsed = sentMessageSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.from !== from ||
    parsed.data.wabaId !== input.expectedWabaId ||
    parsed.data.status === "failed"
  ) {
    throw new YCloudApiError(
      "invalid_response",
      "YCloud no confirmó el envío del mensaje."
    );
  }
  return {
    messageId: parsed.data.id,
    whatsappMessageId: parsed.data.wamid ?? null,
  };
}
