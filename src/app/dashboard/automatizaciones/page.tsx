import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AutomationDashboard } from "@/components/automatizaciones/automation-dashboard";
import { PageHeader } from "@/components/dashboard/page-header";
import { can } from "@/lib/permissions";
import {
  automationEventQuerySchema,
  automationPeriodSchema,
  automationRunQuerySchema,
} from "@/lib/validations/automation";
import {
  getAutomationInfrastructureStatus,
  getAutomationOverview,
  listAutomationEventTypes,
  listAutomationEvents,
  listAutomationProviders,
  listAutomationRuns,
} from "@/server/automation/dashboard";
import { requireOrgContext } from "@/server/context";
import { getAutomationRules } from "@/server/automation/rules";

export const metadata: Metadata = {
  title: "Automatizaciones",
};

export const dynamic = "force-dynamic";

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export default async function AutomatizacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org, role } = await requireOrgContext();
  if (!can(role, "automation.view")) redirect("/dashboard");
  const canManageAutomation = can(role, "automation.manage");

  const params = await searchParams;
  const periodResult = automationPeriodSchema.safeParse(scalar(params.periodo));
  const period = periodResult.success ? periodResult.data : "7d";
  const eventQueryResult = automationEventQuerySchema.safeParse({
    period,
    page: scalar(params.pagina),
    pageSize: "20",
    status: scalar(params.estado),
    type: scalar(params.tipo),
    q: scalar(params.q),
    order: scalar(params.orden),
  });
  const runQueryResult = automationRunQuerySchema.safeParse({
    period,
    page: scalar(params.run_pagina),
    pageSize: "20",
    status: scalar(params.run_estado),
    provider: scalar(params.proveedor),
    type: scalar(params.run_tipo),
    order: scalar(params.run_orden),
  });
  const eventQuery = eventQueryResult.success
    ? eventQueryResult.data
    : automationEventQuerySchema.parse({ period });
  const runQuery = runQueryResult.success
    ? runQueryResult.data
    : automationRunQuerySchema.parse({ period });
  const requestedTab = scalar(params.tab);
  const tab =
    requestedTab === "runs" || requestedTab === "rules"
      ? requestedTab
      : "events";

  const [overview, infrastructure, events, runs, eventTypes, providers, rules] =
    await Promise.all([
      getAutomationOverview(org.id, period),
      getAutomationInfrastructureStatus(org.id),
      listAutomationEvents(org.id, eventQuery),
      listAutomationRuns(org.id, runQuery),
      listAutomationEventTypes(org.id),
      listAutomationProviders(org.id),
      getAutomationRules(org.id, {
        redactSensitiveConfig: !canManageAutomation,
      }),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Automatizaciones"
        description="Supervisá eventos, ejecuciones y el estado operativo de la infraestructura de tu organización."
      />
      <AutomationDashboard
        overview={overview}
        infrastructure={infrastructure}
        events={events}
        runs={runs}
        eventTypes={eventTypes}
        providers={providers}
        rules={rules}
        organizationName={org.name}
        canManage={canManageAutomation}
        filters={{
          period,
          tab,
          eventStatus: eventQuery.status ?? "",
          eventType: eventQuery.type ?? "",
          eventSearch: eventQuery.q ?? "",
          eventOrder: eventQuery.order,
          runStatus: runQuery.status ?? "",
          runProvider: runQuery.provider ?? "",
          runType: runQuery.type ?? "",
          runOrder: runQuery.order,
        }}
      />
    </div>
  );
}
