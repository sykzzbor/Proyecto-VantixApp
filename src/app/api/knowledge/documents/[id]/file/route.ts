import { NextResponse, after, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { recordAudit } from "@/server/audit";
import {
  UPLOAD_ERROR_MESSAGE,
  UploadValidationError,
  buildStorageKey,
  sanitizeFilename,
  validateUpload,
} from "@/server/knowledge/files";
import { processKnowledgeDocument } from "@/server/knowledge/processing";
import { resolveKnowledgeRequestContext } from "@/server/knowledge/request-context";
import { getStorage } from "@/server/knowledge/storage";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/** Reemplaza el archivo de un documento existente, conservando su nombre. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolved = await resolveKnowledgeRequestContext(request);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.code, resolved.message);
    }
    const { userId, organizationId, role } = resolved.ctx;

    if (!can(role, "knowledge.manage")) {
      return jsonError(403, "forbidden", "No tenés permisos para reemplazar documentos.");
    }

    const { id } = await params;
    const existing = await prisma.knowledgeDocument.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      return jsonError(404, "not_found", "El documento no existe o no pertenece a tu organización.");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, "invalid_body", "No se pudo leer el archivo enviado.");
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(400, "no_file", "Adjuntá el nuevo documento.");
    }

    try {
      validateUpload({ filename: file.name, mimeType: file.type, size: file.size });
    } catch (error) {
      if (error instanceof UploadValidationError) {
        return jsonError(400, error.code, UPLOAD_ERROR_MESSAGE[error.code]);
      }
      throw error;
    }

    const data = Buffer.from(await file.arrayBuffer());
    const storageKey = buildStorageKey(organizationId, file.name);

    let stored: { key: string };
    try {
      stored = await getStorage().put({
        key: storageKey,
        data,
        contentType: file.type || "application/octet-stream",
      });
    } catch (error) {
      console.error(
        "[VantixApp] Error al reemplazar documento de conocimiento:",
        error instanceof Error ? error.name : "desconocido"
      );
      return jsonError(502, "storage_error", "No se pudo guardar el archivo. Intentá de nuevo.");
    }

    const previousStorageKey = existing.storageKey;

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({
        where: { documentId: id, organizationId },
      });
      await tx.knowledgeDocument.updateMany({
        where: { id, organizationId },
        data: {
          originalFilename: sanitizeFilename(file.name),
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          storageKey: stored.key,
          status: "UPLOADED",
          enabled: true,
          extractedText: null,
          processingError: null,
          chunkCount: 0,
          processedAt: null,
        },
      });
    });

    // El binario anterior ya no se usa.
    await getStorage().delete(previousStorageKey);

    await recordAudit({
      organizationId,
      userId,
      action: "knowledge.document_replaced",
      entityType: "knowledge_document",
      entityId: id,
      details: { tamano: file.size },
    });

    after(async () => {
      await processKnowledgeDocument({ documentId: id, organizationId });
    });

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error(
      "[VantixApp] Error inesperado al reemplazar documento:",
      error instanceof Error ? error.message : "desconocido"
    );
    return jsonError(500, "internal_error", "Ocurrió un error inesperado.");
  }
}
