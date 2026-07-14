-- Etapa 6C: orden interno monotónico para cancelar seguimientos ante carreras.
-- Migración ADITIVA y no destructiva: preserva createdAt como fecha del canal.

ALTER TABLE "messages"
    ADD COLUMN "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "messages_organizationId_conversationId_ingestedAt_idx"
    ON "messages"("organizationId", "conversationId", "ingestedAt");
