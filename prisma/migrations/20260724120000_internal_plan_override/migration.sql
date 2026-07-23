-- Modo interno temporal de plan. No altera el plan ni el estado real de pago.
ALTER TABLE "organization_subscriptions"
ADD COLUMN "internalPlanOverride" "BillingPlan",
ADD COLUMN "internalPlanOverrideStartedAt" TIMESTAMP(3),
ADD COLUMN "internalPlanOverrideEndsAt" TIMESTAMP(3),
ADD COLUMN "internalPlanOverrideByUserId" TEXT;

CREATE INDEX "organization_subscriptions_internalPlanOverrideEndsAt_idx"
ON "organization_subscriptions"("internalPlanOverrideEndsAt");
