import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GoogleSheetsCard } from "@/components/integraciones/google-sheets-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getGoogleSheetsView } from "@/server/integrations/google-sheets/service";

export const metadata: Metadata = { title: "Google Sheets" };
export const dynamic = "force-dynamic";

export default async function GoogleSheetsIntegrationPage() {
  const { org, role } = await requireOrgContext();
  const data = await getGoogleSheetsView(org.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Google Sheets" description="Elegí una hoja y sincronizá datos operativos de esta organización de forma manual y controlada.">
        <Button asChild variant="outline" size="sm"><Link href="/dashboard/integraciones"><ArrowLeft />Integraciones</Link></Button>
      </PageHeader>
      <GoogleSheetsCard data={data} canManage={can(role, "integrations.manage")} showSettings />
    </div>
  );
}
