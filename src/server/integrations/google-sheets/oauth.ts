import { z } from "zod";
import {
  GOOGLE_SHEETS_REQUEST_TIMEOUT_MS,
  GOOGLE_SHEETS_SCOPES,
  getGoogleSheetsClientId,
  getGoogleSheetsClientSecret,
  getGoogleSheetsRedirectUri,
} from "@/server/integrations/google-sheets/config";

export type GoogleSheetsErrorCode =
  | "not_configured"
  | "authorization_expired"
  | "permission_denied"
  | "rate_limited"
  | "timeout"
  | "network_error"
  | "google_unavailable"
  | "invalid_response"
  | "invalid_request"
  | "not_found";

export class GoogleSheetsApiError extends Error {
  constructor(
    readonly code: GoogleSheetsErrorCode,
    readonly safeMessage: string,
    readonly retryable = false
  ) {
    super(safeMessage);
    this.name = "GoogleSheetsApiError";
  }
}

const tokenSchema = z.object({
  access_token: z.string().min(10).max(4096),
  refresh_token: z.string().min(10).max(4096).optional(),
  expires_in: z.number().int().min(1).max(86_400),
  scope: z.string().max(2000).optional(),
}).passthrough();

const spreadsheetSchema = z.object({
  spreadsheetId: z.string().min(10).max(256),
  properties: z.object({ title: z.string().min(1).max(500) }).passthrough(),
  sheets: z.array(z.object({
    properties: z.object({ title: z.string().min(1).max(100) }).passthrough(),
  }).passthrough()).max(200).optional(),
}).passthrough();

export type GoogleSheetsTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
  scope: string[];
};

export type GoogleSpreadsheet = {
  id: string;
  name: string;
  sheetNames: string[];
};

function errorForStatus(status: number, context: string): GoogleSheetsApiError {
  console.error(`[VantixApp] Google Sheets error endpoint=${context} status=${status}`);
  if (status === 401) {
    return new GoogleSheetsApiError(
      "authorization_expired",
      "La autorización con Google venció. Reconectá la cuenta."
    );
  }
  if (status === 403) {
    return new GoogleSheetsApiError(
      "permission_denied",
      "Google no autorizó el acceso a esa hoja."
    );
  }
  if (status === 404) {
    return new GoogleSheetsApiError("not_found", "No encontramos esa hoja en Google.");
  }
  if (status === 429) {
    return new GoogleSheetsApiError(
      "rate_limited",
      "Google limitó temporalmente las solicitudes.",
      true
    );
  }
  if (status >= 500) {
    return new GoogleSheetsApiError(
      "google_unavailable",
      "Google Sheets no está disponible temporalmente.",
      true
    );
  }
  return new GoogleSheetsApiError("invalid_request", "Google rechazó la solicitud.");
}

export async function googleSheetsFetch(
  input: {
    url: string;
    context: string;
    method?: "GET" | "POST" | "PUT";
    headers?: Record<string, string>;
    body?: string;
    retries?: number;
  },
  fetchImpl: typeof fetch = fetch
): Promise<unknown> {
  const retries = Math.min(Math.max(input.retries ?? 0, 0), 2);
  for (let attempt = 0; ; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GOOGLE_SHEETS_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchImpl(input.url, {
        method: input.method ?? "GET",
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        const error = errorForStatus(response.status, input.context);
        if (error.retryable && attempt < retries) continue;
        throw error;
      }
      if (response.status === 204) return null;
      try {
        return await response.json() as unknown;
      } catch {
        throw new GoogleSheetsApiError(
          "invalid_response",
          "Google devolvió una respuesta no válida."
        );
      }
    } catch (error) {
      if (error instanceof GoogleSheetsApiError) throw error;
      const safe = controller.signal.aborted
        ? new GoogleSheetsApiError("timeout", "Google no respondió a tiempo.", true)
        : new GoogleSheetsApiError("network_error", "No se pudo conectar con Google.", true);
      if (attempt < retries) continue;
      throw safe;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseTokens(raw: unknown): GoogleSheetsTokens {
  const parsed = tokenSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GoogleSheetsApiError("invalid_response", "Google devolvió una respuesta no válida.");
  }
  return {
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresAt: new Date(Date.now() + parsed.data.expires_in * 1000),
    scope: parsed.data.scope?.split(" ").filter(Boolean) ?? [],
  };
}

export function buildGoogleSheetsAuthUrl(state: string): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", getGoogleSheetsClientId());
  url.searchParams.set("redirect_uri", getGoogleSheetsRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SHEETS_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleSheetsCode(
  code: string,
  fetchImpl?: typeof fetch
): Promise<GoogleSheetsTokens> {
  const body = new URLSearchParams({
    code,
    client_id: getGoogleSheetsClientId(),
    client_secret: getGoogleSheetsClientSecret(),
    redirect_uri: getGoogleSheetsRedirectUri(),
    grant_type: "authorization_code",
  });
  return parseTokens(await googleSheetsFetch({
    url: "https://oauth2.googleapis.com/token",
    context: "token_exchange",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, fetchImpl));
}

export async function refreshGoogleSheetsAccessToken(
  refreshToken: string,
  fetchImpl?: typeof fetch
): Promise<GoogleSheetsTokens> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: getGoogleSheetsClientId(),
    client_secret: getGoogleSheetsClientSecret(),
    grant_type: "refresh_token",
  });
  return parseTokens(await googleSheetsFetch({
    url: "https://oauth2.googleapis.com/token",
    context: "token_refresh",
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  }, fetchImpl));
}

export async function revokeGoogleSheetsToken(token: string, fetchImpl?: typeof fetch) {
  try {
    await googleSheetsFetch({
      url: "https://oauth2.googleapis.com/revoke",
      context: "token_revoke",
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    }, fetchImpl);
  } catch {
    // Best effort: la desconexión local debe continuar.
  }
}

function parseSpreadsheet(raw: unknown): GoogleSpreadsheet {
  const parsed = spreadsheetSchema.safeParse(raw);
  if (!parsed.success) {
    throw new GoogleSheetsApiError("invalid_response", "Google devolvió una hoja no válida.");
  }
  return {
    id: parsed.data.spreadsheetId,
    name: parsed.data.properties.title,
    sheetNames: parsed.data.sheets?.map((sheet) => sheet.properties.title) ?? [],
  };
}

export async function getGoogleSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  fetchImpl?: typeof fetch
): Promise<GoogleSpreadsheet> {
  const id = encodeURIComponent(spreadsheetId);
  const raw = await googleSheetsFetch({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId,properties.title,sheets.properties.title`,
    context: "spreadsheet_get",
    headers: { Authorization: `Bearer ${accessToken}` },
    retries: 1,
  }, fetchImpl);
  return parseSpreadsheet(raw);
}

export async function createGoogleSpreadsheet(
  accessToken: string,
  title: string,
  fetchImpl?: typeof fetch
): Promise<GoogleSpreadsheet> {
  const raw = await googleSheetsFetch({
    url: "https://sheets.googleapis.com/v4/spreadsheets",
    context: "spreadsheet_create",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ properties: { title } }),
    retries: 1,
  }, fetchImpl);
  return parseSpreadsheet(raw);
}

export async function ensureSheetTabs(
  accessToken: string,
  spreadsheet: GoogleSpreadsheet,
  names: string[],
  fetchImpl?: typeof fetch
): Promise<void> {
  const missing = names.filter((name) => !spreadsheet.sheetNames.includes(name));
  if (!missing.length) return;
  await googleSheetsFetch({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheet.id)}:batchUpdate`,
    context: "tabs_create",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title } } })) }),
    retries: 2,
  }, fetchImpl);
}

export async function replaceSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  values: (string | number | boolean)[][],
  fetchImpl?: typeof fetch
): Promise<void> {
  const range = encodeURIComponent(`'${sheetName.replaceAll("'", "''")}'!A:Z`);
  await googleSheetsFetch({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:clear`,
    context: "values_clear",
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: "{}",
    retries: 2,
  }, fetchImpl);
  await googleSheetsFetch({
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`,
    context: "values_update",
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ range: `'${sheetName}'!A1`, majorDimension: "ROWS", values }),
    retries: 2,
  }, fetchImpl);
}
