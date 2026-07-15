-- ExtendEnum
ALTER TYPE "WhatsappIntegrationStatus" ADD VALUE IF NOT EXISTS 'CONNECTING';
ALTER TYPE "WhatsappIntegrationStatus" ADD VALUE IF NOT EXISTS 'ACTION_REQUIRED';

-- CreateEnum
CREATE TYPE "WhatsappConnectionMethod" AS ENUM ('MANUAL', 'EMBEDDED_SIGNUP');

-- CreateEnum
CREATE TYPE "WhatsappEmbeddedSignupAttemptStatus" AS ENUM ('AWAITING_CODE', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "whatsapp_integrations"
  ADD COLUMN "connectionMethod" "WhatsappConnectionMethod" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "businessId" TEXT,
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "webhookSubscribedAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorCode" TEXT;

-- CreateTable
CREATE TABLE "whatsapp_embedded_signup_attempts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "integrationId" TEXT,
    "nonceHash" TEXT NOT NULL,
    "codeHash" TEXT,
    "status" "WhatsappEmbeddedSignupAttemptStatus" NOT NULL DEFAULT 'AWAITING_CODE',
    "lastErrorCode" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_embedded_signup_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_integrations_organizationId_status_idx" ON "whatsapp_integrations"("organizationId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_integrations_wabaId_idx" ON "whatsapp_integrations"("wabaId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_embedded_signup_attempts_organizationId_key" ON "whatsapp_embedded_signup_attempts"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_embedded_signup_attempts_nonceHash_key" ON "whatsapp_embedded_signup_attempts"("nonceHash");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_embedded_signup_attempts_codeHash_key" ON "whatsapp_embedded_signup_attempts"("codeHash");

-- CreateIndex
CREATE INDEX "whatsapp_embedded_signup_attempts_status_expiresAt_idx" ON "whatsapp_embedded_signup_attempts"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "whatsapp_embedded_signup_attempts_userId_idx" ON "whatsapp_embedded_signup_attempts"("userId");

-- AddForeignKey
ALTER TABLE "whatsapp_embedded_signup_attempts" ADD CONSTRAINT "whatsapp_embedded_signup_attempts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_embedded_signup_attempts" ADD CONSTRAINT "whatsapp_embedded_signup_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_embedded_signup_attempts" ADD CONSTRAINT "whatsapp_embedded_signup_attempts_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "whatsapp_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
