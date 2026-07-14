import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { MemberRole } from "@/generated/prisma/enums";

/**
 * Resuelve la organización y el rol para una petición HTTP (route handlers).
 * La organización SIEMPRE proviene de la membresía del usuario autenticado,
 * nunca del cuerpo ni de parámetros del navegador.
 */
export type KnowledgeRequestContext = {
  userId: string;
  organizationId: string;
  role: MemberRole;
};

export type ResolvedRequestContext =
  | { ok: true; ctx: KnowledgeRequestContext }
  | { ok: false; status: number; code: string; message: string };

export async function resolveKnowledgeRequestContext(
  request: Request
): Promise<ResolvedRequestContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Tenés que iniciar sesión.",
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
      message: "Tu usuario no pertenece a ninguna organización.",
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
