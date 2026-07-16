-- CreateEnum
CREATE TYPE "WhatsappChannelProvider" AS ENUM ('META_CLOUD', 'YCLOUD');

-- ExtendEnum
ALTER TYPE "WhatsappConnectionMethod" ADD VALUE IF NOT EXISTS 'COEXISTENCE';

-- AlterTable
ALTER TABLE "whatsapp_integrations"
  ADD COLUMN "provider" "WhatsappChannelProvider" NOT NULL DEFAULT 'META_CLOUD',
  ADD COLUMN "providerPhoneNumber" TEXT;

-- AlterTable
ALTER TABLE "messages"
  ADD COLUMN "whatsappMessageId" TEXT,
  ADD COLUMN "deliveryClaimedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "whatsapp_webhook_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "provider" "WhatsappChannelProvider" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_integrations_providerPhoneNumber_key" ON "whatsapp_integrations"("providerPhoneNumber");

-- CreateIndex
CREATE INDEX "whatsapp_integrations_organizationId_provider_status_idx" ON "whatsapp_integrations"("organizationId", "provider", "status");

-- CreateIndex
CREATE INDEX "whatsapp_integrations_provider_wabaId_idx" ON "whatsapp_integrations"("provider", "wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsappMessageId_key" ON "messages"("whatsappMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_webhook_receipts_provider_externalEventId_key" ON "whatsapp_webhook_receipts"("provider", "externalEventId");

-- CreateIndex
CREATE INDEX "whatsapp_webhook_receipts_organizationId_createdAt_idx" ON "whatsapp_webhook_receipts"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "whatsapp_webhook_receipts_integrationId_createdAt_idx" ON "whatsapp_webhook_receipts"("integrationId", "createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp_webhook_receipts" ADD CONSTRAINT "whatsapp_webhook_receipts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_webhook_receipts" ADD CONSTRAINT "whatsapp_webhook_receipts_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
