import { z } from "zod";
import { appointmentSettingsSchema } from "@/lib/validations/appointment-settings";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import {
  AppointmentSettingsError,
  getAppointmentSettings,
  updateAppointmentSettings,
} from "@/server/appointments/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;

export async function GET(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "appointments.view");
  if (!authorization.ok) return authorization.response;

  try {
    const view = await getAppointmentSettings(authorization.ctx.organizationId);
    return automationJson({ ok: true, ...view });
  } catch (error) {
    console.error(
      "[VantixApp] Appointment settings read:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo cargar la configuración de turnos." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "appointments.manage");
  if (!authorization.ok) return authorization.response;

  const body = await readLimitedRawBody(request, MAX_BODY_BYTES);
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
  const parsed = appointmentSettingsSchema.safeParse(unknownBody);
  if (!parsed.success) {
    return automationJson(
      {
        error: "invalid_settings",
        message: parsed.error.issues[0]?.message ?? "La configuración no es válida.",
      },
      { status: 422 }
    );
  }

  try {
    const view = await updateAppointmentSettings({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      settings: parsed.data,
    });
    return automationJson({ ok: true, ...view });
  } catch (error) {
    if (error instanceof AppointmentSettingsError) {
      return automationJson(
        { error: error.code, message: error.safeMessage },
        { status: error.code === "configuration_incomplete" ? 422 : 409 }
      );
    }
    if (error instanceof z.ZodError) {
      return automationJson(
        {
          error: "invalid_settings",
          message: error.issues[0]?.message ?? "La configuración no es válida.",
        },
        { status: 422 }
      );
    }
    console.error(
      "[VantixApp] Appointment settings update:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo guardar la configuración." },
      { status: 500 }
    );
  }
}
