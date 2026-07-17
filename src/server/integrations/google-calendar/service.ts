import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import {
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";
import {
  ACCESS_TOKEN_EXPIRY_BUFFER_MS,
  hasRequiredGoogleCalendarScopes,
  isGoogleCalendarConfigured,
} from "@/server/integrations/google-calendar/config";
import {
  GoogleApiError,
  fetchCalendarList,
  refreshAccessToken,
  revokeGoogleToken,
  type GoogleCalendarItem,
  type GoogleTokens,
} from "@/server/integrations/google-calendar/oauth";

/**
 * Servicio de la conexión Google Calendar. Los tokens SIEMPRE se guardan
 * cifrados con AES-256-GCM (mismo esquema que WhatsApp) y nunca salen del
 * servidor. Todas las consultas están aisladas por organizationId.
 */

export type GoogleCalendarView = {
  configured: boolean;
  connected: boolean;
  writeAccess: boolean;
  reconnectionRequired: boolean;
  status: "CONNECTED" | "ERROR" | null;
  googleEmail: string | null;
  selectedCalendarId: string | null;
  selectedCalendarName: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
};

/** Vista segura para la UI: jamás incluye tokens ni material cifrado. */
export async function getGoogleCalendarView(
  organizationId: string
): Promise<GoogleCalendarView> {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { organizationId },
    select: {
      status: true,
      googleEmail: true,
      selectedCalendarId: true,
      selectedCalendarName: true,
      grantedScopes: true,
      lastTestedAt: true,
      lastError: true,
    },
  });
  const writeAccess = connection
    ? hasRequiredGoogleCalendarScopes(connection.grantedScopes)
    : false;
  return {
    configured: isGoogleCalendarConfigured(),
    connected: Boolean(connection),
    writeAccess,
    reconnectionRequired: Boolean(connection) && !writeAccess,
    status: connection?.status ?? null,
    googleEmail: connection?.googleEmail ?? null,
    selectedCalendarId: connection?.selectedCalendarId ?? null,
    selectedCalendarName: connection?.selectedCalendarName ?? null,
    lastTestedAt: connection?.lastTestedAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
  };
}

/**
 * Persiste la conexión tras el intercambio OAuth. En reconexión se reemplazan
 * los tokens; el refresh token es obligatorio (se pide con prompt=consent).
 */
export async function saveGoogleConnection(input: {
  organizationId: string;
  userId: string;
  tokens: GoogleTokens;
  googleEmail: string | null;
}): Promise<{ ok: true } | { ok: false; code: "missing_refresh_token" }> {
  if (!input.tokens.refreshToken) {
    return { ok: false, code: "missing_refresh_token" };
  }
  const data = {
    status: "CONNECTED" as const,
    googleEmail: input.googleEmail,
    grantedScopes: input.tokens.scope,
    encryptedAccessToken: encryptAccessToken(input.tokens.accessToken),
    encryptedRefreshToken: encryptAccessToken(input.tokens.refreshToken),
    accessTokenExpiresAt: input.tokens.expiresAt,
    connectedByUserId: input.userId,
    lastError: null,
  };
  await prisma.googleCalendarConnection.upsert({
    where: { organizationId: input.organizationId },
    create: { organizationId: input.organizationId, ...data },
    update: data,
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_calendar_conectado",
    entityType: "google_calendar_connection",
  });
  return { ok: true };
}

/**
 * Devuelve un access token vigente, refrescándolo si está por vencer.
 * El token refrescado se persiste cifrado.
 */
export async function getValidAccessToken(
  organizationId: string,
  fetchImpl?: typeof fetch,
  options: { requireEventManagement?: boolean } = {}
): Promise<string> {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { organizationId },
    select: {
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
      accessTokenExpiresAt: true,
      status: true,
      grantedScopes: true,
    },
  });
  if (!connection) {
    throw new GoogleApiError("not_configured", "Google Calendar no está conectado.");
  }
  if (options.requireEventManagement) {
    if (connection.status !== "CONNECTED") {
      throw new GoogleApiError(
        "authorization_expired",
        "La conexión con Google requiere atención. Reconectá la cuenta."
      );
    }
    if (!hasRequiredGoogleCalendarScopes(connection.grantedScopes)) {
      throw new GoogleApiError(
        "permission_denied",
        "Reconectá Google Calendar para autorizar la gestión de turnos."
      );
    }
  }

  const expiresSoon =
    connection.accessTokenExpiresAt.getTime() - ACCESS_TOKEN_EXPIRY_BUFFER_MS <=
    Date.now();
  if (!expiresSoon) {
    return decryptAccessToken(connection.encryptedAccessToken);
  }

  const refreshToken = decryptAccessToken(connection.encryptedRefreshToken);
  try {
    const tokens = await refreshAccessToken(refreshToken, fetchImpl);
    await prisma.googleCalendarConnection.updateMany({
      where: { organizationId },
      data: {
        status: "CONNECTED",
        encryptedAccessToken: encryptAccessToken(tokens.accessToken),
        accessTokenExpiresAt: tokens.expiresAt,
        lastError: null,
      },
    });
    return tokens.accessToken;
  } catch (error) {
    const safe =
      error instanceof GoogleApiError
        ? error.safeMessage
        : "No se pudo renovar la autorización con Google.";
    await prisma.googleCalendarConnection.updateMany({
      where: { organizationId },
      data: { status: "ERROR", lastError: safe },
    });
    throw error;
  }
}

export async function listGoogleCalendars(
  organizationId: string,
  fetchImpl?: typeof fetch
): Promise<GoogleCalendarItem[]> {
  const accessToken = await getValidAccessToken(organizationId, fetchImpl);
  return fetchCalendarList(accessToken, fetchImpl);
}

/** Elige el calendario de trabajo; valida que pertenezca a la cuenta. */
export async function selectGoogleCalendar(
  input: { organizationId: string; userId: string; calendarId: string },
  fetchImpl?: typeof fetch
): Promise<{ ok: true; name: string } | { ok: false; code: "calendar_not_found" }> {
  const calendars = await listGoogleCalendars(input.organizationId, fetchImpl);
  const match = calendars.find((calendar) => calendar.id === input.calendarId);
  if (!match) return { ok: false, code: "calendar_not_found" };

  await prisma.googleCalendarConnection.updateMany({
    where: { organizationId: input.organizationId },
    data: { selectedCalendarId: match.id, selectedCalendarName: match.name },
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_calendar_calendario_elegido",
    entityType: "google_calendar_connection",
    details: { calendario: match.name.slice(0, 120) },
  });
  return { ok: true, name: match.name };
}

/** Prueba la conexión listando calendarios; actualiza estado y timestamp. */
export async function testGoogleCalendarConnection(
  organizationId: string,
  fetchImpl?: typeof fetch
): Promise<{ ok: true; calendars: number } | { ok: false; message: string }> {
  try {
    const calendars = await listGoogleCalendars(organizationId, fetchImpl);
    await prisma.googleCalendarConnection.updateMany({
      where: { organizationId },
      data: { status: "CONNECTED", lastTestedAt: new Date(), lastError: null },
    });
    return { ok: true, calendars: calendars.length };
  } catch (error) {
    const safe =
      error instanceof GoogleApiError
        ? error.safeMessage
        : "No se pudo probar la conexión con Google.";
    await prisma.googleCalendarConnection.updateMany({
      where: { organizationId },
      data: { status: "ERROR", lastTestedAt: new Date(), lastError: safe },
    });
    return { ok: false, message: safe };
  }
}

/** Desconecta: revoca en Google (best effort) y elimina los tokens locales. */
export async function disconnectGoogleCalendar(
  input: { organizationId: string; userId: string },
  fetchImpl?: typeof fetch
): Promise<{ ok: true } | { ok: false; code: "not_connected" }> {
  const connection = await prisma.googleCalendarConnection.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true, encryptedRefreshToken: true },
  });
  if (!connection) return { ok: false, code: "not_connected" };

  try {
    await revokeGoogleToken(
      decryptAccessToken(connection.encryptedRefreshToken),
      fetchImpl
    );
  } catch {
    // Best effort: la conexión local se elimina igual.
  }
  await prisma.googleCalendarConnection.deleteMany({
    where: { id: connection.id, organizationId: input.organizationId },
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_calendar_desconectado",
    entityType: "google_calendar_connection",
  });
  return { ok: true };
}
