import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlansPricing } from "@/components/planes/plans-pricing";
import { getPlansExchangeRate } from "@/server/plans/exchange-rate";
import { requireOrgContext } from "@/server/context";
import { getBillingOverview } from "@/server/billing/service";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Planes" };

export default async function PlansPage() {
  const { user, org, role } = await requireOrgContext();
  const [exchange, billing] = await Promise.all([
    getPlansExchangeRate(),
    getBillingOverview(org.id, user.email),
  ]);
  return (
    <div className="space-y-7">
      <PageHeader
        title="Planes y facturación"
        description="Compará el alcance de cada plan en la moneda que te resulte más clara."
      />
      <PlansPricing
        exchange={exchange}
        billing={billing}
        canManage={can(role, "billing.manage")}
      />
    </div>
  );
}
