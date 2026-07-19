import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Briefcase, MessageCircleQuestion, Package, Store } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader
        title="Centro de conocimiento"
        description="Subí documentos para que el agente responda con información confirmada de tu negocio. Procesamos PDF con texto, DOCX y TXT."
      />
      <nav
        aria-label="Información que utiliza el agente"
        className="flex gap-2 overflow-x-auto rounded-xl border border-border bg-card p-2"
      >
        {[
          { href: "/dashboard/negocio", label: "Negocio", icon: Store },
          { href: "/dashboard/productos", label: "Productos", icon: Package },
          { href: "/dashboard/servicios", label: "Servicios", icon: Briefcase },
          {
            href: "/dashboard/preguntas",
            label: "Preguntas frecuentes",
            icon: MessageCircleQuestion,
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
            >
              <Icon className="size-3.5" aria-hidden />
              {item.label}
            </Link>
          );
        })}
      </nav>
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
