-- Planes, prueba gratuita y facturación.
-- Migración aditiva: no elimina ni renombra datos existentes.
-- Las organizaciones ya existentes reciben una única prueba de 5 días desde
-- el momento del deploy. El INSERT es parte de la migración y no vuelve a
-- ejecutarse al iniciar sesión, renombrar el negocio o agregar miembros.

CREATE TYPE "BillingPlan" AS ENUM (
    'STANDARD',
    'PROFESSIONAL',
    'ENTERPRISE'
);

CREATE TYPE "SubscriptionStatus" AS ENUM (
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'CANCELED',
    'EXPIRED',
    'INCOMPLETE'
);

CREATE TYPE "PaymentProvider" AS ENUM ('MERCADO_PAGO');

CREATE TYPE "BillingEventStatus" AS ENUM (
    'RECEIVED',
    'PROCESSED',
    'IGNORED',
    'FAILED'
);

CREATE TYPE "BillingCheckoutStatus" AS ENUM (
    'QUOTED',
    'PENDING',
    'CONFIRMED',
    'FAILED',
    'EXPIRED'
);

CREATE TABLE "organization_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "BillingPlan" NOT NULL DEFAULT 'STANDARD',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "subscriptionStartedAt" TIMESTAMP(3),
    "currentPeriodEndsAt" TIMESTAMP(3),
    "nextBillingAt" TIMESTAMP(3),
    "provider" "PaymentProvider",
    "externalSubscriptionId" TEXT,
    "externalCustomerId" TEXT,
    "canceledAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "provider" "PaymentProvider",
    "idempotencyKey" TEXT NOT NULL,
    "externalEventId" TEXT,
    "eventType" TEXT NOT NULL,
    "previousStatus" "SubscriptionStatus",
    "nextStatus" "SubscriptionStatus",
    "payloadHash" TEXT NOT NULL,
    "status" "BillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorCode" TEXT,
    "occurredAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_price_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "plan" "BillingPlan" NOT NULL,
    "usdAmount" DECIMAL(10,2) NOT NULL,
    "arsAmount" DECIMAL(14,2) NOT NULL,
    "exchangeRate" DECIMAL(14,4) NOT NULL,
    "exchangeSource" TEXT NOT NULL,
    "quotedAt" TIMESTAMP(3) NOT NULL,
    "renewalPolicy" TEXT NOT NULL DEFAULT 'FIXED_UNTIL_EXPLICIT_CHANGE',
    "idempotencyKey" TEXT NOT NULL,
    "checkoutStatus" "BillingCheckoutStatus" NOT NULL DEFAULT 'QUOTED',
    "externalSubscriptionId" TEXT,
    "checkoutUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_price_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "active_organization_selections" (
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "active_organization_selections_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "organization_subscriptions_organizationId_key"
    ON "organization_subscriptions"("organizationId");
CREATE UNIQUE INDEX "organization_subscriptions_externalSubscriptionId_key"
    ON "organization_subscriptions"("externalSubscriptionId");
CREATE UNIQUE INDEX "organization_subscriptions_organizationId_id_key"
    ON "organization_subscriptions"("organizationId", "id");
CREATE INDEX "organization_subscriptions_status_trialEndsAt_idx"
    ON "organization_subscriptions"("status", "trialEndsAt");
CREATE INDEX "organization_subscriptions_provider_status_idx"
    ON "organization_subscriptions"("provider", "status");

CREATE UNIQUE INDEX "billing_events_idempotencyKey_key"
    ON "billing_events"("idempotencyKey");
CREATE INDEX "billing_events_organizationId_createdAt_idx"
    ON "billing_events"("organizationId", "createdAt" DESC);
CREATE INDEX "billing_events_subscriptionId_createdAt_idx"
    ON "billing_events"("subscriptionId", "createdAt" DESC);
CREATE INDEX "billing_events_provider_externalEventId_idx"
    ON "billing_events"("provider", "externalEventId");

CREATE UNIQUE INDEX "plan_price_snapshots_idempotencyKey_key"
    ON "plan_price_snapshots"("idempotencyKey");
CREATE UNIQUE INDEX "plan_price_snapshots_externalSubscriptionId_key"
    ON "plan_price_snapshots"("externalSubscriptionId");
CREATE INDEX "plan_price_snapshots_organizationId_createdAt_idx"
    ON "plan_price_snapshots"("organizationId", "createdAt" DESC);
CREATE INDEX "plan_price_snapshots_subscriptionId_checkoutStatus_idx"
    ON "plan_price_snapshots"("subscriptionId", "checkoutStatus");

CREATE INDEX "active_organization_selections_organizationId_idx"
    ON "active_organization_selections"("organizationId");
CREATE UNIQUE INDEX "active_organization_selections_organizationId_userId_key"
    ON "active_organization_selections"("organizationId", "userId");

ALTER TABLE "organization_subscriptions"
    ADD CONSTRAINT "organization_subscriptions_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "billing_events"
    ADD CONSTRAINT "billing_events_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_events"
    ADD CONSTRAINT "billing_events_organizationId_subscriptionId_fkey"
    FOREIGN KEY ("organizationId", "subscriptionId")
    REFERENCES "organization_subscriptions"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "plan_price_snapshots"
    ADD CONSTRAINT "plan_price_snapshots_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_price_snapshots"
    ADD CONSTRAINT "plan_price_snapshots_organizationId_subscriptionId_fkey"
    FOREIGN KEY ("organizationId", "subscriptionId")
    REFERENCES "organization_subscriptions"("organizationId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_price_snapshots"
    ADD CONSTRAINT "plan_price_snapshots_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "active_organization_selections"
    ADD CONSTRAINT "active_organization_selections_organizationId_userId_fkey"
    FOREIGN KEY ("organizationId", "userId")
    REFERENCES "organization_members"("organizationId", "userId")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Una prueba finita por organización existente. El ID es determinista dentro
-- de esta migración y no requiere extensiones de PostgreSQL.
INSERT INTO "organization_subscriptions" (
    "id",
    "organizationId",
    "plan",
    "status",
    "trialStartedAt",
    "trialEndsAt",
    "createdAt",
    "updatedAt"
)
SELECT
    'sub_' || md5("id"),
    "id",
    'STANDARD'::"BillingPlan",
    'TRIALING'::"SubscriptionStatus",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP + INTERVAL '5 days',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "organizations";

-- Historial inicial auditable sin payload ni datos sensibles.
INSERT INTO "billing_events" (
    "id",
    "organizationId",
    "subscriptionId",
    "provider",
    "idempotencyKey",
    "eventType",
    "previousStatus",
    "nextStatus",
    "payloadHash",
    "status",
    "occurredAt",
    "processedAt",
    "createdAt"
)
SELECT
    'bill_' || md5('trial:' || s."organizationId"),
    s."organizationId",
    s."id",
    NULL,
    'trial:' || s."organizationId",
    'trial.started',
    NULL,
    'TRIALING'::"SubscriptionStatus",
    'ae759b88398a9d286ca0f2383ff2f1de92f80b4e576d57526ed4034643a22b50',
    'PROCESSED'::"BillingEventStatus",
    s."trialStartedAt",
    s."trialStartedAt",
    s."trialStartedAt"
FROM "organization_subscriptions" s;

-- Conserva el comportamiento histórico (primera membresía creada) como
-- selección inicial, pero deja persistido el tenant activo para cada usuario.
INSERT INTO "active_organization_selections" (
    "userId",
    "organizationId",
    "updatedAt"
)
SELECT DISTINCT ON ("userId")
    "userId",
    "organizationId",
    CURRENT_TIMESTAMP
FROM "organization_members"
ORDER BY "userId", "createdAt" ASC, "id" ASC;
