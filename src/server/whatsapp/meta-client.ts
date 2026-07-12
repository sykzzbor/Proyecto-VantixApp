import {
  getMetaGraphApiBaseUrl,
  META_REQUEST_TIMEOUT_MS,
} from "@/server/whatsapp/config";

const META_ID_PATTERN = /^\d{5,32}$/;
const RECIPIENT_PATTERN = /^[1-9]\d{6,14}$/;
const MAX_TEXT_LENGTH = 4096;

export type MetaApiErrorCode =
  | "invalid_configuration"
  | "timeout"
  | "authentication"
  | "rate_limited"
  | "invalid_request"
  | "meta_unavailable"
  | "network_error"
  | "invalid_response";

type MetaApiErrorOptions = {
  code: MetaApiErrorCode;
  safeMessage: string;
  httpStatus?: number;
  metaCode?: string;
  retryable?: boolean;
};

/** Error sanitizado: nunca conserva el token, el request ni el payload. */
export class MetaApiError extends Error {
  readonly code: MetaApiErrorCode;
  readonly safeMessage: string;
  readonly httpStatus?: number;
  readonly metaCode?: string;
  readonly retryable: boolean;

  constructor(options: MetaApiErrorOptions) {
    super(options.safeMessage);
    this.name = "MetaApiError";
    this.code = options.code;
    this.safeMessage = options.safeMessage;
    this.httpStatus = options.httpStatus;
    this.metaCode = options.metaCode;
    this.retryable = options.retryable ?? false;
  }
}

export type WhatsappConnectionTestResult = {
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
};

export type WhatsappSendResult = {
  messageId: string;
};

type MetaRequest = {
  path: string;
  accessToken: string;
  method?: "GET" | "POST";
  body?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertMetaId(value: string): string {
  const id = value.trim();
  if (!META_ID_PATTERN.test(id)) {
    throw new MetaApiError({
      code: "invalid_configuration",
      safeMessage: "La configuracion de WhatsApp no es valida.",
    });
  }
  return id;
}

function assertAccessToken(value: string): string {
  const token = value.trim();
  if (token.length < 20 || token.length > 4096) {
    throw new MetaApiError({
      code: "invalid_configuration",
      safeMessage: "La configuracion de WhatsApp no es valida.",
    });
  }
  return token;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractMetaErrorCode(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  const code = payload.error.code;
  return typeof code === "number" || typeof code === "string"
    ? String(code)
    : undefined;
}

function errorForResponse(status: number, metaCode?: string): MetaApiError {
  const base = { httpStatus: status, metaCode };

  if (status === 401 || status === 403 || metaCode === "190") {
    return new MetaApiError({
      ...base,
      code: "authentication",
      safeMessage: "Meta rechazo las credenciales de WhatsApp.",
    });
  }
  if (status === 429) {
    return new MetaApiError({
      ...base,
      code: "rate_limited",
      safeMessage: "Meta limito temporalmente las solicitudes.",
      retryable: true,
    });
  }
  if (status >= 500) {
    return new MetaApiError({
      ...base,
      code: "meta_unavailable",
      safeMessage: "Meta no esta disponible temporalmente.",
      retryable: true,
    });
  }
  return new MetaApiError({
    ...base,
    code: "invalid_request",
    safeMessage: "Meta rechazo la solicitud de WhatsApp.",
  });
}

/** Una unica llamada fetch, con timeout y sin reintentos automaticos. */
async function requestMeta(input: MetaRequest): Promise<unknown> {
  const token = assertAccessToken(input.accessToken);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${getMetaGraphApiBaseUrl()}/${input.path}`, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(input.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    if (controller.signal.aborted) {
      throw new MetaApiError({
        code: "timeout",
        safeMessage: "Meta no respondio dentro del tiempo esperado.",
        retryable: true,
      });
    }
    throw new MetaApiError({
      code: "network_error",
      safeMessage: "No se pudo conectar con Meta.",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw errorForResponse(response.status, extractMetaErrorCode(payload));
  }
  if (payload === null) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta devolvio una respuesta no valida.",
    });
  }
  return payload;
}

export async function testWhatsappConnection(input: {
  phoneNumberId: string;
  accessToken: string;
}): Promise<WhatsappConnectionTestResult> {
  const phoneNumberId = assertMetaId(input.phoneNumberId);
  const fields = new URLSearchParams({
    fields: "id,display_phone_number,verified_name",
  });
  const payload = await requestMeta({
    path: `${phoneNumberId}?${fields.toString()}`,
    accessToken: input.accessToken,
  });

  if (
    !isRecord(payload) ||
    payload.id !== phoneNumberId ||
    typeof payload.display_phone_number !== "string" ||
    !payload.display_phone_number.trim() ||
    typeof payload.verified_name !== "string" ||
    !payload.verified_name.trim()
  ) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta devolvio una respuesta no valida.",
    });
  }

  return {
    phoneNumberId,
    displayPhoneNumber: payload.display_phone_number.trim(),
    verifiedName: payload.verified_name.trim(),
  };
}

export async function sendWhatsappTextMessage(input: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}): Promise<WhatsappSendResult> {
  const phoneNumberId = assertMetaId(input.phoneNumberId);
  const recipient = input.to.trim().replace(/^\+/, "");
  const text = input.text.trim();

  if (!RECIPIENT_PATTERN.test(recipient) || !text || text.length > MAX_TEXT_LENGTH) {
    throw new MetaApiError({
      code: "invalid_request",
      safeMessage: "El mensaje de WhatsApp no es valido.",
    });
  }

  const payload = await requestMeta({
    path: `${phoneNumberId}/messages`,
    accessToken: input.accessToken,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipient,
      type: "text",
      text: { preview_url: false, body: text },
    },
  });

  const messages = isRecord(payload) ? payload.messages : undefined;
  const firstMessage = Array.isArray(messages) ? messages[0] : undefined;
  if (
    !isRecord(firstMessage) ||
    typeof firstMessage.id !== "string" ||
    !firstMessage.id.trim()
  ) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta no confirmo el envio del mensaje.",
    });
  }

  return { messageId: firstMessage.id.trim() };
}
