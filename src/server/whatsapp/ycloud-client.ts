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
  | "permission_denied"
  | "account_pending"
  | "balance_insufficient"
  | "content_rejected"
  | "recipient_invalid"
  | "message_window_closed"
  | "whatsapp_error"
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
    readonly httpStatus?: number,
    /** Código devuelto por YCloud (error.code), ya validado y acotado. */
    readonly providerCode?: string,
    /** Identificador de la solicitud en YCloud, para soporte. */
    readonly requestId?: string
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
    // Opcionales: si YCloud los omite, el envío ya ocurrió y no debe
    // etiquetarse como fallido. Cuando están presentes, se verifican.
    wabaId: z.string().trim().min(1).max(128).optional(),
    from: z.string().trim().regex(E164_PATTERN).optional(),
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

/**
 * Cuerpo de error documentado por YCloud:
 * { error: { status, code, message, target, docUrl, requestId, whatsappApiError } }.
 * Todos los campos se tratan como opcionales y acotados: nunca se confía en
 * el contenido ni se reenvía el mensaje crudo del proveedor al usuario.
 */
const errorBodySchema = z
  .object({
    error: z
      .object({
        code: z.string().trim().max(120).optional(),
        requestId: z.string().trim().max(200).optional(),
        whatsappApiError: z
          .object({
            code: z.union([z.string().max(60), z.number()]).optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

type YCloudErrorDetails = {
  providerCode?: string;
  requestId?: string;
  whatsappErrorCode?: string;
};

function parseErrorDetails(rawBody: unknown): YCloudErrorDetails {
  const parsed = errorBodySchema.safeParse(rawBody);
  if (!parsed.success) return {};
  const error = parsed.data.error;
  const whatsappCode = error.whatsappApiError?.code;
  return {
    providerCode: error.code,
    requestId: error.requestId,
    whatsappErrorCode:
      whatsappCode === undefined ? undefined : String(whatsappCode).slice(0, 60),
  };
}

/** Códigos de Meta que indican mensaje fuera de la ventana/política permitida. */
const WHATSAPP_WINDOW_ERROR_CODES = new Set(["131047", "470"]);

/** Mapeo granular por error.code de YCloud (no solo por status HTTP). */
const PROVIDER_CODE_MAP: Record<
  string,
  { code: YCloudApiErrorCode; message: string; retryable?: boolean }
> = {
  UNAUTHORIZED: {
    code: "authentication",
    message: "YCloud rechazó la API key.",
  },
  FORBIDDEN: {
    code: "permission_denied",
    message: "La API key no tiene permisos sobre ese recurso de YCloud.",
  },
  ACCOUNT_LIMITED: {
    code: "account_pending",
    message: "La cuenta de YCloud está limitada o pendiente de habilitación.",
  },
  ACCOUNT_UNAVAILABLE: {
    code: "account_pending",
    message: "La cuenta de YCloud está limitada o pendiente de habilitación.",
  },
  BALANCE_INSUFFICIENT: {
    code: "balance_insufficient",
    message: "La cuenta de YCloud no tiene saldo suficiente para enviar mensajes.",
  },
  CONTENT_PROHIBITED: {
    code: "content_rejected",
    message: "YCloud rechazó el contenido del mensaje por política.",
  },
  RECIPIENT_UNSUBSCRIBED: {
    code: "recipient_invalid",
    message: "El destinatario no admite mensajes de este remitente.",
  },
  RECIPIENT_IN_BLOCK_LIST: {
    code: "recipient_invalid",
    message: "El destinatario no admite mensajes de este remitente.",
  },
  MESSAGING_REGION_UNSUPPORTED: {
    code: "recipient_invalid",
    message: "El destino del mensaje no está habilitado para este canal.",
  },
  WHATSAPP_PHONE_NUMBER_UNAVAILABLE: {
    code: "number_not_operational",
    message: "El número de WhatsApp no está operativo en YCloud.",
  },
  WHATSAPP_WABA_UNAVAILABLE: {
    code: "number_not_operational",
    message: "La cuenta de WhatsApp Business no está operativa en YCloud.",
  },
  TOO_MANY_REQUESTS: {
    code: "rate_limited",
    message: "YCloud limitó temporalmente las solicitudes.",
    retryable: true,
  },
  ACCOUNT_RATE_LIMITED: {
    code: "rate_limited",
    message: "YCloud limitó temporalmente las solicitudes.",
    retryable: true,
  },
  SENDER_RATE_LIMITED: {
    code: "rate_limited",
    message: "YCloud limitó temporalmente los envíos de este número.",
    retryable: true,
  },
};

function responseError(
  status: number,
  details: YCloudErrorDetails,
  endpoint: string
): YCloudApiError {
  // Diagnóstico sanitizado: nunca incluye API key, payload ni el mensaje crudo.
  console.error(
    `[VantixApp] YCloud error endpoint=${endpoint} status=${status} code=${details.providerCode ?? "desconocido"} whatsappCode=${details.whatsappErrorCode ?? "-"} requestId=${details.requestId ?? "-"}`
  );

  const mapped = details.providerCode
    ? PROVIDER_CODE_MAP[details.providerCode]
    : undefined;
  if (mapped) {
    return new YCloudApiError(
      mapped.code,
      mapped.message,
      mapped.retryable ?? false,
      status,
      details.providerCode,
      details.requestId
    );
  }

  // Error originado en WhatsApp/Meta (viene en error.whatsappApiError).
  if (details.whatsappErrorCode) {
    if (WHATSAPP_WINDOW_ERROR_CODES.has(details.whatsappErrorCode)) {
      return new YCloudApiError(
        "message_window_closed",
        "WhatsApp no permite este mensaje fuera de la ventana de 24 horas.",
        false,
        status,
        details.providerCode,
        details.requestId
      );
    }
    return new YCloudApiError(
      "whatsapp_error",
      "WhatsApp rechazó el mensaje.",
      false,
      status,
      details.providerCode,
      details.requestId
    );
  }

  // Sin código reconocible: se clasifica por status HTTP.
  if (status === 401) {
    return new YCloudApiError(
      "authentication",
      "YCloud rechazó la API key.",
      false,
      status,
      details.providerCode,
      details.requestId
    );
  }
  if (status === 403) {
    return new YCloudApiError(
      "permission_denied",
      "YCloud denegó el permiso para esta operación.",
      false,
      status,
      details.providerCode,
      details.requestId
    );
  }
  if (status === 429) {
    return new YCloudApiError(
      "rate_limited",
      "YCloud limitó temporalmente las solicitudes.",
      true,
      status,
      details.providerCode,
      details.requestId
    );
  }
  if (status >= 500) {
    return new YCloudApiError(
      "ycloud_unavailable",
      "YCloud no está disponible temporalmente.",
      true,
      status,
      details.providerCode,
      details.requestId
    );
  }
  return new YCloudApiError(
    "invalid_request",
    "YCloud rechazó la solicitud de WhatsApp.",
    false,
    status,
    details.providerCode,
    details.requestId
  );
}

/** Lee el cuerpo de error con límite de tamaño; tolera respuestas no JSON. */
async function readErrorBody(response: Response): Promise<unknown> {
  try {
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) return undefined;
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
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
  if (!response.ok) {
    const details = parseErrorDetails(await readErrorBody(response));
    // Solo la ruta sin query: no expone parámetros.
    const endpoint = input.path.split("?")[0] ?? input.path;
    throw responseError(response.status, details, endpoint);
  }
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
    (parsed.data.from !== undefined && parsed.data.from !== from) ||
    (parsed.data.wabaId !== undefined &&
      parsed.data.wabaId !== input.expectedWabaId)
  ) {
    throw new YCloudApiError(
      "invalid_response",
      "YCloud no confirmó el envío del mensaje."
    );
  }
  if (parsed.data.status === "failed") {
    throw new YCloudApiError(
      "whatsapp_error",
      "WhatsApp rechazó el mensaje.",
      false,
      200
    );
  }
  return {
    messageId: parsed.data.id,
    whatsappMessageId: parsed.data.wamid ?? null,
  };
}
