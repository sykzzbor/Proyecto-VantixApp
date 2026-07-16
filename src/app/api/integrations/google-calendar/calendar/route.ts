import { z } from "zod";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import { GoogleApiError } from "@/server/integrations/google-calendar/oauth";
import { selectGoogleCalendar } from "@/server/integrations/google-calendar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ calendarId: z.string().trim().min(1).max(512) });
const MAX_BODY_BYTES = 2048;

/** Elige el calendario de trabajo de la organización (solo OWNER/ADMIN). */
export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage"
  );
  if (!authorization.ok) return authorization.response;

  const bodyResult = await readLimitedRawBody(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: bodyResult.reason === "too_large" ? 413 : 400 }
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyResult.rawBody);
  } catch {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: 400 }
    );
  }
  const validated = bodySchema.safeParse(parsed);
  if (!validated.success) {
    return automationJson(
      { error: "invalid_body", message: "Elegí un calendario válido." },
      { status: 400 }
    );
  }

  try {
    const result = await selectGoogleCalendar({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      calendarId: validated.data.calendarId,
    });
    if (!result.ok) {
      return automationJson(
        { error: result.code, message: "Ese calendario no pertenece a la cuenta conectada." },
        { status: 422 }
      );
    }
    return automationJson({ ok: true, name: result.name });
  } catch (error) {
    if (error instanceof GoogleApiError) {
      return automationJson(
        { error: error.code, message: error.safeMessage },
        { status: error.code === "not_configured" ? 409 : 502 }
      );
    }
    console.error(
      "[VantixApp] Google Calendar select:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo elegir el calendario." },
      { status: 500 }
    );
  }
}
