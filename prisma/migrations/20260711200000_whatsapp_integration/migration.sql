-- CreateEnum
CREATE TYPE "WhatsappIntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateTable
CREATE TABLE "whatsapp_integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wabaId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "displayPhoneNumber" TEXT NOT NULL,
    "verifiedName" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "status" "WhatsappIntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastError" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_integrations_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "conversations"
  ADD COLUMN "whatsappIntegrationId" TEXT;

-- AlterTable
ALTER TABLE "messages"
  ADD COLUMN "externalMessageId" TEXT,
  ADD COLUMN "deliveryStatus" "MessageDeliveryStatus",
  ADD COLUMN "errorCode" TEXT,
  ADD COLUMN "errorMessage" TEXT,
  ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_integrations_phoneNumberId_key" ON "whatsapp_integrations"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_integrations_organizationId_idx" ON "whatsapp_integrations"("organizationId");

-- CreateIndex
CREATE INDEX "conversations_whatsappIntegrationId_idx" ON "conversations"("whatsappIntegrationId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_customerId_channel_status_idx" ON "conversations"("organizationId", "customerId", "channel", "status");

-- CreateIndex
CREATE INDEX "customers_organizationId_phone_idx" ON "customers"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "messages_externalMessageId_key" ON "messages"("externalMessageId");

-- AddForeignKey
ALTER TABLE "whatsapp_integrations" ADD CONSTRAINT "whatsapp_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_whatsappIntegrationId_fkey" FOREIGN KEY ("whatsappIntegrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
