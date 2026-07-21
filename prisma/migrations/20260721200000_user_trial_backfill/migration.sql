-- Completa el registro de prueba por cuenta para propietarios existentes.
-- La tabla user_trials se agregó después de que las organizaciones existentes
-- ya habían recibido su prueba, por lo que esas cuentas todavía no tenían el
-- marcador que impide reiniciarla al borrar y recrear una organización.
--
-- Migración aditiva e idempotente: no cambia suscripciones, membresías ni
-- datos operativos. Si una cuenta ya tiene registro, conserva el original.
INSERT INTO "user_trials" (
    "userId",
    "startedAt",
    "endsAt",
    "createdAt"
)
SELECT
    existing_trial."userId",
    existing_trial."trialStartedAt",
    existing_trial."trialEndsAt",
    CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT ON (om."userId")
        om."userId",
        s."trialStartedAt",
        s."trialEndsAt"
    FROM "organization_members" om
    INNER JOIN "organization_subscriptions" s
        ON s."organizationId" = om."organizationId"
    WHERE om."role" = 'OWNER'
    ORDER BY om."userId", s."trialStartedAt" ASC, s."trialEndsAt" ASC
) existing_trial
ON CONFLICT ("userId") DO NOTHING;
