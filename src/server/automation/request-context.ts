import type { MemberRole } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export type AutomationRequestContext = {
  userId: string;
  organizationId: string;
  role: MemberRole;
};

export type AutomationContextResult =
  | { ok: true; ctx: AutomationRequestContext }
  | {
      ok: false;
      status: 401 | 403;
      code: "unauthorized" | "no_organization";
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

  const membership = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { organizationId: true, role: true },
  });
  if (!membership) {
    return {
      ok: false,
      status: 403,
      code: "no_organization",
      message: "Tu usuario todavía no pertenece a una organización.",
    };
  }

  return {
    ok: true,
    ctx: {
      userId: session.user.id,
      organizationId: membership.organizationId,
      role: membership.role,
    },
  };
}
