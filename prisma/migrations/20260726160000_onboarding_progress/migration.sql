-- Onboarding guiado. Migración ADITIVA: una tabla nueva y una columna opcional.
-- No altera datos existentes; las organizaciones ya creadas quedan sin fila de
-- onboarding y el código las trata como "onboarding heredado" (ver
-- src/server/organizations/onboarding-progress.ts).

CREATE TABLE "organization_onboardings" (
    "organizationId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastStep" TEXT NOT NULL DEFAULT 'negocio',
    "skippedSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agentTestedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "organization_onboardings_pkey" PRIMARY KEY ("organizationId")
);

ALTER TABLE "organization_onboardings"
    ADD CONSTRAINT "organization_onboardings_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Zona horaria del negocio. Opcional: no afecta a AppointmentSettings.timeZone,
-- que sigue siendo la de la agenda de turnos.
ALTER TABLE "business_profiles" ADD COLUMN "timeZone" TEXT;
