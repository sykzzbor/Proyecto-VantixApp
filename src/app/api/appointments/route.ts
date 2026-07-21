import { appointmentListQuerySchema, createAppointmentSchema } from "@/lib/validations/appointments";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import {
  AppointmentError,
  createAppointment,
  listAppointments,
} from "@/server/appointments/service";
import { checkRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "appointments.view",
    "google_calendar"
  );
  if (!authorization.ok) return authorization.response;
  const params = new URL(request.url).searchParams;
  const parsed = appointmentListQuerySchema.safeParse({
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    status: params.get("status") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_query", message: "Los filtros no son válidos." },
      { status: 422 }
    );
  }
  try {
    const appointments = await listAppointments(
      authorization.ctx.organizationId,
      parsed.data
    );
    return automationJson({ appointments });
  } catch (error) {
    console.error(
      "[VantixApp] Appointment list:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudieron cargar los turnos." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "appointments.manage",
    "google_calendar"
  );
  if (!authorization.ok) return authorization.response;
  const rate = checkRateLimit(
    `appointments:create:${authorization.ctx.organizationId}:${authorization.ctx.userId}`,
    20,
    60_000
  );
  if (!rate.allowed) {
    return automationJson(
      { error: "rate_limited", message: "Esperá un momento antes de crear otro turno." },
      { status: 429 }
    );
  }
  const body = await readLimitedRawBody(request, 16 * 1024);
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
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: 400 }
    );
  }
  const parsed = createAppointmentSchema.safeParse(unknownBody);
  if (!parsed.success) {
    return automationJson(
      {
        error: "invalid_appointment",
        message: parsed.error.issues[0]?.message ?? "El turno no es válido.",
      },
      { status: 422 }
    );
  }
  try {
    const appointment = await createAppointment({
      ...parsed.data,
      organizationId: authorization.ctx.organizationId,
      createdByUserId: authorization.ctx.userId,
      source: "MANUAL",
    });
    return automationJson(
      { appointment },
      { status: appointment.status === "PENDING" ? 202 : 201 }
    );
  } catch (error) {
    if (error instanceof AppointmentError) {
      return automationJson(
        { error: error.code, message: error.safeMessage, appointment: error.appointment },
        { status: error.status }
      );
    }
    console.error(
      "[VantixApp] Appointment create:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo crear el turno." },
      { status: 500 }
    );
  }
}
