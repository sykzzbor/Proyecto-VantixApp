import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { testGoogleCalendarConnection } from "@/server/integrations/google-calendar/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prueba la conexión con Google Calendar (solo OWNER/ADMIN). */
export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage",
    "google_calendar"
  );
  if (!authorization.ok) return authorization.response;

  try {
    const result = await testGoogleCalendarConnection(
      authorization.ctx.organizationId
    );
    if (!result.ok) {
      return automationJson(
        { error: "test_failed", message: result.message },
        { status: 502 }
      );
    }
    return automationJson({ ok: true, calendars: result.calendars });
  } catch (error) {
    console.error(
      "[VantixApp] Google Calendar test:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo probar la conexión." },
      { status: 500 }
    );
  }
}
