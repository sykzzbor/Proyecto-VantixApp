import type { MemberRole } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";
import { findActiveMembership } from "@/server/context";
import {
  getOrganizationEntitlement,
  type OrganizationEntitlement,
} from "@/server/billing/entitlement";

export type AutomationRequestContext = {
  userId: string;
  organizationId: string;
  role: MemberRole;
  /** Ya resuelto para que guards de funciones no repitan la consulta. */
  entitlement?: OrganizationEntitlement;
};

export type AutomationContextResult =
  | { ok: true; ctx: AutomationRequestContext }
  | {
      ok: false;
      status: 401 | 402 | 403;
      code: "unauthorized" | "no_organization" | "subscription_required";
      message: string;
    };

/** Resuelve usuario y organización exclusivamente desde la sesión autenticada. */
export async function resolveAutomationRequestContext(
  request: Request
): Promise<AutomationContextResult> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Tenés que iniciar sesión para continuar.",
    };
  }

  const membership = await findActiveMembership(session.user.id);
  if (!membership) {
    return {
      ok: false,
      status: 403,
      code: "no_organization",
      message: "Tu usuario todavía no pertenece a una organización.",
    };
  }

  const entitlement = await getOrganizationEntitlement(
    membership.organizationId
  );
  if (!entitlement.accessAllowed) {
    return {
      ok: false,
      status: 402,
      code: "subscription_required",
      message: "Tu prueba o período contratado terminó. Elegí un plan para continuar.",
    };
  }

  return {
    ok: true,
    ctx: {
      userId: session.user.id,
      organizationId: membership.organizationId,
      role: membership.role,
      entitlement,
    },
  };
}
