import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, CalendarDays } from "lucide-react";
import { GoogleCalendarIntegrationDetail } from "@/components/integraciones/integrations-center";
import { AppointmentsDashboard } from "@/components/turnos/appointments-dashboard";
import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/permissions";
import { appointmentListQuerySchema } from "@/lib/validations/appointments";
import { requireOrgContext } from "@/server/context";
import { getAppointmentReadiness, listAppointments } from "@/server/appointments/service";
import { getIntegrationsCenterView } from "@/server/integrations/diagnostics";

export const metadata: Metadata = { title: "Google Calendar" };
export const dynamic = "force-dynamic";

export default async function GoogleCalendarIntegrationPage() {
  const { org, role } = await requireOrgContext();
  const [integrations, appointments, readiness] = await Promise.all([
    getIntegrationsCenterView(org.id),
    listAppointments(org.id, appointmentListQuerySchema.parse({ limit: 100 })),
    getAppointmentReadiness(org.id),
  ]);

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
      <section id="reservas" className="scroll-mt-24 space-y-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
            <CalendarDays className="size-4.5" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Reservas y próximos turnos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Creá, reprogramá y cancelá reservas sincronizadas con el calendario elegido.
            </p>
          </div>
        </div>
        <AppointmentsDashboard
          initialAppointments={appointments}
          readiness={readiness}
          canManage={can(role, "appointments.manage")}
        />
      </section>
    </div>
  );
}
