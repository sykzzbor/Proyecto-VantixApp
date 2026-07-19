import type { Metadata } from "next";
import { KnowledgeModuleHeader } from "@/components/conocimiento/knowledge-module-header";
import { ProductsView } from "@/components/productos/products-view";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getProductCategories, getProducts } from "@/server/queries";

export const metadata: Metadata = {
  title: "Productos",
};

export default async function ProductosPage(
  props: PageProps<"/dashboard/productos">
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

  const [products, categories] = await Promise.all([
    getProducts(org.id, { q, category, status }),
    getProductCategories(org.id),
  ]);

  return (
    <div className="space-y-6">
      <KnowledgeModuleHeader
        title="Productos"
        description="El catálogo de productos que tu agente va a usar para responder consultas."
      />
      <ProductsView
        products={products}
        categories={categories}
        canWrite={can(role, "catalog.create")}
        canDelete={can(role, "catalog.delete")}
        filters={{ q: q ?? "", category: category ?? "", status: status ?? "" }}
      />
    </div>
  );
}
