"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/slug";
import {
  createOrganizationSchema,
  renameOrganizationSchema,
  type CreateOrganizationInput,
  type RenameOrganizationInput,
} from "@/lib/validations/business";
import { recordAudit } from "@/server/audit";
import {
  getOrgContext,
  getSessionUser,
  requirePermission,
} from "@/server/context";
import { toActionFailure, type ActionResult } from "@/server/errors";

/**
 * Crea la organización inicial del usuario (onboarding o registro).
 * Es idempotente: si el usuario ya pertenece a una organización, no hace nada.
 */
export async function createOrganization(
  input: CreateOrganizationInput
): Promise<ActionResult> {
  try {
    const user = await getSessionUser();
    const data = createOrganizationSchema.parse(input);

    const existing = await prisma.organizationMember.findFirst({
      where: { userId: user.id },
      select: { id: true },
    });
    if (existing) return { ok: true };

    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: data.name, slug: slugify(data.name) },
      });
      await tx.organizationMember.create({
        data: { organizationId: org.id, userId: user.id, role: "OWNER" },
      });
      await tx.businessProfile.create({
        data: { organizationId: org.id, name: data.name },
      });
      await tx.agentSettings.create({
        data: { organizationId: org.id },
      });
      return org;
    });

    await recordAudit({
      organizationId: organization.id,
      userId: user.id,
      action: "organizacion.creada",
      entityType: "organization",
      entityId: organization.id,
      details: { nombre: organization.name },
    });

    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function renameOrganization(
  input: RenameOrganizationInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "org.update");
    const data = renameOrganizationSchema.parse(input);

    await prisma.organization.update({
      where: { id: org.id },
      data: { name: data.name },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "organizacion.renombrada",
      entityType: "organization",
      entityId: org.id,
      details: { nombre: data.name, anterior: org.name },
    });

    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/**
 * Elimina la organización y todos sus datos (cascada).
 * Solo el propietario puede hacerlo.
 */
export async function deleteOrganization(): Promise<ActionResult> {
  try {
    const { org, role } = await getOrgContext();
    requirePermission(role, "org.delete");

    await prisma.organization.delete({ where: { id: org.id } });

    revalidatePath("/dashboard", "layout");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
