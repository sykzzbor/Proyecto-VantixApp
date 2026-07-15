-- Ledger idempotente y multi-destinatario para acciones de automatización.
-- Solo persiste el hash del destinatario; nunca el número de teléfono.

-- CreateEnum
CREATE TYPE "AutomationActionDeliveryStatus" AS ENUM ('PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "automation_action_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "status" "AutomationActionDeliveryStatus" NOT NULL DEFAULT 'PROCESSING',
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "processingStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_action_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_action_deliveries_eventId_recipientHash_key"
    ON "automation_action_deliveries"("eventId", "recipientHash");

-- CreateIndex
CREATE INDEX "automation_action_deliveries_organizationId_status_createdAt_idx"
    ON "automation_action_deliveries"("organizationId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "automation_action_deliveries_organizationId_eventId_status_idx"
    ON "automation_action_deliveries"("organizationId", "eventId", "status");

-- AddForeignKey
ALTER TABLE "automation_action_deliveries"
    ADD CONSTRAINT "automation_action_deliveries_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_deliveries"
    ADD CONSTRAINT "automation_action_deliveries_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "automation_events"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
