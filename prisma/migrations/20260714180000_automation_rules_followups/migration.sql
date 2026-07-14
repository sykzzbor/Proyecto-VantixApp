-- Etapa 6C: reglas por organización, vínculos seguros y envío idempotente.
-- Migración ADITIVA y no destructiva: no elimina ni renombra datos existentes.

-- CreateEnum
CREATE TYPE "AutomationRuleType" AS ENUM ('HANDOFF_ALERT', 'FOLLOW_UP');

-- CreateTable
CREATE TABLE "organization_automation_rules" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "AutomationRuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_automation_rules_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "automation_events"
    ADD COLUMN "automationRuleId" TEXT,
    ADD COLUMN "conversationId" TEXT,
    ADD COLUMN "sourceMessageId" TEXT,
    ADD COLUMN "actionMessageId" TEXT,
    ADD COLUMN "followUpNumber" INTEGER,
    ADD COLUMN "cancellationReason" TEXT,
    ADD COLUMN "actionClaimedAt" TIMESTAMP(3),
    ADD COLUMN "actionCompletedAt" TIMESTAMP(3),
    ADD CONSTRAINT "automation_events_followUpNumber_check"
        CHECK ("followUpNumber" IS NULL OR ("followUpNumber" >= 1 AND "followUpNumber" <= 3));

-- AlterTable
ALTER TABLE "integration_connections"
    ADD COLUMN "lastCallbackAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "organization_automation_rules_organizationId_type_key"
    ON "organization_automation_rules"("organizationId", "type");

-- CreateIndex
CREATE INDEX "organization_automation_rules_organizationId_enabled_idx"
    ON "organization_automation_rules"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "automation_events_actionMessageId_key"
    ON "automation_events"("actionMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "automation_events_organizationId_type_sourceMessageId_key"
    ON "automation_events"("organizationId", "type", "sourceMessageId");

-- CreateIndex
CREATE INDEX "automation_events_organizationId_type_status_nextAttemptAt_idx"
    ON "automation_events"("organizationId", "type", "status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "automation_events_organizationId_conversationId_type_status_idx"
    ON "automation_events"("organizationId", "conversationId", "type", "status");

-- CreateIndex
CREATE INDEX "automation_events_conversationId_idx"
    ON "automation_events"("conversationId");

-- CreateIndex
CREATE INDEX "automation_events_automationRuleId_createdAt_idx"
    ON "automation_events"("automationRuleId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "automation_events_sourceMessageId_idx"
    ON "automation_events"("sourceMessageId");

-- AddForeignKey
ALTER TABLE "organization_automation_rules"
    ADD CONSTRAINT "organization_automation_rules_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_automation_rules"
    ADD CONSTRAINT "organization_automation_rules_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_automation_rules"
    ADD CONSTRAINT "organization_automation_rules_updatedById_fkey"
    FOREIGN KEY ("updatedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_events"
    ADD CONSTRAINT "automation_events_automationRuleId_fkey"
    FOREIGN KEY ("automationRuleId") REFERENCES "organization_automation_rules"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_events"
    ADD CONSTRAINT "automation_events_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_events"
    ADD CONSTRAINT "automation_events_sourceMessageId_fkey"
    FOREIGN KEY ("sourceMessageId") REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_events"
    ADD CONSTRAINT "automation_events_actionMessageId_fkey"
    FOREIGN KEY ("actionMessageId") REFERENCES "messages"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
