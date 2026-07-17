-- Etapa 6D.1B (parte 1): configuración de turnos por organización.
-- Migración aditiva: crea una tabla nueva sin alterar datos existentes.

CREATE TABLE "appointment_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "defaultDurationMinutes" INTEGER NOT NULL DEFAULT 30,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "minimumNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    "weeklySchedule" JSONB NOT NULL,
    "location" TEXT,
    "defaultEventTitle" TEXT NOT NULL DEFAULT 'Turno',
    "allowRescheduling" BOOLEAN NOT NULL DEFAULT false,
    "allowCancellation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "appointment_settings_organizationId_key"
    ON "appointment_settings"("organizationId");

ALTER TABLE "appointment_settings"
    ADD CONSTRAINT "appointment_settings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
