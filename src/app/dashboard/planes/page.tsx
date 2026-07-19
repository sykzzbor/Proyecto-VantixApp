import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlansPricing } from "@/components/planes/plans-pricing";
import { getPlansExchangeRate } from "@/server/plans/exchange-rate";

export const metadata: Metadata = { title: "Planes" };

export default async function PlansPage() {
  const exchange = await getPlansExchangeRate();
  return (
    <div className="space-y-7">
      <PageHeader
        title="Planes y facturación"
        description="Compará el alcance de cada plan en la moneda que te resulte más clara."
      />
      <PlansPricing exchange={exchange} />
    </div>
  );
}
