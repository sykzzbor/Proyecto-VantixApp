import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { MetricsView } from "@/components/metricas/metrics-view";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import {
  METRIC_DEFINITIONS,
  getMetrics,
  type MetricsChannel,
} from "@/server/metrics/queries";
import { resolveMetricsRange } from "@/server/metrics/range";

export const metadata: Metadata = {
  title: "Centro de rendimiento",
};

const UI_PERIODS = ["hoy", "7d", "30d", "mes", "custom"];

export default async function MetricasPage(
  props: PageProps<"/dashboard/metricas">
) {
  const { org, role } = await requireOrgContext();
  if (!can(role, "metrics.read")) redirect("/dashboard");

  const searchParams = await props.searchParams;
  const periodParam =
    typeof searchParams.periodo === "string" ? searchParams.periodo : undefined;
  const fromParam =
    typeof searchParams.desde === "string" ? searchParams.desde : undefined;
  const toParam =
    typeof searchParams.hasta === "string" ? searchParams.hasta : undefined;
  const channel: MetricsChannel | undefined =
    searchParams.canal === "test" || searchParams.canal === "whatsapp"
      ? searchParams.canal
      : undefined;

  const range = resolveMetricsRange({
    period: periodParam,
    from: fromParam,
    to: toParam,
  });
  const data = await getMetrics(org.id, range, channel);

  const uiPeriod =
    periodParam && UI_PERIODS.includes(periodParam) ? periodParam : "7d";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de rendimiento"
        description={`Métricas reales de conversaciones, mensajes, clientes y uso del agente · ${range.label}.`}
      />
      <MetricsView
        data={data}
        definitions={METRIC_DEFINITIONS}
        canViewAdvanced={can(role, "metrics.advanced")}
        filters={{
          period: uiPeriod,
          channel: channel ?? "",
          from: fromParam ?? "",
          to: toParam ?? "",
        }}
      />
    </div>
  );
}
