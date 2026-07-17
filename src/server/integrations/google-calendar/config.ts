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

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new GoogleCalendarConfigurationError(`Falta la variable ${name}.`);
  return value;
}

export function getGoogleClientId(): string {
  return requireEnv("GOOGLE_CLIENT_ID");
}

export function getGoogleClientSecret(): string {
  return requireEnv("GOOGLE_CLIENT_SECRET");
}

/**
 * URL de callback derivada SIEMPRE de la configuración del servidor
 * (BETTER_AUTH_URL), nunca de parámetros del navegador.
 */
export function getGoogleRedirectUri(): string {
  const base = requireEnv("BETTER_AUTH_URL");
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

/** Indica si la integración está configurada, sin exponer valores. */
export function isGoogleCalendarConfigured(): boolean {
  try {
    getGoogleClientId();
    getGoogleClientSecret();
    getGoogleRedirectUri();
    return true;
  } catch {
    return false;
  }
}
