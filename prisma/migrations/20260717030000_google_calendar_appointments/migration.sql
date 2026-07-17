-- Etapa 6D.1B-B: turnos sincronizados con Google Calendar.
-- Migración aditiva: crea enums, tabla, índices y relaciones sin alterar datos existentes.

CREATE TYPE "AppointmentStatus" AS ENUM (
    'PENDING',
    'CONFIRMED',
    'RESCHEDULED',
    'CANCELLED',
    'FAILED'
);

CREATE TYPE "AppointmentSource" AS ENUM ('MANUAL', 'AI');

CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "conversationId" TEXT,
    "googleEventId" TEXT,
    "calendarId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "notes" TEXT,
    "cancellationReason" TEXT,
    "createdByUserId" TEXT,
    "source" "AppointmentSource" NOT NULL DEFAULT 'MANUAL',
    "idempotencyKey" TEXT NOT NULL,
    "lastOperationKey" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointments_organizationId_idempotencyKey_key"
    ON "appointments"("organizationId", "idempotencyKey");

CREATE UNIQUE INDEX "appointments_organizationId_googleEventId_key"
    ON "appointments"("organizationId", "googleEventId");

CREATE UNIQUE INDEX "appointments_organizationId_id_key"
    ON "appointments"("organizationId", "id");

CREATE INDEX "appointments_organizationId_status_startAt_idx"
    ON "appointments"("organizationId", "status", "startAt");

CREATE INDEX "appointments_organizationId_startAt_idx"
    ON "appointments"("organizationId", "startAt");

CREATE INDEX "appointments_organizationId_customerId_startAt_idx"
    ON "appointments"("organizationId", "customerId", "startAt");

CREATE INDEX "appointments_organizationId_conversationId_idx"
    ON "appointments"("organizationId", "conversationId");

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customers"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
