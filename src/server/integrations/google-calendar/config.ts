/**
 * Configuración de Google Calendar (Etapa 6D.1A). Los secretos viven SOLO en
 * variables de entorno del servidor; nunca se exponen al navegador ni a logs.
 */

export class GoogleCalendarConfigurationError extends Error {
  constructor(message = "Google Calendar no está configurado.") {
    super(message);
    this.name = "GoogleCalendarConfigurationError";
  }
}

/** Scopes mínimos separados para listar, consultar FreeBusy y gestionar eventos. */
export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.freebusy",
  "https://www.googleapis.com/auth/calendar.events",
] as const;

const GOOGLE_CALENDAR_FULL_SCOPE = "https://www.googleapis.com/auth/calendar";

/** Una conexión readonly previa debe reconectarse antes de escribir eventos. */
export function hasRequiredGoogleCalendarScopes(scopes: readonly string[]): boolean {
  const granted = new Set(scopes);
  if (granted.has(GOOGLE_CALENDAR_FULL_SCOPE)) return true;
  return GOOGLE_CALENDAR_SCOPES.every((scope) => granted.has(scope));
}

export const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutos
/** Margen antes del vencimiento real para refrescar el access token. */
export const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;

function requireEnv(value: string | undefined, name: string): string {
  value = value?.trim();
  if (!value) throw new GoogleCalendarConfigurationError(`Falta la variable ${name}.`);
  return value;
}

export function getGoogleClientId(): string {
  return requireEnv(process.env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID");
}

export function getGoogleClientSecret(): string {
  return requireEnv(process.env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET");
}

/**
 * URL de callback derivada SIEMPRE de la configuración del servidor
 * (BETTER_AUTH_URL), nunca de parámetros del navegador.
 */
export function getGoogleRedirectUri(): string {
  const base = requireEnv(process.env.BETTER_AUTH_URL, "BETTER_AUTH_URL");
  let url: URL;
  try {
    url = new URL("/api/integrations/google-calendar/callback", base);
  } catch {
    throw new GoogleCalendarConfigurationError("BETTER_AUTH_URL no es válida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new GoogleCalendarConfigurationError("BETTER_AUTH_URL no es válida.");
  }
  return url.toString();
}

export type GoogleCalendarConfigurationIssue =
  | "oauth_credentials"
  | "application_url";

export type GoogleCalendarConfigurationStatus =
  | { configured: true; issue: null; message: null }
  | {
      configured: false;
      issue: GoogleCalendarConfigurationIssue;
      message: string;
    };

/**
 * Diagnóstico seguro evaluado en runtime. Solo expone la categoría faltante;
 * nunca nombres de variables, valores ni secretos.
 */
export function getGoogleCalendarConfigurationStatus(): GoogleCalendarConfigurationStatus {
  if (
    !process.env.GOOGLE_CLIENT_ID?.trim() ||
    !process.env.GOOGLE_CLIENT_SECRET?.trim()
  ) {
    return {
      configured: false,
      issue: "oauth_credentials",
      message:
        "Falta completar las credenciales OAuth de Google para este entorno.",
    };
  }

  try {
    getGoogleRedirectUri();
  } catch {
    return {
      configured: false,
      issue: "application_url",
      message:
        "Falta configurar una URL pública válida para el callback de Google.",
    };
  }

  return { configured: true, issue: null, message: null };
}

/** Indica si la integración está configurada, sin exponer valores. */
export function isGoogleCalendarConfigured(): boolean {
  return getGoogleCalendarConfigurationStatus().configured;
}
