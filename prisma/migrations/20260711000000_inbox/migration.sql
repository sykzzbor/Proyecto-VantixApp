-- CreateEnum
CREATE TYPE "HandlingMode" AS ENUM ('AI', 'HUMAN');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('CUSTOMER', 'AI', 'HUMAN', 'SYSTEM');

-- AlterEnum: ConversationStatus gana el valor PENDING (recreación segura)
CREATE TYPE "ConversationStatus_new" AS ENUM ('OPEN', 'PENDING', 'CLOSED');
ALTER TABLE "conversations" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "conversations" ALTER COLUMN "status" TYPE "ConversationStatus_new" USING ("status"::text::"ConversationStatus_new");
ALTER TYPE "ConversationStatus" RENAME TO "ConversationStatus_old";
ALTER TYPE "ConversationStatus_new" RENAME TO "ConversationStatus";
DROP TYPE "ConversationStatus_old";
ALTER TABLE "conversations" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_organizationId_idx" ON "customers"("organizationId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: conversations — nuevas columnas con preservación de datos
ALTER TABLE "conversations"
  ADD COLUMN "handlingMode" "HandlingMode" NOT NULL DEFAULT 'AI',
  ADD COLUMN "assignedUserId" TEXT,
  ADD COLUMN "humanTakeoverAt" TIMESTAMP(3),
  ADD COLUMN "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN "unreadCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "conversations"
  SET "handlingMode" = 'HUMAN', "humanTakeoverAt" = "updatedAt"
  WHERE "humanTakeover" = true;

UPDATE "conversations" c
  SET "lastMessageAt" = (
    SELECT MAX(m."createdAt") FROM "messages" m WHERE m."conversationId" = c."id"
  );

ALTER TABLE "conversations" DROP COLUMN "humanTakeover";

-- AlterTable: messages — role pasa a senderType con mapeo de datos
ALTER TABLE "messages"
  ADD COLUMN "senderType" "SenderType",
  ADD COLUMN "senderUserId" TEXT,
  ADD COLUMN "readAt" TIMESTAMP(3);

UPDATE "messages"
  SET "senderType" = CASE
    WHEN "role" = 'USER' THEN 'CUSTOMER'::"SenderType"
    ELSE 'AI'::"SenderType"
  END,
  "readAt" = "createdAt";

ALTER TABLE "messages" ALTER COLUMN "senderType" SET NOT NULL;
ALTER TABLE "messages" DROP COLUMN "role";

-- DropEnum
DROP TYPE "MessageRole";

-- CreateIndex
CREATE INDEX "conversations_organizationId_lastMessageAt_idx" ON "conversations"("organizationId", "lastMessageAt" DESC);

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
