-- Etiquetas y notas internas del CRM.
-- Migración ADITIVA: solo crea tablas nuevas, no altera ni borra nada existente.

CREATE TABLE "crm_tags" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "crm_tags_pkey" PRIMARY KEY ("id")
);

-- Dos organizaciones pueden usar el mismo nombre de etiqueta sin chocar.
CREATE UNIQUE INDEX "crm_tags_organizationId_name_key" ON "crm_tags"("organizationId", "name");
CREATE INDEX "crm_tags_organizationId_idx" ON "crm_tags"("organizationId");

CREATE TABLE "conversation_tags" (
    "conversationId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("conversationId", "tagId")
);

CREATE INDEX "conversation_tags_organizationId_tagId_idx" ON "conversation_tags"("organizationId", "tagId");
CREATE INDEX "conversation_tags_tagId_idx" ON "conversation_tags"("tagId");

CREATE TABLE "customer_tags" (
    "customerId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    CONSTRAINT "customer_tags_pkey" PRIMARY KEY ("customerId", "tagId")
);

CREATE INDEX "customer_tags_organizationId_tagId_idx" ON "customer_tags"("organizationId", "tagId");
CREATE INDEX "customer_tags_tagId_idx" ON "customer_tags"("tagId");

CREATE TABLE "conversation_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" VARCHAR(2000) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    CONSTRAINT "conversation_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conversation_notes_organizationId_conversationId_createdAt_idx"
    ON "conversation_notes"("organizationId", "conversationId", "createdAt" DESC);

-- Claves foráneas. Borrar una organización, conversación, cliente o etiqueta
-- se lleva sus asignaciones; borrar a una persona conserva la nota y el
-- etiquetado, solo pierde la autoría.
ALTER TABLE "crm_tags" ADD CONSTRAINT "crm_tags_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "crm_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_tags" ADD CONSTRAINT "customer_tags_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_notes" ADD CONSTRAINT "conversation_notes_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
