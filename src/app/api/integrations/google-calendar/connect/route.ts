import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { hasPlanFeature, requireActiveEntitlement } from "@/server/billing/rules";
import { getGoogleCalendarConfigurationStatus } from "@/server/integrations/google-calendar/config";
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

  // Google Calendar no está incluido en la prueba: se valida en servidor,
  // aunque el botón esté visible.
  const entitlement = await requireActiveEntitlement(
    authorization.ctx.organizationId
  ).catch(() => null);
  if (!entitlement || !hasPlanFeature(entitlement, "google_calendar")) {
    return automationJson(
      {
        error: "plan_feature_required",
        message:
          "Google Calendar no está disponible durante la prueba. Elegí un plan para conectar tu agenda.",
      },
      { status: 402 }
    );
  }

  const configuration = getGoogleCalendarConfigurationStatus();
  if (!configuration.configured) {
    return automationJson(
      {
        error: "not_configured",
        reason: configuration.issue,
        message: configuration.message,
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
