import type { Metadata } from "next";
import { PageHeader } from "@/components/dashboard/page-header";
import { FaqsView } from "@/components/preguntas/faqs-view";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getFaqCategories, getFaqs } from "@/server/queries";

export const metadata: Metadata = {
  title: "Preguntas frecuentes",
};

export default async function PreguntasPage(
  props: PageProps<"/dashboard/preguntas">
) {
  const { org, role } = await requireOrgContext();
  const searchParams = await props.searchParams;

  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const category =
    typeof searchParams.categoria === "string"
      ? searchParams.categoria
      : undefined;
  const status =
    searchParams.estado === "activos" || searchParams.estado === "inactivos"
      ? searchParams.estado
      : undefined;

  const [faqs, categories] = await Promise.all([
    getFaqs(org.id, { q, category, status }),
    getFaqCategories(org.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preguntas frecuentes"
        description="Las respuestas que tu agente va a usar ante las consultas más comunes."
      />
      <FaqsView
        faqs={faqs}
        categories={categories}
        canWrite={can(role, "catalog.create")}
        canDelete={can(role, "catalog.delete")}
        filters={{ q: q ?? "", category: category ?? "", status: status ?? "" }}
      />
    </div>
  );
}
