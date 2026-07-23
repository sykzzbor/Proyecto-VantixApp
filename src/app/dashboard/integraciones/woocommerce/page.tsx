import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { WooCommerceCard } from "@/components/integraciones/woocommerce-card";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getWooCommerceView } from "@/server/integrations/woocommerce/service";

export const metadata: Metadata = { title: "WooCommerce" };
export const dynamic = "force-dynamic";

export default async function WooCommerceIntegrationPage() {
  const { org, role } = await requireOrgContext();
  const data = await getWooCommerceView(org.id);
  return (
    <div className="space-y-6">
      <PageHeader
        title="WooCommerce"
        description="Administrá la conexión y la copia de lectura del catálogo, clientes y pedidos de esta organización."
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/integraciones">
            <ArrowLeft />
            Integraciones
          </Link>
        </Button>
      </PageHeader>
      <WooCommerceCard
        data={data}
        canManage={can(role, "integrations.manage")}
        showSettings
      />
    </div>
  );
}
