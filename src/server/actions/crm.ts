"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createNoteSchema,
  createTagSchema,
  MAX_TAGS_PER_ENTITY,
  MAX_TAGS_PER_ORGANIZATION,
  updateNoteSchema,
  updateTagSchema,
  type CreateNoteInput,
  type CreateTagInput,
  type UpdateNoteInput,
  type UpdateTagInput,
} from "@/lib/validations/crm";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import { consumeThrottle } from "@/server/auth/throttle";

/**
 * Etiquetas y notas internas del CRM.
 *
 * En todas las acciones el `organizationId` sale de la sesión y forma parte
 * del `where`: un id de conversación, cliente o etiqueta que venga del
 * navegador nunca alcanza datos de otra organización, ni siquiera para
 * confirmar que existen (se responde "no existe" igual).
 *
 * Permisos: administrar el catálogo de etiquetas es de OWNER/ADMIN
 * (`inbox.manage`); aplicarlas y escribir notas es del equipo que atiende
 * (`inbox.respond`, que incluye AGENT).
 */

const idSchema = z.string().min(1).max(64);

function revalidate() {
  revalidatePath("/dashboard/conversaciones");
  revalidatePath("/dashboard/clientes");
}

/** Cupo compartido para las escrituras del CRM. */
async function checkCrmQuota(userId: string) {
  const quota = await consumeThrottle("crm-write", userId);
  if (!quota.allowed) {
    throw new ActionError(
      `Estás yendo muy rápido. Probá de nuevo en ${quota.retryAfterSeconds} segundos.`
    );
  }
}

// ============================================================
// Catálogo de etiquetas
// ============================================================

export async function createTag(input: CreateTagInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.manage");
    await checkCrmQuota(user.id);
    const data = createTagSchema.parse(input);

    const total = await prisma.crmTag.count({ where: { organizationId: org.id } });
    if (total >= MAX_TAGS_PER_ORGANIZATION) {
      throw new ActionError(
        `Llegaste al máximo de ${MAX_TAGS_PER_ORGANIZATION} etiquetas. Eliminá alguna para crear otra.`
      );
    }

    const duplicate = await prisma.crmTag.findFirst({
      where: { organizationId: org.id, name: data.name },
      select: { id: true },
    });
    if (duplicate) throw new ActionError("Ya existe una etiqueta con ese nombre.");

    const tag = await prisma.crmTag.create({
      data: { organizationId: org.id, name: data.name, color: data.color },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "crm.etiqueta_creada",
      entityType: "crm_tag",
      entityId: tag.id,
      details: { nombre: data.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateTag(input: UpdateTagInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.manage");
    await checkCrmQuota(user.id);
    const data = updateTagSchema.parse(input);

    // El id se busca acotado a la organización: una etiqueta ajena no existe.
    const tag = await prisma.crmTag.findFirst({
      where: { id: data.id, organizationId: org.id },
      select: { id: true, name: true },
    });
    if (!tag) throw new ActionError("La etiqueta no existe.");

    const duplicate = await prisma.crmTag.findFirst({
      where: { organizationId: org.id, name: data.name, NOT: { id: tag.id } },
      select: { id: true },
    });
    if (duplicate) throw new ActionError("Ya existe una etiqueta con ese nombre.");

    await prisma.crmTag.update({
      where: { id: tag.id },
      data: { name: data.name, color: data.color },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "crm.etiqueta_actualizada",
      entityType: "crm_tag",
      entityId: tag.id,
      details: { nombre: data.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteTag(id: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.manage");
    await checkCrmQuota(user.id);
    const tagId = idSchema.parse(id);

    const tag = await prisma.crmTag.findFirst({
      where: { id: tagId, organizationId: org.id },
      select: { id: true, name: true },
    });
    if (!tag) throw new ActionError("La etiqueta no existe.");

    // Las asignaciones caen por cascada.
    await prisma.crmTag.delete({ where: { id: tag.id } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "crm.etiqueta_eliminada",
      entityType: "crm_tag",
      entityId: tag.id,
      details: { nombre: tag.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ============================================================
// Aplicar etiquetas
// ============================================================

/** Verifica que la etiqueta y el destino sean de la organización de la sesión. */
async function assertTagAndTarget(
  organizationId: string,
  tagId: string,
  target: { conversationId?: string; customerId?: string }
) {
  const tag = await prisma.crmTag.findFirst({
    where: { id: tagId, organizationId },
    select: { id: true, name: true },
  });
  if (!tag) throw new ActionError("La etiqueta no existe.");

  if (target.conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: target.conversationId, organizationId },
      select: { id: true },
    });
    if (!conversation) throw new ActionError("La conversación no existe.");
  }
  if (target.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: target.customerId, organizationId },
      select: { id: true },
    });
    if (!customer) throw new ActionError("El cliente no existe.");
  }
  return tag;
}

export async function toggleConversationTag(input: {
  conversationId: string;
  tagId: string;
  /** `true` aplica la etiqueta, `false` la quita. */
  applied: boolean;
}): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    await checkCrmQuota(user.id);
    const conversationId = idSchema.parse(input.conversationId);
    const tagId = idSchema.parse(input.tagId);

    const tag = await assertTagAndTarget(org.id, tagId, { conversationId });

    if (input.applied) {
      const current = await prisma.conversationTag.count({
        where: { conversationId },
      });
      if (current >= MAX_TAGS_PER_ENTITY) {
        throw new ActionError(
          `Una conversación puede tener hasta ${MAX_TAGS_PER_ENTITY} etiquetas.`
        );
      }
      // Idempotente: volver a aplicar la misma etiqueta no falla.
      await prisma.conversationTag.upsert({
        where: { conversationId_tagId: { conversationId, tagId } },
        create: {
          conversationId,
          tagId,
          organizationId: org.id,
          createdById: user.id,
        },
        update: {},
      });
    } else {
      await prisma.conversationTag.deleteMany({
        where: { conversationId, tagId, organizationId: org.id },
      });
    }

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: input.applied ? "crm.etiqueta_aplicada" : "crm.etiqueta_quitada",
      entityType: "conversation",
      entityId: conversationId,
      details: { etiqueta: tag.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function toggleCustomerTag(input: {
  customerId: string;
  tagId: string;
  applied: boolean;
}): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    await checkCrmQuota(user.id);
    const customerId = idSchema.parse(input.customerId);
    const tagId = idSchema.parse(input.tagId);

    const tag = await assertTagAndTarget(org.id, tagId, { customerId });

    if (input.applied) {
      const current = await prisma.customerTag.count({ where: { customerId } });
      if (current >= MAX_TAGS_PER_ENTITY) {
        throw new ActionError(
          `Un cliente puede tener hasta ${MAX_TAGS_PER_ENTITY} etiquetas.`
        );
      }
      await prisma.customerTag.upsert({
        where: { customerId_tagId: { customerId, tagId } },
        create: {
          customerId,
          tagId,
          organizationId: org.id,
          createdById: user.id,
        },
        update: {},
      });
    } else {
      await prisma.customerTag.deleteMany({
        where: { customerId, tagId, organizationId: org.id },
      });
    }

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: input.applied ? "crm.etiqueta_aplicada" : "crm.etiqueta_quitada",
      entityType: "customer",
      entityId: customerId,
      details: { etiqueta: tag.name },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

// ============================================================
// Notas internas
// ============================================================

export async function createNote(input: CreateNoteInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    await checkCrmQuota(user.id);
    const data = createNoteSchema.parse(input);

    const conversation = await prisma.conversation.findFirst({
      where: { id: data.conversationId, organizationId: org.id },
      select: { id: true },
    });
    if (!conversation) throw new ActionError("La conversación no existe.");

    const note = await prisma.conversationNote.create({
      data: {
        organizationId: org.id,
        conversationId: conversation.id,
        authorId: user.id,
        body: data.body,
      },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "crm.nota_creada",
      entityType: "conversation",
      entityId: conversation.id,
      // Sin el texto de la nota: la auditoría registra el hecho, no el contenido.
      details: { notaId: note.id },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateNote(input: UpdateNoteInput): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    await checkCrmQuota(user.id);
    const data = updateNoteSchema.parse(input);

    const note = await prisma.conversationNote.findFirst({
      where: { id: data.id, organizationId: org.id },
      select: { id: true, authorId: true, conversationId: true },
    });
    if (!note) throw new ActionError("La nota no existe.");

    // Cada quien edita lo suyo; OWNER y ADMIN pueden corregir cualquiera.
    const canEditAny = role === "OWNER" || role === "ADMIN";
    if (note.authorId !== user.id && !canEditAny) {
      throw new ActionError("Solo podés editar tus propias notas.");
    }

    await prisma.conversationNote.update({
      where: { id: note.id },
      data: { body: data.body, editedAt: new Date() },
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "crm.nota_editada",
      entityType: "conversation",
      entityId: note.conversationId,
      details: { notaId: note.id },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteNote(id: string): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "inbox.respond");
    await checkCrmQuota(user.id);
    const noteId = idSchema.parse(id);

    const note = await prisma.conversationNote.findFirst({
      where: { id: noteId, organizationId: org.id },
      select: { id: true, authorId: true, conversationId: true },
    });
    if (!note) throw new ActionError("La nota no existe.");

    const canDeleteAny = role === "OWNER" || role === "ADMIN";
    if (note.authorId !== user.id && !canDeleteAny) {
      throw new ActionError("Solo podés eliminar tus propias notas.");
    }

    await prisma.conversationNote.delete({ where: { id: note.id } });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "crm.nota_eliminada",
      entityType: "conversation",
      entityId: note.conversationId,
      details: { notaId: note.id },
    });

    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
