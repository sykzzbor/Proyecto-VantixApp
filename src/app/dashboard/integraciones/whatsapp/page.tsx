import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { WhatsappIntegrationPanel } from "@/components/whatsapp/whatsapp-integration-panel";
import { WhatsappSimulator } from "@/components/whatsapp/whatsapp-simulator";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import {
  getWhatsappWebhookUrl,
  isWhatsappDevMode,
} from "@/server/whatsapp/config";
import { getWhatsappIntegrationView } from "@/server/whatsapp/integration";

export const metadata: Metadata = {
  title: "WhatsApp",
};

export default async function WhatsappIntegrationPage() {
  const { org, role } = await requireOrgContext();
  const integration = await getWhatsappIntegrationView(org.id);
  const canManage = can(role, "whatsapp.manage");
  const devMode = isWhatsappDevMode();

  let webhookUrl: string | null = null;
  try {
    webhookUrl = getWhatsappWebhookUrl();
  } catch {
    // La pantalla sigue disponible para mostrar el estado y orientar al usuario.
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Conectá WhatsApp Cloud API para recibir y responder conversaciones desde la bandeja de Vantix."
      />

      <WhatsappIntegrationPanel
        integration={integration}
        webhookUrl={webhookUrl}
        canManage={canManage}
      />

      {devMode && canManage && (
        <WhatsappSimulator organizationName={org.name} />
      )}
    </div>
  );
}
