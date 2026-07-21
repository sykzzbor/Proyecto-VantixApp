import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { findActiveMembership } from "@/server/context";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { exchangeGoogleSheetsCode } from "@/server/integrations/google-sheets/oauth";
import { saveGoogleSheetsConnection } from "@/server/integrations/google-sheets/service";
import { consumeGoogleSheetsOAuthState } from "@/server/integrations/google-sheets/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectWithResult(request: Request, result: string) {
  const url = new URL("/dashboard/integraciones", request.url);
  url.searchParams.set("sheets", result);
  return NextResponse.redirect(url, 303);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirectWithResult(request, "sesion_requerida");
  const membership = await findActiveMembership(session.user.id);
  if (!membership || !can(membership.role, "integrations.manage")) {
    return redirectWithResult(request, "sin_permisos");
  }
  const entitlement = await getOrganizationEntitlement(membership.organizationId);
  if (!entitlement.accessAllowed || !hasPlanFeature(entitlement, "google_sheets")) {
    return redirectWithResult(request, "plan_requerido");
  }
  const params = new URL(request.url).searchParams;
  const state = params.get("state")?.trim() ?? "";
  const code = params.get("code")?.trim() ?? "";
  if (!state || state.length > 256) return redirectWithResult(request, "estado_invalido");
  const consumed = await consumeGoogleSheetsOAuthState({
    state,
    organizationId: membership.organizationId,
    userId: session.user.id,
  });
  if (!consumed.ok) return redirectWithResult(request, "estado_invalido");
  if (params.has("error") || !code || code.length > 512) {
    return redirectWithResult(request, "cancelado");
  }
  try {
    const tokens = await exchangeGoogleSheetsCode(code);
    const saved = await saveGoogleSheetsConnection({
      organizationId: consumed.organizationId,
      userId: session.user.id,
      tokens,
    });
    return redirectWithResult(request, saved.ok ? "conectado" : "sin_refresh_token");
  } catch (error) {
    console.error("[VantixApp] Google Sheets callback:", error instanceof Error ? error.name : "unknown_error");
    return redirectWithResult(request, "error_oauth");
  }
}
