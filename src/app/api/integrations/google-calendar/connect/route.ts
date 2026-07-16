import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { isGoogleCalendarConfigured } from "@/server/integrations/google-calendar/config";
import { buildGoogleAuthUrl } from "@/server/integrations/google-calendar/oauth";
import { createGoogleOAuthState } from "@/server/integrations/google-calendar/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Inicia el flujo OAuth: genera un state de un solo uso y devuelve la URL de
 * consentimiento de Google. Solo OWNER/ADMIN; la organización sale SIEMPRE de
 * la sesión.
 */
export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage"
  );
  if (!authorization.ok) return authorization.response;

  if (!isGoogleCalendarConfigured()) {
    return automationJson(
      {
        error: "not_configured",
        message: "Google Calendar todavía no está configurado en el servidor.",
      },
      { status: 503 }
    );
  }

  try {
    const state = await createGoogleOAuthState({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
    });
    return automationJson({ ok: true, url: buildGoogleAuthUrl(state) });
  } catch (error) {
    console.error(
      "[VantixApp] Google Calendar connect:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      { error: "internal_error", message: "No se pudo iniciar la conexión." },
      { status: 500 }
    );
  }
}
