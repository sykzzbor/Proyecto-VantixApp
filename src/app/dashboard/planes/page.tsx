import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { PlansPricing } from "@/components/planes/plans-pricing";
import { SubscriptionPanel } from "@/components/billing/subscription-panel";
import { getPlansExchangeRate } from "@/server/plans/exchange-rate";
import { requireOrgContext } from "@/server/context";
import { getBillingHistory, getBillingOverview } from "@/server/billing/service";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { convertUsdToArs } from "@/lib/plans-pricing";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Planes y facturación" };

export default async function PlansPage() {
  // La organización sale de la sesión; el historial se consulta con ese id y
  // nunca con uno recibido del navegador.
  const { user, org, role } = await requireOrgContext();
  const [exchange, billing, history] = await Promise.all([
    getPlansExchangeRate(),
    getBillingOverview(org.id, user.email),
    getBillingHistory(org.id),
  ]);

  const usdMonthly = BILLING_PLANS[billing.entitlement.plan].usdMonthly;
  const priceArs = exchange.rate
    ? convertUsdToArs(usdMonthly, exchange.rate)
    : null;

  return (
    <div className="space-y-7">
      <PageHeader
        title="Planes y facturación"
        description="El estado de tu suscripción, tus pagos y el alcance de cada plan."
      />
      <SubscriptionPanel
        billing={billing}
        history={history}
        priceArs={priceArs}
        canManage={can(role, "billing.manage")}
      />
      <div id="planes" className="scroll-mt-20">
        <PlansPricing
          exchange={exchange}
          billing={billing}
          canManage={can(role, "billing.manage")}
        />
      </div>
    </div>
  );
}
