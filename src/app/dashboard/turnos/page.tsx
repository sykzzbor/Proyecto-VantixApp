import type { Metadata } from "next";
import { AppointmentsDashboard } from "@/components/turnos/appointments-dashboard";
import { PageHeader } from "@/components/dashboard/page-header";
import { can } from "@/lib/permissions";
import { appointmentListQuerySchema } from "@/lib/validations/appointments";
import { requireOrgContext } from "@/server/context";
import { getAppointmentReadiness, listAppointments } from "@/server/appointments/service";

export const metadata: Metadata = { title: "Turnos" };
export const dynamic = "force-dynamic";

export default async function AppointmentsPage() {
  const { org, role } = await requireOrgContext();
  const [appointments, readiness] = await Promise.all([
    listAppointments(org.id, appointmentListQuerySchema.parse({ limit: 100 })),
    getAppointmentReadiness(org.id),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Turnos"
        description="Creá y administrá turnos sincronizados con el calendario elegido por tu organización."
      />
      <AppointmentsDashboard
        initialAppointments={appointments}
        readiness={readiness}
        canManage={can(role, "appointments.manage")}
      />
    </div>
  );
}
