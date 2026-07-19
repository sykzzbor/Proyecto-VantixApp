import type { Metadata } from "next";
import { KnowledgeModuleHeader } from "@/components/conocimiento/knowledge-module-header";
import { ServicesView } from "@/components/servicios/services-view";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getServices } from "@/server/queries";

export const metadata: Metadata = {
  title: "Servicios",
};

export default async function ServiciosPage(
  props: PageProps<"/dashboard/servicios">
) {
  const { org, role } = await requireOrgContext();
  const searchParams = await props.searchParams;

  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const status =
    searchParams.estado === "activos" || searchParams.estado === "inactivos"
      ? searchParams.estado
      : undefined;

  const services = await getServices(org.id, { q, status });

  return (
    <div className="space-y-6">
      <KnowledgeModuleHeader
        title="Servicios"
        description="Los servicios que ofrece tu negocio, con precios y duración."
      />
      <ServicesView
        services={services}
        canWrite={can(role, "catalog.create")}
        canDelete={can(role, "catalog.delete")}
        filters={{ q: q ?? "", status: status ?? "" }}
      />
    </div>
  );
}
