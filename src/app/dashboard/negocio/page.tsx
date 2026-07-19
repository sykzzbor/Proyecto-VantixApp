import type { Metadata } from "next";
import { KnowledgeModuleHeader } from "@/components/conocimiento/knowledge-module-header";
import { BusinessForm } from "@/components/negocio/business-form";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getBusinessProfile } from "@/server/queries";

export const metadata: Metadata = {
  title: "Negocio",
};

export default async function NegocioPage() {
  const { org, role } = await requireOrgContext();
  const profile = await getBusinessProfile(org.id);

  return (
    <div className="space-y-6">
      <KnowledgeModuleHeader
        title="Negocio"
        description="La información pública de tu negocio. El agente la va a usar para responder sobre horarios, ubicación y contacto."
      />
      <BusinessForm
        canEdit={can(role, "business.update")}
        defaults={{
          name: profile?.name ?? org.name,
          description: profile?.description ?? "",
          industry: profile?.industry ?? "",
          phone: profile?.phone ?? "",
          email: profile?.email ?? "",
          website: profile?.website ?? "",
          address: profile?.address ?? "",
          city: profile?.city ?? "",
          country: profile?.country ?? "",
          openingHours: profile?.openingHours ?? "",
          paymentMethods: profile?.paymentMethods ?? "",
          shippingInfo: profile?.shippingInfo ?? "",
        }}
      />
    </div>
  );
}
