-- Importe realmente enviado al proveedor para conservar separado el precio
-- comercial del snapshot cuando se usa el sandbox de Mercado Pago.
-- Nullable mantiene compatibilidad con checkouts históricos, que usan arsAmount.
ALTER TABLE "plan_price_snapshots"
    ADD COLUMN "providerAmountArs" DECIMAL(14,2);
