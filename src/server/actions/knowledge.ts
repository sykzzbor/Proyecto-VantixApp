"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  categoryDocumentSchema,
  normalizeCategory,
  renameDocumentSchema,
  toggleDocumentSchema,
} from "@/lib/validations/knowledge";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import { processKnowledgeDocument } from "@/server/knowledge/processing";
import { getStorage } from "@/server/knowledge/storage";

const idSchema = z.string().min(1);

function revalidate() {
  revalidatePath("/dashboard/conocimiento");
}

/** Verifica que el documento pertenezca a la organización de la sesión. */
async function findOwnDocument(id: string, organizationId: string) {
  const document = await prisma.knowledgeDocument.findFirst({
    where: { id, organizationId },
  });
  if (!document) {
    throw new ActionError("El documento no existe o no pertenece a tu organización.");
  }
  return document;
}

/** Reprocesa un documento (reintento tras un fallo o reprocesamiento manual). */
export async function retryProcessDocument(id: string): Promise<ActionResult> {
  try {
    const { org, role } = await getOrgContext();
    requirePermission(role, "knowledge.manage");
    const documentId = idSchema.parse(id);
    const document = await findOwnDocument(documentId, org.id);
    if (document.status === "PROCESSING") {
      throw new ActionError("El documento ya se está procesando.");
    }

    await prisma.knowledgeDocument.updateMany({
      where: { id: documentId, organizationId: org.id },
      data: { status: "PROCESSING", processingError: null },
    });
    revalidate();

    // Procesamiento fuera del render (compatible con Vercel).
    after(async () => {
      await processKnowledgeDocument({ documentId, organizationId: org.id });
    });
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function renameDocument(input: {
  id: string;
  name: string;
}): Promise<ActionResult> {
  try {
    const { org, role, user } = await getOrgContext();
    requirePermission(role, "knowledge.manage");
    const data = renameDocumentSchema.parse(input);
    await findOwnDocument(data.id, org.id);

    await prisma.knowledgeDocument.updateMany({
      where: { id: data.id, organizationId: org.id },
      data: { name: data.name },
    });
    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "knowledge.document_renamed",
      entityType: "knowledge_document",
      entityId: data.id,
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function updateDocumentCategory(input: {
  id: string;
  category?: string;
}): Promise<ActionResult> {
  try {
    const { org, role, user } = await getOrgContext();
    requirePermission(role, "knowledge.manage");
    const data = categoryDocumentSchema.parse(input);
    await findOwnDocument(data.id, org.id);

    await prisma.knowledgeDocument.updateMany({
      where: { id: data.id, organizationId: org.id },
      data: { category: normalizeCategory(data.category) },
    });
    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "knowledge.document_recategorized",
      entityType: "knowledge_document",
      entityId: data.id,
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

/** Activa o desactiva la disponibilidad del documento para el agente. */
export async function toggleDocumentEnabled(input: {
  id: string;
  enabled: boolean;
}): Promise<ActionResult> {
  try {
    const { org, role, user } = await getOrgContext();
    requirePermission(role, "knowledge.manage");
    const { id, enabled } = toggleDocumentSchema.parse(input);
    const document = await findOwnDocument(id, org.id);

    if (enabled) {
      if (document.status !== "DISABLED") {
        throw new ActionError("El documento no está desactivado.");
      }
      await prisma.knowledgeDocument.updateMany({
        where: { id, organizationId: org.id },
        data: { enabled: true, status: "READY" },
      });
    } else {
      if (document.status !== "READY") {
        throw new ActionError("Solo se pueden desactivar documentos listos.");
      }
      await prisma.knowledgeDocument.updateMany({
        where: { id, organizationId: org.id },
        data: { enabled: false, status: "DISABLED" },
      });
    }

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: enabled
        ? "knowledge.document_enabled"
        : "knowledge.document_disabled",
      entityType: "knowledge_document",
      entityId: id,
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function deleteDocument(id: string): Promise<ActionResult> {
  try {
    const { org, role, user } = await getOrgContext();
    requirePermission(role, "knowledge.delete");
    const documentId = idSchema.parse(id);
    const document = await findOwnDocument(documentId, org.id);

    // Se elimina la fila (los fragmentos caen por cascade) y luego el binario.
    await prisma.knowledgeDocument.delete({ where: { id: documentId } });
    await getStorage().delete(document.storageKey);

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "knowledge.document_deleted",
      entityType: "knowledge_document",
      entityId: documentId,
      details: { nombre: document.name },
    });
    revalidate();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export type DocumentTextResult =
  | { ok: true; name: string; text: string }
  | { ok: false; error: string };

/** Devuelve el texto extraído para el visor "Ver texto". */
export async function getDocumentText(id: string): Promise<DocumentTextResult> {
  try {
    const { org, role } = await getOrgContext();
    requirePermission(role, "knowledge.read");
    const documentId = idSchema.parse(id);
    const document = await prisma.knowledgeDocument.findFirst({
      where: { id: documentId, organizationId: org.id },
      select: { name: true, extractedText: true },
    });
    if (!document) return { ok: false, error: "El documento no existe." };
    if (!document.extractedText) {
      return { ok: false, error: "Este documento todavía no tiene texto extraído." };
    }
    return { ok: true, name: document.name, text: document.extractedText };
  } catch (error) {
    const failure = toActionFailure(error);
    return { ok: false, error: failure.error };
  }
}
