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
        description="Conectá y supervisá los servicios externos de tu organización desde un único lugar seguro."
      />
      <IntegrationsCenter
        initialData={integrations}
        canManage={
          can(role, "whatsapp.manage") && can(role, "automation.manage")
        }
      />
    </div>
  );
}
