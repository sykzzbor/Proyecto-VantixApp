import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TiendanubeCard } from "@/components/integraciones/tiendanube-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getTiendanubeView } from "@/server/integrations/tiendanube/service";

export const metadata: Metadata = { title: "Tiendanube" };
export const dynamic = "force-dynamic";

export default async function TiendanubeIntegrationPage() {
  const { org, role } = await requireOrgContext();
  const data = await getTiendanubeView(org.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Tiendanube" description="Administrá la conexión y la copia de lectura del catálogo, clientes y pedidos de esta organización.">
        <Button asChild variant="outline" size="sm"><Link href="/dashboard/integraciones"><ArrowLeft />Integraciones</Link></Button>
      </PageHeader>
      <TiendanubeCard data={data} canManage={can(role, "integrations.manage")} showSettings />
    </div>
  );
}
