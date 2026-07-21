export class GoogleSheetsConfigurationError extends Error {
  constructor(message = "Google Sheets no está configurado.") {
    super(message);
    this.name = "GoogleSheetsConfigurationError";
  }
}

export const GOOGLE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

export const GOOGLE_SHEETS_REQUEST_TIMEOUT_MS = 10_000;
export const GOOGLE_SHEETS_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

function requireEnv(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new GoogleSheetsConfigurationError(`Falta la variable ${name}.`);
  }
  return normalized;
}

export function getGoogleSheetsClientId(): string {
  return requireEnv(process.env.GOOGLE_SHEETS_CLIENT_ID, "GOOGLE_SHEETS_CLIENT_ID");
}

export function getGoogleSheetsClientSecret(): string {
  return requireEnv(
    process.env.GOOGLE_SHEETS_CLIENT_SECRET,
    "GOOGLE_SHEETS_CLIENT_SECRET"
  );
}

export function getGoogleSheetsRedirectUri(): string {
  const base = requireEnv(process.env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  let url: URL;
  try {
    url = new URL("/api/integrations/google-sheets/callback", base);
  } catch {
    throw new GoogleSheetsConfigurationError("La URL pública no es válida.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new GoogleSheetsConfigurationError("La URL pública no es válida.");
  }
  return url.toString();
}

export type GoogleSheetsConfigurationIssue =
  | "oauth_credentials"
  | "application_url";

export function getGoogleSheetsConfigurationStatus():
  | { configured: true; issue: null; message: null }
  | {
      configured: false;
      issue: GoogleSheetsConfigurationIssue;
      message: string;
    } {
  if (
    !process.env.GOOGLE_SHEETS_CLIENT_ID?.trim() ||
    !process.env.GOOGLE_SHEETS_CLIENT_SECRET?.trim()
  ) {
    return {
      configured: false,
      issue: "oauth_credentials",
      message: "Falta completar la conexión OAuth de Google Sheets.",
    };
  }
  try {
    getGoogleSheetsRedirectUri();
  } catch {
    return {
      configured: false,
      issue: "application_url",
      message: "Falta configurar una URL pública válida para Google Sheets.",
    };
  }
  return { configured: true, issue: null, message: null };
}
