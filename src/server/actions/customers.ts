"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  customerFormSchema,
  type CustomerFormInput,
} from "@/lib/validations/conversation";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";

const idSchema = z.string().min(1);

/**
 * Crea o actualiza el cliente de una conversación. Si la conversación
 * todavía no tiene cliente (chat de prueba), lo crea y lo vincula.
 */
export async function saveConversationCustomer(
  conversationId: string,
  input: CustomerFormInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "customers.update");
    const id = idSchema.parse(conversationId);
    const data = customerFormSchema.parse(input);

    const conversation = await prisma.conversation.findFirst({
      where: { id, organizationId: org.id },
      select: { id: true, customerId: true },
    });
    if (!conversation) {
      throw new ActionError("La conversación no existe o no pertenece a tu negocio.");
    }

    const values = {
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      notes: data.notes || null,
    };

    if (conversation.customerId) {
      // El cliente también se verifica contra la organización.
      const customer = await prisma.customer.findFirst({
        where: { id: conversation.customerId, organizationId: org.id },
        select: { id: true },
      });
      if (!customer) throw new ActionError("El cliente no pertenece a tu negocio.");

      await prisma.customer.update({
        where: { id: customer.id },
        data: values,
      });

      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "cliente.actualizado",
        entityType: "customer",
        entityId: customer.id,
        details: { nombre: data.name },
      });
    } else {
      const customer = await prisma.customer.create({
        data: { organizationId: org.id, ...values },
      });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { customerId: customer.id },
      });

      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "cliente.creado",
        entityType: "customer",
        entityId: customer.id,
        details: { nombre: data.name },
      });
    }

    revalidatePath("/dashboard/conversaciones");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
