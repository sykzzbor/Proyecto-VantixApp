"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assignableRoles } from "@/lib/permissions";
import {
  inviteMemberSchema,
  updateMemberRoleSchema,
  type InviteMemberInput,
  type UpdateMemberRoleInput,
} from "@/lib/validations/team";
import { recordAudit } from "@/server/audit";
import {
  getOrgContext,
  getSessionUser,
  requirePermission,
} from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import { assertCanAddMember } from "@/server/billing/rules";

const idSchema = z.string().min(1);

const INVITATION_DAYS = 7;

function revalidate() {
  revalidatePath("/dashboard/equipo");
  revalidatePath("/dashboard");
}

export async function inviteMember(input: InviteMemberInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "team.manage");
    const data = inviteMemberSchema.parse(input);
    const email = data.email.toLowerCase();

    if (!assignableRoles(role).includes(data.role)) {
      throw new ActionError("No podés asignar ese rol.");
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const existingMembership = await prisma.organizationMember.findFirst({
        where: { organizationId: org.id, userId: existingUser.id },
        select: { id: true },
      });
      if (existingMembership) {
        throw new ActionError("Esa persona ya forma parte del equipo.");
      }
    }

    const pending = await prisma.invitation.findFirst({
      where: {
        organizationId: org.id,
        email,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pending) {
      throw new ActionError("Ya hay una invitación pendiente para ese email.");
    }

    // Límite de usuarios del plan (o de la prueba), validado en servidor.
    // Las invitaciones pendientes reservan cupo.
    await assertCanAddMember(org.id);

    const invitation = await prisma.invitation.create({
      data: {
        organizationId: org.id,
        email,
        role: data.role,
        invitedById: user.id,
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "equipo.invitacion_enviada",
      entityType: "invitation",
      entityId: invitation.id,
      details: { email, rol: data.role },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "team.manage");
    const invitationId = idSchema.parse(id);

    const invitation = await prisma.invitation.findFirst({
      where: { id: invitationId, organizationId: org.id, status: "PENDING" },
    });
    if (!invitation) {
      throw new ActionError("La invitación no existe o ya fue utilizada.");
    }

    await prisma.invitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED" },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "equipo.invitacion_revocada",
      entityType: "invitation",
      entityId: invitationId,
      details: { email: invitation.email },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateMemberRole(
  input: UpdateMemberRoleInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "team.manage");
    const data = updateMemberRoleSchema.parse(input);

    const target = await prisma.organizationMember.findFirst({
      where: { id: data.memberId, organizationId: org.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!target) throw new ActionError("El miembro no existe en tu equipo.");
    if (target.userId === user.id) {
      throw new ActionError("No podés cambiar tu propio rol.");
    }
    if (target.role === "OWNER") {
      throw new ActionError("No se puede cambiar el rol del propietario.");
    }
    const allowed = assignableRoles(role);
    if (!allowed.includes(target.role) || !allowed.includes(data.role)) {
      throw new ActionError("No tenés permisos para asignar ese rol.");
    }

    await prisma.organizationMember.update({
      where: { id: target.id },
      data: { role: data.role },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "equipo.rol_actualizado",
      entityType: "organization_member",
      entityId: target.id,
      details: { email: target.user.email, rol: data.role },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function removeMember(memberId: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "team.manage");
    const id = idSchema.parse(memberId);

    const target = await prisma.organizationMember.findFirst({
      where: { id, organizationId: org.id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!target) throw new ActionError("El miembro no existe en tu equipo.");
    if (target.userId === user.id) {
      throw new ActionError("No podés eliminarte a vos mismo del equipo.");
    }
    if (target.role === "OWNER") {
      throw new ActionError("No se puede eliminar al propietario.");
    }
    if (!assignableRoles(role).includes(target.role)) {
      throw new ActionError("No tenés permisos para eliminar a ese miembro.");
    }

    await prisma.organizationMember.delete({ where: { id: target.id } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "equipo.miembro_eliminado",
      entityType: "organization_member",
      entityId: target.id,
      details: { email: target.user.email },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Acepta una invitación por token. El email de la invitación debe coincidir
 * con el email del usuario autenticado.
 */
export async function acceptInvitation(token: string): Promise<ActionResult> {
  try {
    const user = await getSessionUser();
    const invitationToken = idSchema.parse(token);

    const invitation = await prisma.invitation.findUnique({
      where: { token: invitationToken },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!invitation || invitation.status !== "PENDING") {
      throw new ActionError("La invitación no es válida o ya fue utilizada.");
    }
    if (invitation.expiresAt < new Date()) {
      throw new ActionError("La invitación expiró. Pedí que te envíen una nueva.");
    }
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
      throw new ActionError(
        "Esta invitación fue enviada a otro email. Iniciá sesión con la cuenta correcta."
      );
    }

    const existingMembership = await prisma.organizationMember.findFirst({
      where: { userId: user.id },
      select: { id: true, organizationId: true },
    });
    if (existingMembership) {
      if (existingMembership.organizationId === invitation.organizationId) {
        await prisma.invitation.update({
          where: { id: invitation.id },
          data: { status: "ACCEPTED" },
        });
        return { ok: true };
      }
      throw new ActionError(
        "Tu usuario ya pertenece a otra organización. En esta etapa cada usuario puede pertenecer a una sola."
      );
    }

    // Se revalida el cupo al aceptar: el plan pudo cambiar (o vencer la
    // prueba) entre la invitación y este momento.
    await assertCanAddMember(invitation.organizationId, {
      includePending: false,
    });

    await prisma.$transaction([
      prisma.organizationMember.create({
        data: {
          organizationId: invitation.organizationId,
          userId: user.id,
          role: invitation.role,
        },
      }),
      prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "ACCEPTED" },
      }),
    ]);

    await recordAudit({
      organizationId: invitation.organizationId,
      userId: user.id,
      action: "equipo.miembro_agregado",
      entityType: "organization_member",
      details: { email: user.email, rol: invitation.role },
    });

    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
