import { appointmentIdSchema, cancelAppointmentSchema } from "@/lib/validations/appointments";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import { AppointmentError, cancelAppointment } from "@/server/appointments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAutomationRequest(
    request,
    "appointments.manage",
    "google_calendar"
  );
  if (!authorization.ok) return authorization.response;
  const id = appointmentIdSchema.safeParse((await params).id);
  if (!id.success) {
    return automationJson({ error: "invalid_id", message: "El turno no es válido." }, { status: 400 });
  }
  const body = await readLimitedRawBody(request, 4096);
  if (!body.ok) {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: body.reason === "too_large" ? 413 : 400 }
    );
  }
  let unknownBody: unknown;
  try {
    unknownBody = JSON.parse(body.rawBody);
  } catch {
    return automationJson({ error: "invalid_body", message: "El cuerpo no es válido." }, { status: 400 });
  }
  const parsed = cancelAppointmentSchema.safeParse(unknownBody);
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_appointment", message: parsed.error.issues[0]?.message ?? "La cancelación no es válida." },
      { status: 422 }
    );
  }
  try {
    const appointment = await cancelAppointment({
      ...parsed.data,
      organizationId: authorization.ctx.organizationId,
      appointmentId: id.data,
      userId: authorization.ctx.userId,
    });
    return automationJson({ appointment });
  } catch (error) {
    if (error instanceof AppointmentError) {
      return automationJson(
        { error: error.code, message: error.safeMessage, appointment: error.appointment },
        { status: error.status }
      );
    }
    console.error(
      "[VantixApp] Appointment cancel:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo cancelar el turno." },
      { status: 500 }
    );
  }
}
