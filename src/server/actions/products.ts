"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { productSchema, type ProductInput } from "@/lib/validations/product";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";

const idSchema = z.string().min(1);
const toggleSchema = z.object({ id: idSchema, active: z.boolean() });

function revalidate() {
  revalidatePath("/dashboard/productos");
  revalidatePath("/dashboard");
}

/** Busca el producto verificando que pertenezca a la organización de la sesión. */
async function findOwnProduct(id: string, organizationId: string) {
  const product = await prisma.product.findFirst({
    where: { id, organizationId },
  });
  if (!product) throw new ActionError("El producto no existe o no pertenece a tu negocio.");
  return product;
}

export async function createProduct(input: ProductInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.create");
    const data = productSchema.parse(input);

    const product = await prisma.product.create({
      data: {
        organizationId: org.id,
        name: data.name,
        description: data.description || null,
        price: data.price,
        stock: data.stock,
        category: data.category || null,
        active: data.active,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "producto.creado",
      entityType: "product",
      entityId: product.id,
      details: { nombre: product.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateProduct(
  id: string,
  input: ProductInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.update");
    const productId = idSchema.parse(id);
    const data = productSchema.parse(input);

    await findOwnProduct(productId, org.id);
    await prisma.product.update({
      where: { id: productId },
      data: {
        name: data.name,
        description: data.description || null,
        price: data.price,
        stock: data.stock,
        category: data.category || null,
        active: data.active,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "producto.actualizado",
      entityType: "product",
      entityId: productId,
      details: { nombre: data.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function toggleProductActive(input: {
  id: string;
  active: boolean;
}): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.update");
    const { id, active } = toggleSchema.parse(input);

    const product = await findOwnProduct(id, org.id);
    await prisma.product.update({ where: { id }, data: { active } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: active ? "producto.activado" : "producto.desactivado",
      entityType: "product",
      entityId: id,
      details: { nombre: product.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.delete");
    const productId = idSchema.parse(id);

    const product = await findOwnProduct(productId, org.id);
    await prisma.product.delete({ where: { id: productId } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "producto.eliminado",
      entityType: "product",
      entityId: productId,
      details: { nombre: product.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
