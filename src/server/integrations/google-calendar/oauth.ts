import { z } from "zod";
import {
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_REQUEST_TIMEOUT_MS,
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleRedirectUri,
} from "@/server/integrations/google-calendar/config";

/**
 * Cliente OAuth 2.0 de Google (endpoints oficiales). Errores SIEMPRE
 * sanitizados: nunca se reenvía la respuesta cruda de Google ni se registran
 * tokens, códigos o secretos.
 */

export type GoogleApiErrorCode =
  | "not_configured"
  | "authorization_expired"
  | "authentication"
  | "permission_denied"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "google_unavailable"
  | "invalid_response"
  | "invalid_request";

export class GoogleApiError extends Error {
  constructor(
    readonly code: GoogleApiErrorCode,
    readonly safeMessage: string,
    readonly retryable = false,
    readonly httpStatus?: number
  ) {
    super(safeMessage);
    this.name = "GoogleApiError";
  }
}

const tokenResponseSchema = z
  .object({
    access_token: z.string().min(10).max(4096),
    refresh_token: z.string().min(10).max(4096).optional(),
    expires_in: z.number().int().min(1).max(86_400),
    scope: z.string().max(2000).optional(),
  })
  .passthrough();

const calendarListSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(512),
            summary: z.string().max(500).optional(),
            primary: z.boolean().optional(),
            accessRole: z.string().max(60).optional(),
          })
          .passthrough()
      )
      .max(250)
      .default([]),
  })
  .passthrough();

const freeBusyResponseSchema = z
  .object({
    calendars: z.record(
      z.string(),
      z
        .object({
          busy: z
            .array(
              z
                .object({
                  start: z.string().datetime({ offset: true }),
                  end: z.string().datetime({ offset: true }),
                })
                .strict()
            )
            .max(1000)
            .default([]),
          errors: z.array(z.unknown()).max(20).optional(),
        })
        .passthrough()
    ),
  })
  .passthrough();

export type GoogleTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope: string[];
};

export type GoogleCalendarItem = {
  id: string;
  name: string;
  primary: boolean;
};

export type GoogleBusyInterval = {
  start: Date;
  end: Date;
};

function responseError(status: number, context: string): GoogleApiError {
  // Log sanitizado: solo endpoint y status, jamás cuerpos ni tokens.
  console.error(`[VantixApp] Google Calendar error endpoint=${context} status=${status}`);
  if (status === 400 || status === 422) {
    return new GoogleApiError("invalid_request", "Google rechazó la solicitud.", false, status);
  }
  if (status === 401) {
    return new GoogleApiError(
      "authorization_expired",
      "La autorización con Google expiró. Reconectá la cuenta.",
      false,
      status
    );
  }
  if (status === 403) {
    return new GoogleApiError(
      "permission_denied",
      "Google denegó el permiso para esta operación.",
      false,
      status
    );
  }
  if (status === 429) {
    return new GoogleApiError(
      "rate_limited",
      "Google limitó temporalmente las solicitudes.",
      true,
      status
    );
  }
  if (status >= 500) {
    return new GoogleApiError(
      "google_unavailable",
      "Google no está disponible temporalmente.",
      true,
      status
    );
  }
  return new GoogleApiError("invalid_request", "Google rechazó la solicitud.", false, status);
}

async function googleFetch(input: {
  url: string;
  context: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.url, {
      method: input.method ?? "GET",
      headers: input.headers,
      body: input.body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    if (controller.signal.aborted) {
      throw new GoogleApiError("timeout", "Google no respondió a tiempo.", true);
    }
    throw new GoogleApiError("network_error", "No se pudo conectar con Google.", true);
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw responseError(response.status, input.context);
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new GoogleApiError("invalid_response", "Google devolvió una respuesta no válida.");
  }
}

/** URL de consentimiento oficial. El state es de un solo uso (ver state.ts). */
export function buildGoogleAuthUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", getGoogleClientId());
  url.searchParams.set("redirect_uri", getGoogleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  return url.toString();
}

function parseTokens(raw: unknown): GoogleTokens {
  const parsed = tokenResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GoogleApiError("invalid_response", "Google devolvió una respuesta no válida.");
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
    scope: parsed.data.scope?.split(" ").filter(Boolean) ?? [],
  };
}

export async function exchangeAuthorizationCode(
  code: string,
  fetchImpl?: typeof fetch
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });
  const raw = await googleFetch({
    url: "https://oauth2.googleapis.com/token",
    context: "token_exchange",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    fetchImpl,
  });
  return parseTokens(raw);
}

export async function refreshAccessToken(
  refreshToken: string,
  fetchImpl?: typeof fetch
): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    grant_type: "refresh_token",
  });
  const raw = await googleFetch({
    url: "https://oauth2.googleapis.com/token",
    context: "token_refresh",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    fetchImpl,
  });
  return parseTokens(raw);
}

/** Revoca el token en Google. Best effort: no lanza si ya estaba revocado. */
export async function revokeGoogleToken(
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  try {
    const body = new URLSearchParams({ token });
    await googleFetch({
      url: "https://oauth2.googleapis.com/revoke",
      context: "token_revoke",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      fetchImpl,
    });
  } catch {
    // La desconexión local continúa aunque Google no confirme la revocación.
  }
}

export async function fetchCalendarList(
  accessToken: string,
  fetchImpl?: typeof fetch
): Promise<GoogleCalendarItem[]> {
  const raw = await googleFetch({
    url: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250",
    context: "calendar_list",
    headers: { Authorization: `Bearer ${accessToken}` },
    fetchImpl,
  });
  const parsed = calendarListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GoogleApiError("invalid_response", "Google devolvió una respuesta no válida.");
  }
  return parsed.data.items.map((item) => ({
    id: item.id,
    name: item.summary ?? item.id,
    primary: item.primary ?? false,
  }));
}

/** Consulta FreeBusy para un único calendario previamente validado y guardado. */
export async function fetchCalendarFreeBusy(
  input: {
    accessToken: string;
    calendarId: string;
    timeMin: Date;
    timeMax: Date;
    timeZone: string;
  },
  fetchImpl?: typeof fetch
): Promise<GoogleBusyInterval[]> {
  if (
    input.calendarId.length < 1 ||
    input.calendarId.length > 512 ||
    !Number.isFinite(input.timeMin.getTime()) ||
    !Number.isFinite(input.timeMax.getTime()) ||
    input.timeMin >= input.timeMax
  ) {
    throw new GoogleApiError("invalid_request", "El rango de disponibilidad no es válido.");
  }
  const raw = await googleFetch({
    url: "https://www.googleapis.com/calendar/v3/freeBusy",
    context: "free_busy",
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      timeZone: input.timeZone,
      items: [{ id: input.calendarId }],
    }),
    fetchImpl,
  });
  const parsed = freeBusyResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GoogleApiError("invalid_response", "Google devolvió una respuesta no válida.");
  }
  const calendar = parsed.data.calendars[input.calendarId];
  if (!calendar || (calendar.errors?.length ?? 0) > 0) {
    throw new GoogleApiError(
      "permission_denied",
      "Google no permitió consultar el calendario seleccionado."
    );
  }
  return calendar.busy.map((interval) => ({
    start: new Date(interval.start),
    end: new Date(interval.end),
  }));
}
