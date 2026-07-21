-- Google Sheets: conexión OAuth aislada, state de un solo uso y ledger de sincronizaciones.
CREATE TYPE "GoogleSheetsConnectionStatus" AS ENUM ('CONNECTED', 'ERROR');
CREATE TYPE "GoogleSheetsSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "google_sheets_connections" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" "GoogleSheetsConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
  "selectedSpreadsheetId" TEXT,
  "selectedSpreadsheetName" TEXT,
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "encryptedAccessToken" TEXT NOT NULL,
  "encryptedRefreshToken" TEXT NOT NULL,
  "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "connectedByUserId" TEXT,
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncRows" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_sheets_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_sheets_oauth_states" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "google_sheets_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "google_sheets_sync_runs" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "GoogleSheetsSyncStatus" NOT NULL DEFAULT 'RUNNING',
  "datasets" TEXT[] NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "rowsExported" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "google_sheets_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "google_sheets_connections_organizationId_key" ON "google_sheets_connections"("organizationId");
CREATE UNIQUE INDEX "google_sheets_connections_organizationId_id_key" ON "google_sheets_connections"("organizationId", "id");
CREATE UNIQUE INDEX "google_sheets_oauth_states_stateHash_key" ON "google_sheets_oauth_states"("stateHash");
CREATE INDEX "google_sheets_oauth_states_organizationId_expiresAt_idx" ON "google_sheets_oauth_states"("organizationId", "expiresAt");
CREATE UNIQUE INDEX "google_sheets_sync_runs_organizationId_idempotencyKey_key" ON "google_sheets_sync_runs"("organizationId", "idempotencyKey");
CREATE INDEX "google_sheets_sync_runs_organizationId_createdAt_idx" ON "google_sheets_sync_runs"("organizationId", "createdAt" DESC);
CREATE INDEX "google_sheets_sync_runs_connectionId_status_idx" ON "google_sheets_sync_runs"("connectionId", "status");

ALTER TABLE "google_sheets_connections" ADD CONSTRAINT "google_sheets_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_sheets_oauth_states" ADD CONSTRAINT "google_sheets_oauth_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_sheets_sync_runs" ADD CONSTRAINT "google_sheets_sync_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "google_sheets_sync_runs" ADD CONSTRAINT "google_sheets_sync_runs_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "google_sheets_connections"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
