import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { can, type Permission } from "@/lib/permissions";
import type { MemberRole } from "@/generated/prisma/enums";
import { ActionError } from "@/server/errors";
import { safeUserImageUrl } from "@/server/profile/avatar";

export type OrgContext = {
  user: { id: string; name: string; email: string; image: string | null };
  org: { id: string; name: string; slug: string };
  role: MemberRole;
};

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

function findMembership(userId: string) {
  return prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { organization: true },
  });
}

/**
 * Para server actions que solo necesitan un usuario autenticado
 * (por ejemplo, crear la primera organización).
 */
export async function getSessionUser() {
  const session = await getSession();
  if (!session) throw new ActionError("Tenés que iniciar sesión para continuar.");
  return session.user;
}

/**
 * Para server actions. La organización se resuelve SIEMPRE desde la sesión
 * autenticada: nunca se acepta un organization_id enviado por el navegador.
 */
export async function getOrgContext(): Promise<OrgContext> {
  const user = await getSessionUser();
  const membership = await findMembership(user.id);
  if (!membership) {
    throw new ActionError("Tu usuario todavía no pertenece a ninguna organización.");
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: safeUserImageUrl(user.image),
    },
    org: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
    role: membership.role,
  };
}

/**
 * Para páginas del dashboard: redirige a /login sin sesión
 * y a /onboarding si el usuario aún no tiene organización.
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  const membership = await findMembership(session.user.id);
  if (!membership) redirect("/onboarding");
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: safeUserImageUrl(session.user.image),
    },
    org: {
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
    },
    role: membership.role,
  };
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.user;
}

export async function hasMembership(userId: string): Promise<boolean> {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    select: { id: true },
  });
  return membership !== null;
}

export function requirePermission(role: MemberRole, permission: Permission) {
  if (!can(role, permission)) {
    throw new ActionError("No tenés permisos para realizar esta acción.");
  }
}
