import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { findActiveMembership } from "@/server/context";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { exchangeAuthorizationCode, fetchCalendarList } from "@/server/integrations/google-calendar/oauth";
import { saveGoogleConnection } from "@/server/integrations/google-calendar/service";
import { consumeGoogleOAuthState } from "@/server/integrations/google-calendar/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESULT_PATH = "/dashboard/integraciones";

/** Redirige al Centro de Integraciones con un código de resultado seguro. */
function redirectWithResult(request: Request, result: string) {
  const url = new URL(RESULT_PATH, request.url);
  url.searchParams.set("google", result);
  return NextResponse.redirect(url, 303);
}

/**
 * Callback OAuth de Google. Valida sesión, permiso y state de un solo uso
 * antes de intercambiar el código. Nunca expone tokens ni errores internos:
 * solo códigos de resultado en la URL.
 */
export async function GET(request: Request) {
  // 1. Sesión y organización desde la membresía (nunca de la URL).
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirectWithResult(request, "sesion_requerida");
  const membership = await findActiveMembership(session.user.id);
  if (!membership || !can(membership.role, "integrations.manage")) {
    return redirectWithResult(request, "sin_permisos");
  }
  const entitlement = await getOrganizationEntitlement(
    membership.organizationId
  );
  if (!entitlement.accessAllowed) {
    return redirectWithResult(request, "suscripcion_requerida");
  }
  // Defensa en profundidad: el plan (o la prueba) debe incluir Calendar
  // aunque el flujo OAuth se haya iniciado por otra vía.
  if (!hasPlanFeature(entitlement, "google_calendar")) {
    return redirectWithResult(request, "plan_requerido");
  }

  const params = new URL(request.url).searchParams;
  const state = params.get("state")?.trim() ?? "";
  const code = params.get("code")?.trim() ?? "";
  const oauthError = params.get("error")?.trim();

  // 2. State de un solo uso, no vencido y de esta organización (CSRF/replay).
  if (!state || state.length > 256) {
    return redirectWithResult(request, "estado_invalido");
  }
  const consumed = await consumeGoogleOAuthState({
    state,
    sessionOrganizationId: membership.organizationId,
    sessionUserId: session.user.id,
  });
  if (!consumed.ok) return redirectWithResult(request, "estado_invalido");

  // 3. El usuario canceló el consentimiento en Google.
  if (oauthError || !code || code.length > 512) {
    return redirectWithResult(request, "cancelado");
  }

  // 4. Intercambio del código y persistencia cifrada.
  try {
    const tokens = await exchangeAuthorizationCode(code);

    // El calendario "primary" identifica la cuenta (su id es el email).
    let googleEmail: string | null = null;
    try {
      const calendars = await fetchCalendarList(tokens.accessToken);
      googleEmail = calendars.find((calendar) => calendar.primary)?.id ?? null;
    } catch {
      googleEmail = null;
    }

    const saved = await saveGoogleConnection({
      organizationId: consumed.organizationId,
      userId: session.user.id,
      tokens,
      googleEmail,
    });
    if (!saved.ok) return redirectWithResult(request, "sin_refresh_token");
    return redirectWithResult(request, "conectado");
  } catch (error) {
    console.error(
      "[VantixApp] Google Calendar callback:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return redirectWithResult(request, "error_oauth");
  }
}
