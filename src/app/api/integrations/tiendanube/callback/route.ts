import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { findActiveMembership } from "@/server/context";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { exchangeTiendanubeCode } from "@/server/integrations/tiendanube/api";
import { connectTiendanube } from "@/server/integrations/tiendanube/service";
import { consumeTiendanubeOAuthState } from "@/server/integrations/tiendanube/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function redirectResult(request: Request, result: string) {
  const url = new URL("/dashboard/integraciones", request.url);
  url.searchParams.set("tiendanube", result);
  return NextResponse.redirect(url, 303);
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return redirectResult(request, "sesion_requerida");
  const membership = await findActiveMembership(session.user.id);
  if (!membership || !can(membership.role, "integrations.manage")) return redirectResult(request, "sin_permisos");
  const entitlement = await getOrganizationEntitlement(membership.organizationId);
  if (!entitlement.accessAllowed || !hasPlanFeature(entitlement, "tiendanube")) return redirectResult(request, "plan_requerido");
  const params = new URL(request.url).searchParams;
  const state = params.get("state")?.trim() ?? "";
  const code = params.get("code")?.trim() ?? "";
  if (!state || state.length > 256) return redirectResult(request, "estado_invalido");
  const consumed = await consumeTiendanubeOAuthState({
    state,
    organizationId: membership.organizationId,
    userId: session.user.id,
  });
  if (!consumed.ok) return redirectResult(request, "estado_invalido");
  if (params.has("error") || !code || code.length > 512) return redirectResult(request, "cancelado");
  try {
    const tokens = await exchangeTiendanubeCode(code);
    await connectTiendanube({ organizationId: consumed.organizationId, userId: session.user.id, tokens });
    return redirectResult(request, "conectado");
  } catch (error) {
    console.error("[VantixApp] Tiendanube callback:", error instanceof Error ? error.name : "unknown_error");
    return redirectResult(request, "error_oauth");
  }
}
