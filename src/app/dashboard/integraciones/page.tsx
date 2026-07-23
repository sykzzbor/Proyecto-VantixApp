import type { Metadata } from "next";
import { IntegrationsCenter } from "@/components/integraciones/integrations-center";
import { PageHeader } from "@/components/dashboard/page-header";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getIntegrationsCenterView } from "@/server/integrations/diagnostics";

export const metadata: Metadata = {
  title: "Integraciones",
};

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const { org, role } = await requireOrgContext();
  const integrations = await getIntegrationsCenterView(org.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Centro de Integraciones"
        description="Revisá qué servicios están operativos, cuáles necesitan atención y dónde continuar cada configuración."
      />
      <IntegrationsCenter
        initialData={{
          whatsapp: integrations.whatsapp,
          googleCalendar: integrations.googleCalendar,
          googleSheets: integrations.googleSheets,
          tiendanube: integrations.tiendanube,
        }}
        canManage={can(role, "integrations.manage")}
      />
    </div>
  );
}
