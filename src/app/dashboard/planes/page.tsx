import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlansPricing } from "@/components/planes/plans-pricing";

export const metadata: Metadata = { title: "Planes" };

function configuredExchangeRate(): {
  rate: number | null;
  updatedAt: string | null;
} {
  const rate = Number(process.env.PLANS_USD_ARS_RATE);
  const updatedAt = process.env.PLANS_USD_ARS_UPDATED_AT?.trim() ?? null;
  return {
    rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    updatedAt:
      updatedAt && !Number.isNaN(new Date(updatedAt).getTime())
        ? new Date(updatedAt).toISOString()
        : null,
  };
}

export default function PlansPage() {
  const exchange = configuredExchangeRate();
  return (
    <div className="space-y-7">
      <PageHeader
        title="Planes y facturación"
        description="Compará el alcance de cada plan en la moneda que te resulte más clara."
      />
      <PlansPricing exchangeRate={exchange.rate} exchangeUpdatedAt={exchange.updatedAt} />
    </div>
  );
}
