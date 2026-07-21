import { appointmentIdSchema, rescheduleAppointmentSchema } from "@/lib/validations/appointments";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import {
  AppointmentError,
  getAppointment,
  rescheduleAppointment,
} from "@/server/appointments/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAutomationRequest(
    request,
    "appointments.view",
    "google_calendar"
  );
  if (!authorization.ok) return authorization.response;
  const id = appointmentIdSchema.safeParse((await params).id);
  if (!id.success) {
    return automationJson({ error: "invalid_id", message: "El turno no es válido." }, { status: 400 });
  }
  try {
    const appointment = await getAppointment(authorization.ctx.organizationId, id.data);
    if (!appointment) {
      return automationJson({ error: "not_found", message: "El turno no existe." }, { status: 404 });
    }
    return automationJson({ appointment });
  } catch (error) {
    console.error(
      "[VantixApp] Appointment detail:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo cargar el turno." },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
  const parsed = rescheduleAppointmentSchema.safeParse(unknownBody);
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_appointment", message: parsed.error.issues[0]?.message ?? "El horario no es válido." },
      { status: 422 }
    );
  }
  try {
    const appointment = await rescheduleAppointment({
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
      "[VantixApp] Appointment reschedule:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo reprogramar el turno." },
      { status: 500 }
    );
  }
}
