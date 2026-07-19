import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KnowledgeModuleHeader } from "@/components/conocimiento/knowledge-module-header";
import { KnowledgeView } from "@/components/conocimiento/knowledge-view";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import {
  listKnowledgeCategories,
  listKnowledgeDocuments,
} from "@/server/knowledge/queries";

export const metadata: Metadata = {
  title: "Centro de conocimiento",
};

export default async function ConocimientoPage(
  props: PageProps<"/dashboard/conocimiento">
) {
  const { org, role } = await requireOrgContext();
  if (!can(role, "knowledge.read")) redirect("/dashboard");

  const searchParams = await props.searchParams;
  const q = typeof searchParams.q === "string" ? searchParams.q : undefined;
  const status =
    typeof searchParams.estado === "string" ? searchParams.estado : undefined;
  const category =
    typeof searchParams.categoria === "string"
      ? searchParams.categoria
      : undefined;

  const [documents, categories] = await Promise.all([
    listKnowledgeDocuments(org.id, { q, status, category }),
    listKnowledgeCategories(org.id),
  ]);

  return (
    <div className="space-y-6">
      <KnowledgeModuleHeader
        title="Centro de conocimiento"
        description="Subí documentos para que el agente responda con información confirmada de tu negocio. Procesamos PDF con texto, DOCX y TXT."
      />
      <KnowledgeView
        documents={documents}
        categories={categories}
        canManage={can(role, "knowledge.manage")}
        canDelete={can(role, "knowledge.delete")}
        filters={{
          q: q ?? "",
          status: status ?? "",
          category: category ?? "",
        }}
      />
    </div>
  );
}
