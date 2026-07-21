import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { decryptAccessToken, encryptAccessToken } from "@/server/whatsapp/crypto";
import {
  GOOGLE_SHEETS_SCOPES,
  GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_MS,
  getGoogleSheetsConfigurationStatus,
  type GoogleSheetsConfigurationIssue,
} from "@/server/integrations/google-sheets/config";
import {
  GoogleSheetsApiError,
  createGoogleSpreadsheet,
  ensureSheetTabs,
  getGoogleSpreadsheet,
  refreshGoogleSheetsAccessToken,
  replaceSheetValues,
  revokeGoogleSheetsToken,
  type GoogleSheetsTokens,
} from "@/server/integrations/google-sheets/oauth";
import {
  buildOrganizationExports,
  type GoogleSheetsDataset,
} from "@/server/integrations/google-sheets/export-data";

export type GoogleSheetsView = {
  planAccess: boolean;
  planMessage: string | null;
  configured: boolean;
  configurationIssue: GoogleSheetsConfigurationIssue | null;
  configurationMessage: string | null;
  connected: boolean;
  reconnectionRequired: boolean;
  status: "CONNECTED" | "ERROR" | null;
  spreadsheetName: string | null;
  spreadsheetSelected: boolean;
  lastSyncedAt: string | null;
  lastSyncRows: { clients?: number; conversations?: number; metrics?: number } | null;
  lastError: string | null;
};

export async function getGoogleSheetsView(organizationId: string): Promise<GoogleSheetsView> {
  const configuration = getGoogleSheetsConfigurationStatus();
  const [connection, entitlement] = await Promise.all([
    prisma.googleSheetsConnection.findUnique({
      where: { organizationId },
      select: {
        status: true,
        selectedSpreadsheetId: true,
        selectedSpreadsheetName: true,
        grantedScopes: true,
        lastSyncedAt: true,
        lastSyncRows: true,
        lastError: true,
      },
    }),
    getOrganizationEntitlement(organizationId),
  ]);
  const planAccess = entitlement.accessAllowed && hasPlanFeature(entitlement, "google_sheets");
  const reconnectionRequired = Boolean(connection) &&
    !GOOGLE_SHEETS_SCOPES.every((scope) => connection?.grantedScopes.includes(scope));
  return {
    planAccess,
    planMessage: planAccess ? null : "Google Sheets está disponible desde el plan Standard.",
    configured: configuration.configured,
    configurationIssue: configuration.issue,
    configurationMessage: configuration.message,
    connected: Boolean(connection),
    reconnectionRequired,
    status: connection?.status ?? null,
    spreadsheetName: connection?.selectedSpreadsheetName ?? null,
    spreadsheetSelected: Boolean(connection?.selectedSpreadsheetId),
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    lastSyncRows:
      connection?.lastSyncRows && typeof connection.lastSyncRows === "object"
        ? connection.lastSyncRows as GoogleSheetsView["lastSyncRows"]
        : null,
    lastError: connection?.lastError ?? null,
  };
}

export async function saveGoogleSheetsConnection(input: {
  organizationId: string;
  userId: string;
  tokens: GoogleSheetsTokens;
}): Promise<{ ok: true } | { ok: false; code: "missing_refresh_token" }> {
  if (!input.tokens.refreshToken) return { ok: false, code: "missing_refresh_token" };
  await prisma.googleSheetsConnection.upsert({
    where: { organizationId: input.organizationId },
    create: {
      organizationId: input.organizationId,
      status: "CONNECTED",
      grantedScopes: input.tokens.scope,
      encryptedAccessToken: encryptAccessToken(input.tokens.accessToken),
      encryptedRefreshToken: encryptAccessToken(input.tokens.refreshToken),
      accessTokenExpiresAt: input.tokens.expiresAt,
      connectedByUserId: input.userId,
    },
    update: {
      status: "CONNECTED",
      grantedScopes: input.tokens.scope,
      encryptedAccessToken: encryptAccessToken(input.tokens.accessToken),
      encryptedRefreshToken: encryptAccessToken(input.tokens.refreshToken),
      accessTokenExpiresAt: input.tokens.expiresAt,
      connectedByUserId: input.userId,
      lastError: null,
    },
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_sheets_conectado",
    entityType: "google_sheets_connection",
  });
  return { ok: true };
}

export async function getValidGoogleSheetsAccessToken(
  organizationId: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const connection = await prisma.googleSheetsConnection.findUnique({
    where: { organizationId },
    select: {
      encryptedAccessToken: true,
      encryptedRefreshToken: true,
      accessTokenExpiresAt: true,
      grantedScopes: true,
    },
  });
  if (!connection) throw new GoogleSheetsApiError("not_configured", "Google Sheets no está conectado.");
  if (!GOOGLE_SHEETS_SCOPES.every((scope) => connection.grantedScopes.includes(scope))) {
    throw new GoogleSheetsApiError("permission_denied", "Reconectá Google Sheets para autorizar la sincronización.");
  }
  if (connection.accessTokenExpiresAt.getTime() - GOOGLE_SHEETS_TOKEN_EXPIRY_BUFFER_MS > Date.now()) {
    return decryptAccessToken(connection.encryptedAccessToken);
  }
  try {
    const refreshed = await refreshGoogleSheetsAccessToken(
      decryptAccessToken(connection.encryptedRefreshToken),
      fetchImpl
    );
    await prisma.googleSheetsConnection.updateMany({
      where: { organizationId },
      data: {
        status: "CONNECTED",
        encryptedAccessToken: encryptAccessToken(refreshed.accessToken),
        accessTokenExpiresAt: refreshed.expiresAt,
        lastError: null,
      },
    });
    return refreshed.accessToken;
  } catch (error) {
    const safe = error instanceof GoogleSheetsApiError
      ? error.safeMessage
      : "No se pudo renovar la autorización con Google.";
    await prisma.googleSheetsConnection.updateMany({
      where: { organizationId },
      data: { status: "ERROR", lastError: safe },
    });
    throw error;
  }
}

export function parseSpreadsheetReference(value: string): string | null {
  const normalized = value.trim();
  if (/^[a-zA-Z0-9_-]{20,256}$/.test(normalized)) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" || !["docs.google.com", "sheets.google.com"].includes(url.hostname)) return null;
    const match = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,256})/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function chooseGoogleSpreadsheet(
  input: { organizationId: string; userId: string; reference: string },
  fetchImpl?: typeof fetch
) {
  const spreadsheetId = parseSpreadsheetReference(input.reference);
  if (!spreadsheetId) return { ok: false as const, code: "invalid_reference" as const };
  const token = await getValidGoogleSheetsAccessToken(input.organizationId, fetchImpl);
  const spreadsheet = await getGoogleSpreadsheet(token, spreadsheetId, fetchImpl);
  await prisma.googleSheetsConnection.updateMany({
    where: { organizationId: input.organizationId },
    data: {
      status: "CONNECTED",
      selectedSpreadsheetId: spreadsheet.id,
      selectedSpreadsheetName: spreadsheet.name,
      lastError: null,
    },
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_sheets_hoja_elegida",
    entityType: "google_sheets_connection",
    details: { hoja: spreadsheet.name.slice(0, 120) },
  });
  return { ok: true as const, name: spreadsheet.name };
}

export async function createAndChooseGoogleSpreadsheet(
  input: { organizationId: string; userId: string; name: string },
  fetchImpl?: typeof fetch
) {
  const token = await getValidGoogleSheetsAccessToken(input.organizationId, fetchImpl);
  const spreadsheet = await createGoogleSpreadsheet(token, input.name, fetchImpl);
  await prisma.googleSheetsConnection.updateMany({
    where: { organizationId: input.organizationId },
    data: {
      status: "CONNECTED",
      selectedSpreadsheetId: spreadsheet.id,
      selectedSpreadsheetName: spreadsheet.name,
      lastError: null,
    },
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_sheets_hoja_creada",
    entityType: "google_sheets_connection",
    details: { hoja: spreadsheet.name.slice(0, 120) },
  });
  return { ok: true as const, name: spreadsheet.name };
}

function safeError(error: unknown): string {
  return error instanceof GoogleSheetsApiError
    ? error.safeMessage
    : "No se pudo sincronizar con Google Sheets.";
}

export async function syncGoogleSheets(input: {
  organizationId: string;
  userId: string;
  datasets: GoogleSheetsDataset[];
  idempotencyKey: string;
}, fetchImpl?: typeof fetch): Promise<
  | { ok: true; rows: Record<string, number>; repeated: boolean }
  | { ok: false; code: "in_progress"; message: string }
> {
  const connection = await prisma.googleSheetsConnection.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true, selectedSpreadsheetId: true },
  });
  if (!connection?.selectedSpreadsheetId) {
    throw new GoogleSheetsApiError("not_configured", "Elegí una hoja antes de sincronizar.");
  }
  const key = { organizationId_idempotencyKey: {
    organizationId: input.organizationId,
    idempotencyKey: input.idempotencyKey,
  } };
  let run = await prisma.googleSheetsSyncRun.findUnique({ where: key });
  if (run?.status === "SUCCEEDED") {
    const rows = await prisma.googleSheetsConnection.findUnique({
      where: { organizationId: input.organizationId }, select: { lastSyncRows: true },
    });
    return { ok: true, rows: (rows?.lastSyncRows ?? {}) as Record<string, number>, repeated: true };
  }
  if (run?.status === "RUNNING") {
    return { ok: false, code: "in_progress", message: "Ya hay una sincronización en curso." };
  }
  if (run?.status === "FAILED") {
    const claimed = await prisma.googleSheetsSyncRun.updateMany({
      where: { id: run.id, organizationId: input.organizationId, status: "FAILED" },
      data: { status: "RUNNING", attempts: { increment: 1 }, lastError: null, completedAt: null },
    });
    if (claimed.count !== 1) return { ok: false, code: "in_progress", message: "Ya hay una sincronización en curso." };
  } else {
    try {
      run = await prisma.googleSheetsSyncRun.create({
        data: {
          organizationId: input.organizationId,
          connectionId: connection.id,
          idempotencyKey: input.idempotencyKey,
          datasets: input.datasets,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { ok: false, code: "in_progress", message: "Ya hay una sincronización en curso." };
      }
      throw error;
    }
  }

  try {
    const token = await getValidGoogleSheetsAccessToken(input.organizationId, fetchImpl);
    const spreadsheet = await getGoogleSpreadsheet(token, connection.selectedSpreadsheetId, fetchImpl);
    const exports = await buildOrganizationExports(input.organizationId, input.datasets);
    await ensureSheetTabs(token, spreadsheet, exports.map((item) => item.sheetName), fetchImpl);
    for (const item of exports) {
      await replaceSheetValues(token, spreadsheet.id, item.sheetName, item.values, fetchImpl);
    }
    const rows = Object.fromEntries(exports.map((item) => [
      item.sheetName === "Clientes" ? "clients" : item.sheetName === "Conversaciones" ? "conversations" : "metrics",
      item.dataRows,
    ]));
    const now = new Date();
    await prisma.$transaction([
      prisma.googleSheetsSyncRun.updateMany({
        where: { id: run!.id, organizationId: input.organizationId, status: "RUNNING" },
        data: { status: "SUCCEEDED", rowsExported: exports.reduce((sum, item) => sum + item.dataRows, 0), completedAt: now },
      }),
      prisma.googleSheetsConnection.updateMany({
        where: { id: connection.id, organizationId: input.organizationId },
        data: { status: "CONNECTED", lastSyncedAt: now, lastSyncRows: rows, lastError: null },
      }),
    ]);
    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "integraciones.google_sheets_sincronizado",
      entityType: "google_sheets_sync_run",
      entityId: run!.id,
      details: { datasets: input.datasets, rows },
    });
    return { ok: true, rows, repeated: false };
  } catch (error) {
    const message = safeError(error);
    await prisma.$transaction([
      prisma.googleSheetsSyncRun.updateMany({
        where: { id: run!.id, organizationId: input.organizationId, status: "RUNNING" },
        data: { status: "FAILED", lastError: message, completedAt: new Date() },
      }),
      prisma.googleSheetsConnection.updateMany({
        where: { id: connection.id, organizationId: input.organizationId },
        data: { status: "ERROR", lastError: message },
      }),
    ]);
    throw error;
  }
}

export async function disconnectGoogleSheets(
  input: { organizationId: string; userId: string },
  fetchImpl?: typeof fetch
) {
  const connection = await prisma.googleSheetsConnection.findUnique({
    where: { organizationId: input.organizationId },
    select: { id: true, encryptedRefreshToken: true },
  });
  if (!connection) return { ok: false as const };
  await revokeGoogleSheetsToken(decryptAccessToken(connection.encryptedRefreshToken), fetchImpl);
  await prisma.googleSheetsConnection.deleteMany({
    where: { id: connection.id, organizationId: input.organizationId },
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.google_sheets_desconectado",
    entityType: "google_sheets_connection",
  });
  return { ok: true as const };
}
