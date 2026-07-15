import {
  getMetaAppId,
  getMetaAppSecret,
  getMetaGraphApiBaseUrl,
  META_REQUEST_TIMEOUT_MS,
} from "@/server/whatsapp/config";

const META_ID_PATTERN = /^\d{5,32}$/;
const RECIPIENT_PATTERN = /^[1-9]\d{6,14}$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;
const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
const TEMPLATE_LANGUAGE_PATTERN = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
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
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
};

const REQUIRED_EMBEDDED_SIGNUP_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

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

export type MetaEmbeddedSignupToken = {
  accessToken: string;
  expiresAt: Date | null;
};

export type MetaEmbeddedSignupGrant = {
  scopes: string[];
  wabaIds: string[];
  expiresAt: Date | null;
};

export type MetaEmbeddedSignupAsset = {
  wabaId: string;
  businessId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string;
};

type MetaWhatsappPhone = {
  id: string;
  displayPhoneNumber: string;
  verifiedName: string;
};

type MetaWhatsappPhonePage = {
  phones: MetaWhatsappPhone[];
  nextCursor: string | null;
};

const MAX_MANUAL_PHONE_PAGES = 10;
const MAX_PHONE_PAGE_SIZE = 100;

function validStringList(value: unknown, maxItems = 50): string[] {
  if (!Array.isArray(value) || value.length > maxItems) return [];
  const result = value
    .filter((entry): entry is string =>
      typeof entry === "string" && entry.length > 0 && entry.length <= 100
    )
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(result)].sort();
}

function expiryFromSeconds(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return null;
  }
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Intercambia el código una sola vez; el secreto y el token nunca salen del servidor. */
export async function exchangeMetaEmbeddedSignupCode(
  code: string
): Promise<MetaEmbeddedSignupToken> {
  const appId = getMetaAppId();
  const appSecret = getMetaAppSecret();
  const params = new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    code,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(
      `${getMetaGraphApiBaseUrl()}/oauth/access_token?${params.toString()}`,
      {
        method: "GET",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      }
    );
  } catch {
    if (controller.signal.aborted) {
      throw new MetaApiError({
        code: "timeout",
        safeMessage: "Meta no respondió dentro del tiempo esperado.",
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
  if (
    !isRecord(payload) ||
    typeof payload.access_token !== "string" ||
    payload.access_token.length < 20 ||
    payload.access_token.length > 4096
  ) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta no confirmó la autorización de WhatsApp.",
    });
  }

  const expiresIn = payload.expires_in;
  const expiresAt =
    typeof expiresIn === "number" &&
    Number.isFinite(expiresIn) &&
    expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null;
  return { accessToken: payload.access_token, expiresAt };
}

/** Verifica que el token pertenezca a esta app y tenga permisos granulares útiles. */
export async function inspectMetaEmbeddedSignupToken(
  accessToken: string
): Promise<MetaEmbeddedSignupGrant> {
  const appId = getMetaAppId();
  const appAccessToken = `${appId}|${getMetaAppSecret()}`;
  const query = new URLSearchParams({ input_token: accessToken });
  const payload = await requestMeta({
    path: `debug_token?${query.toString()}`,
    accessToken: appAccessToken,
  });
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  if (!data || data.is_valid !== true || data.app_id !== appId) {
    throw new MetaApiError({
      code: "authentication",
      safeMessage: "Meta no confirmó la autorización de WhatsApp.",
    });
  }

  const scopes = validStringList(data.scopes);
  if (
    !REQUIRED_EMBEDDED_SIGNUP_SCOPES.every((scope) => scopes.includes(scope))
  ) {
    throw new MetaApiError({
      code: "authentication",
      safeMessage: "La autorización de Meta todavía no tiene todos los permisos necesarios.",
    });
  }

  const targetsByScope = new Map<string, Set<string>>();
  if (Array.isArray(data.granular_scopes)) {
    for (const item of data.granular_scopes.slice(0, 50)) {
      if (!isRecord(item) || typeof item.scope !== "string") continue;
      const targets = validStringList(item.target_ids).filter((id) =>
        META_ID_PATTERN.test(id)
      );
      targetsByScope.set(item.scope, new Set(targets));
    }
  }

  // Meta documenta los WABA compartidos en los targets granulares del permiso
  // de administración; el permiso de mensajería puede no traer target_ids.
  const managementTargets = targetsByScope.get("whatsapp_business_management");
  if (!managementTargets) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta no informó una cuenta de WhatsApp autorizada.",
    });
  }
  const wabaIds = [...managementTargets].sort();

  const tokenExpiry = expiryFromSeconds(data.expires_at);
  const dataExpiry = expiryFromSeconds(data.data_access_expires_at);
  const expiries = [tokenExpiry, dataExpiry].filter((date): date is Date => !!date);
  const expiresAt = expiries.length
    ? new Date(Math.min(...expiries.map((date) => date.getTime())))
    : null;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new MetaApiError({
      code: "authentication",
      safeMessage: "La autorización de Meta venció.",
    });
  }

  return { scopes, wabaIds, expiresAt };
}

async function resolveMetaWabaBusiness(input: {
  accessToken: string;
  wabaId: string;
}): Promise<{ wabaId: string; businessId: string }> {
  const wabaId = assertMetaId(input.wabaId);
  const wabaQuery = new URLSearchParams({ fields: "id,owner_business_info" });
  const waba = await requestMeta({
    path: `${wabaId}?${wabaQuery.toString()}`,
    accessToken: input.accessToken,
  });
  const owner = isRecord(waba) && isRecord(waba.owner_business_info)
    ? waba.owner_business_info
    : null;
  if (
    !isRecord(waba) ||
    waba.id !== wabaId ||
    !owner ||
    typeof owner.id !== "string" ||
    !META_ID_PATTERN.test(owner.id)
  ) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta no confirmó la cuenta comercial de WhatsApp.",
    });
  }

  return { wabaId, businessId: owner.id };
}

function parseMetaWhatsappPhone(value: unknown): MetaWhatsappPhone | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !META_ID_PATTERN.test(value.id) ||
    typeof value.display_phone_number !== "string" ||
    !value.display_phone_number.trim() ||
    typeof value.verified_name !== "string" ||
    !value.verified_name.trim()
  ) {
    return null;
  }
  return {
    id: value.id,
    displayPhoneNumber: value.display_phone_number.trim(),
    verifiedName: value.verified_name.trim(),
  };
}

async function readMetaWhatsappPhonePage(input: {
  accessToken: string;
  wabaId: string;
  limit: number;
  after?: string;
}): Promise<MetaWhatsappPhonePage> {
  const phoneQuery = new URLSearchParams({
    fields: "id,display_phone_number,verified_name",
    limit: String(input.limit),
  });
  if (input.after) phoneQuery.set("after", input.after);

  const phonesPayload = await requestMeta({
    path: `${input.wabaId}/phone_numbers?${phoneQuery.toString()}`,
    accessToken: input.accessToken,
  });
  const rawPhones = isRecord(phonesPayload) && Array.isArray(phonesPayload.data)
    ? phonesPayload.data
    : [];
  const phones = rawPhones.map(parseMetaWhatsappPhone);
  if (phones.some((phone) => phone === null)) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta devolvió un número de WhatsApp no válido.",
    });
  }
  const rawCursor =
    isRecord(phonesPayload) &&
    isRecord(phonesPayload.paging) &&
    isRecord(phonesPayload.paging.cursors) &&
    typeof phonesPayload.paging.cursors.after === "string"
      ? phonesPayload.paging.cursors.after
      : null;
  const hasNext =
    isRecord(phonesPayload) &&
    isRecord(phonesPayload.paging) &&
    typeof phonesPayload.paging.next === "string";
  const nextCursor =
    hasNext && rawCursor && rawCursor.length <= 1024 && !/[\u0000-\u001f]/.test(rawCursor)
      ? rawCursor
      : null;

  if (hasNext && !nextCursor) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta devolvió una paginación no válida.",
    });
  }

  return {
    phones: phones as MetaWhatsappPhone[],
    nextCursor,
  };
}

/** Obtiene los activos desde Meta. Falla cerrado ante cero o múltiples números. */
export async function resolveMetaEmbeddedSignupAsset(input: {
  accessToken: string;
  wabaId: string;
}): Promise<MetaEmbeddedSignupAsset> {
  const wabaId = assertMetaId(input.wabaId);
  const wabaQuery = new URLSearchParams({ fields: "id,owner_business_info" });
  const waba = await requestMeta({
    path: `${wabaId}?${wabaQuery.toString()}`,
    accessToken: input.accessToken,
  });
  const owner = isRecord(waba) && isRecord(waba.owner_business_info)
    ? waba.owner_business_info
    : null;
  if (
    !isRecord(waba) ||
    waba.id !== wabaId ||
    !owner ||
    typeof owner.id !== "string" ||
    !META_ID_PATTERN.test(owner.id)
  ) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta no confirmó la cuenta comercial de WhatsApp.",
    });
  }

  const phoneQuery = new URLSearchParams({
    fields: "id,display_phone_number,verified_name",
    limit: "2",
  });
  const phonesPayload = await requestMeta({
    path: `${wabaId}/phone_numbers?${phoneQuery.toString()}`,
    accessToken: input.accessToken,
  });
  const phones = isRecord(phonesPayload) && Array.isArray(phonesPayload.data)
    ? phonesPayload.data
    : [];
  const hasNext =
    isRecord(phonesPayload) &&
    isRecord(phonesPayload.paging) &&
    typeof phonesPayload.paging.next === "string";
  if (phones.length !== 1 || hasNext || !isRecord(phones[0])) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage:
        phones.length === 0
          ? "Meta no informó un número de WhatsApp disponible."
          : "La cuenta tiene más de un número; elegí una conexión inequívoca.",
    });
  }
  const phone = phones[0];
  if (
    typeof phone.id !== "string" ||
    !META_ID_PATTERN.test(phone.id) ||
    typeof phone.display_phone_number !== "string" ||
    !phone.display_phone_number.trim() ||
    typeof phone.verified_name !== "string" ||
    !phone.verified_name.trim()
  ) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta devolvió un número de WhatsApp no válido.",
    });
  }

  return {
    wabaId,
    businessId: owner.id,
    phoneNumberId: phone.id,
    displayPhoneNumber: phone.display_phone_number.trim(),
    verifiedName: phone.verified_name.trim(),
  };
}

/**
 * Resuelve un número manual únicamente si Meta lo enumera dentro de la WABA
 * indicada. Nunca confía en nombres ni teléfonos enviados por el navegador.
 */
export async function resolveMetaManualWhatsappAsset(input: {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<MetaEmbeddedSignupAsset> {
  const waba = await resolveMetaWabaBusiness(input);
  const expectedPhoneNumberId = assertMetaId(input.phoneNumberId);
  let after: string | undefined;

  for (let pageNumber = 0; pageNumber < MAX_MANUAL_PHONE_PAGES; pageNumber++) {
    const page = await readMetaWhatsappPhonePage({
      accessToken: input.accessToken,
      wabaId: waba.wabaId,
      limit: MAX_PHONE_PAGE_SIZE,
      after,
    });
    const phone = page.phones.find(({ id }) => id === expectedPhoneNumberId);
    if (phone) {
      return {
        wabaId: waba.wabaId,
        businessId: waba.businessId,
        phoneNumberId: phone.id,
        displayPhoneNumber: phone.displayPhoneNumber,
        verifiedName: phone.verifiedName,
      };
    }
    if (!page.nextCursor) break;
    after = page.nextCursor;
  }

  throw new MetaApiError({
    code: "invalid_request",
    safeMessage: "El Phone Number ID no pertenece a la WABA indicada.",
  });
}

export async function subscribeMetaAppToWaba(input: {
  accessToken: string;
  wabaId: string;
}): Promise<void> {
  const payload = await requestMeta({
    path: `${assertMetaId(input.wabaId)}/subscribed_apps`,
    accessToken: input.accessToken,
    method: "POST",
  });
  if (!isRecord(payload) || payload.success !== true) {
    throw new MetaApiError({
      code: "invalid_response",
      safeMessage: "Meta no confirmó la suscripción del webhook.",
    });
  }
}

export async function isMetaAppSubscribedToWaba(input: {
  accessToken: string;
  wabaId: string;
}): Promise<boolean> {
  const payload = await requestMeta({
    path: `${assertMetaId(input.wabaId)}/subscribed_apps`,
    accessToken: input.accessToken,
  });
  const data = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
  const appId = getMetaAppId();
  return data.some((entry) => {
    if (!isRecord(entry) || !isRecord(entry.whatsapp_business_api_data)) {
      return false;
    }
    return entry.whatsapp_business_api_data.id === appId;
  });
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

export async function sendWhatsappTemplateMessage(input: {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  language: string;
}): Promise<WhatsappSendResult> {
  const phoneNumberId = assertMetaId(input.phoneNumberId);
  const e164Recipient = input.to.trim();
  const templateName = input.templateName.trim();
  const language = input.language.trim();

  if (
    !E164_PATTERN.test(e164Recipient) ||
    !TEMPLATE_NAME_PATTERN.test(templateName) ||
    !TEMPLATE_LANGUAGE_PATTERN.test(language)
  ) {
    throw new MetaApiError({
      code: "invalid_request",
      safeMessage: "La plantilla de WhatsApp no es valida.",
    });
  }

  const payload = await requestMeta({
    path: `${phoneNumberId}/messages`,
    accessToken: input.accessToken,
    method: "POST",
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: e164Recipient.slice(1),
      type: "template",
      template: {
        name: templateName,
        language: { code: language },
      },
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
      safeMessage: "Meta no confirmo el envio de la plantilla.",
    });
  }

  return { messageId: firstMessage.id.trim() };
}
