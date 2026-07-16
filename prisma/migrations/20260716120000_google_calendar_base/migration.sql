-- Etapa 6D.1A: base de Google Calendar (conexión OAuth).
-- Migración ADITIVA y no destructiva: crea un enum y dos tablas nuevas.

-- CreateEnum
CREATE TYPE "GoogleCalendarConnectionStatus" AS ENUM ('CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "google_calendar_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "GoogleCalendarConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "googleEmail" TEXT,
    "selectedCalendarId" TEXT,
    "selectedCalendarName" TEXT,
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedByUserId" TEXT,
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_oauth_states" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_connections_organizationId_key" ON "google_calendar_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "google_oauth_states_stateHash_key" ON "google_oauth_states"("stateHash");

-- CreateIndex
CREATE INDEX "google_oauth_states_organizationId_expiresAt_idx" ON "google_oauth_states"("organizationId", "expiresAt");

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "google_oauth_states" ADD CONSTRAINT "google_oauth_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

