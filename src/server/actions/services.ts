"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { serviceSchema, type ServiceInput } from "@/lib/validations/service";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";

const idSchema = z.string().min(1);
const toggleSchema = z.object({ id: idSchema, active: z.boolean() });

function revalidate() {
  revalidatePath("/dashboard/servicios");
  revalidatePath("/dashboard");
}

async function findOwnService(id: string, organizationId: string) {
  const service = await prisma.service.findFirst({
    where: { id, organizationId },
  });
  if (!service) throw new ActionError("El servicio no existe o no pertenece a tu negocio.");
  return service;
}

export async function createService(input: ServiceInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.create");
    const data = serviceSchema.parse(input);

    const service = await prisma.service.create({
      data: {
        organizationId: org.id,
        name: data.name,
        description: data.description || null,
        price: data.price,
        durationMinutes: data.durationMinutes,
        active: data.active,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "servicio.creado",
      entityType: "service",
      entityId: service.id,
      details: { nombre: service.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateService(
  id: string,
  input: ServiceInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.update");
    const serviceId = idSchema.parse(id);
    const data = serviceSchema.parse(input);

    await findOwnService(serviceId, org.id);
    await prisma.service.update({
      where: { id: serviceId },
      data: {
        name: data.name,
        description: data.description || null,
        price: data.price,
        durationMinutes: data.durationMinutes,
        active: data.active,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "servicio.actualizado",
      entityType: "service",
      entityId: serviceId,
      details: { nombre: data.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function toggleServiceActive(input: {
  id: string;
  active: boolean;
}): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.update");
    const { id, active } = toggleSchema.parse(input);

    const service = await findOwnService(id, org.id);
    await prisma.service.update({ where: { id }, data: { active } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: active ? "servicio.activado" : "servicio.desactivado",
      entityType: "service",
      entityId: id,
      details: { nombre: service.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteService(id: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.delete");
    const serviceId = idSchema.parse(id);

    const service = await findOwnService(serviceId, org.id);
    await prisma.service.delete({ where: { id: serviceId } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "servicio.eliminado",
      entityType: "service",
      entityId: serviceId,
      details: { nombre: service.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
