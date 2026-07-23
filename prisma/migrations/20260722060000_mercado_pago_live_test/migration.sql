-- Identifica de forma explícita los checkouts reales de validación controlada.
-- El precio comercial y el importe enviado al proveedor ya se almacenan por separado.
ALTER TABLE "plan_price_snapshots"
    ADD COLUMN "isTechnicalTest" BOOLEAN NOT NULL DEFAULT false;
