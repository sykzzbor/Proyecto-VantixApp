-- El correo de pago queda dentro del dominio de facturación y no modifica
-- la identidad de acceso del usuario. Nullable preserva registros históricos.
ALTER TABLE "organization_subscriptions"
    ADD COLUMN "billingPayerEmail" VARCHAR(254);

ALTER TABLE "plan_price_snapshots"
    ADD COLUMN "payerEmail" VARCHAR(254);
