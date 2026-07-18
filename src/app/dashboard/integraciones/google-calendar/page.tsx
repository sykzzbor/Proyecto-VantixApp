import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { GoogleCalendarIntegrationDetail } from "@/components/integraciones/integrations-center";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getIntegrationsCenterView } from "@/server/integrations/diagnostics";

export const metadata: Metadata = { title: "Google Calendar" };
export const dynamic = "force-dynamic";

export default async function GoogleCalendarIntegrationPage() {
  const { org, role } = await requireOrgContext();
  const integrations = await getIntegrationsCenterView(org.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Google Calendar"
        description="Administrá la conexión, el calendario elegido y las reglas de disponibilidad desde una vista dedicada."
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/integraciones">
            <ArrowLeft className="size-4" aria-hidden />
            Integraciones
          </Link>
        </Button>
      </PageHeader>
      <GoogleCalendarIntegrationDetail
        data={integrations.googleCalendar}
        canManage={can(role, "integrations.manage")}
      />
    </div>
  );
}
