"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { faqSchema, type FaqInput } from "@/lib/validations/faq";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";

const idSchema = z.string().min(1);
const toggleSchema = z.object({ id: idSchema, active: z.boolean() });

function revalidate() {
  revalidatePath("/dashboard/preguntas");
  revalidatePath("/dashboard");
}

async function findOwnFaq(id: string, organizationId: string) {
  const faq = await prisma.faq.findFirst({ where: { id, organizationId } });
  if (!faq) throw new ActionError("La pregunta no existe o no pertenece a tu negocio.");
  return faq;
}

export async function createFaq(input: FaqInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.create");
    const data = faqSchema.parse(input);

    const faq = await prisma.faq.create({
      data: {
        organizationId: org.id,
        question: data.question,
        answer: data.answer,
        category: data.category || null,
        active: data.active,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "pregunta.creada",
      entityType: "faq",
      entityId: faq.id,
      details: { titulo: faq.question },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateFaq(id: string, input: FaqInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.update");
    const faqId = idSchema.parse(id);
    const data = faqSchema.parse(input);

    await findOwnFaq(faqId, org.id);
    await prisma.faq.update({
      where: { id: faqId },
      data: {
        question: data.question,
        answer: data.answer,
        category: data.category || null,
        active: data.active,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "pregunta.actualizada",
      entityType: "faq",
      entityId: faqId,
      details: { titulo: data.question },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function toggleFaqActive(input: {
  id: string;
  active: boolean;
}): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.update");
    const { id, active } = toggleSchema.parse(input);

    const faq = await findOwnFaq(id, org.id);
    await prisma.faq.update({ where: { id }, data: { active } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: active ? "pregunta.activada" : "pregunta.desactivada",
      entityType: "faq",
      entityId: id,
      details: { titulo: faq.question },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteFaq(id: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "catalog.delete");
    const faqId = idSchema.parse(id);

    const faq = await findOwnFaq(faqId, org.id);
    await prisma.faq.delete({ where: { id: faqId } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "pregunta.eliminada",
      entityType: "faq",
      entityId: faqId,
      details: { titulo: faq.question },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
