-- Etapa 6A: Infraestructura de automatización (VantixApp <-> n8n).
-- Migración ADITIVA y no destructiva: crea enums, tablas, índices y claves foráneas.
-- No modifica ni elimina datos ni estructuras existentes.

-- CreateEnum
CREATE TYPE "AutomationEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'DEAD_LETTER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "automation_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "status" "AutomationEventStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "automationEventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'STARTED',
    "attempt" INTEGER NOT NULL,
    "externalExecutionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "responseMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'n8n',
    "status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "encryptedSecret" TEXT,
    "lastEventAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "automation_events_status_nextAttemptAt_idx" ON "automation_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "automation_events_organizationId_createdAt_idx" ON "automation_events"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "automation_events_organizationId_idempotencyKey_key" ON "automation_events"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "automation_runs_automationEventId_idx" ON "automation_runs"("automationEventId");

-- CreateIndex
CREATE INDEX "automation_runs_organizationId_createdAt_idx" ON "automation_runs"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "integration_connections_organizationId_idx" ON "integration_connections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_organizationId_provider_key" ON "integration_connections"("organizationId", "provider");

-- AddForeignKey
ALTER TABLE "automation_events" ADD CONSTRAINT "automation_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationEventId_fkey" FOREIGN KEY ("automationEventId") REFERENCES "automation_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
