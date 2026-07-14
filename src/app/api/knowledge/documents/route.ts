import { NextResponse, after, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { can } from "@/lib/permissions";
import { normalizeCategory } from "@/lib/validations/knowledge";
import { recordAudit } from "@/server/audit";
import {
  UPLOAD_ERROR_MESSAGE,
  UploadValidationError,
  buildStorageKey,
  displayNameFromFilename,
  sanitizeFilename,
  validateUpload,
} from "@/server/knowledge/files";
import { processKnowledgeDocument } from "@/server/knowledge/processing";
import { resolveKnowledgeRequestContext } from "@/server/knowledge/request-context";
import { getStorage } from "@/server/knowledge/storage";

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

export async function POST(request: NextRequest) {
  try {
    const resolved = await resolveKnowledgeRequestContext(request);
    if (!resolved.ok) {
      return jsonError(resolved.status, resolved.code, resolved.message);
    }
    const { userId, organizationId, role } = resolved.ctx;

    if (!can(role, "knowledge.manage")) {
      return jsonError(403, "forbidden", "No tenés permisos para subir documentos.");
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, "invalid_body", "No se pudo leer el archivo enviado.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return jsonError(400, "no_file", "Adjuntá un documento para subir.");
    }
    const rawCategory = form.get("category");
    const category = normalizeCategory(
      typeof rawCategory === "string" ? rawCategory : null
    );

    let format;
    try {
      ({ format } = validateUpload({
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      }));
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
        "[VantixApp] Error al guardar documento de conocimiento:",
        error instanceof Error ? error.name : "desconocido"
      );
      return jsonError(502, "storage_error", "No se pudo guardar el archivo. Intentá de nuevo.");
    }

    const document = await prisma.knowledgeDocument.create({
      data: {
        organizationId,
        uploadedByUserId: userId,
        name: displayNameFromFilename(file.name),
        originalFilename: sanitizeFilename(file.name),
        mimeType: file.type || "application/octet-stream",
        fileSize: file.size,
        storageKey: stored.key,
        category,
        status: "UPLOADED",
        enabled: true,
      },
    });

    await recordAudit({
      organizationId,
      userId,
      action: "knowledge.document_uploaded",
      entityType: "knowledge_document",
      entityId: document.id,
      details: { formato: format, tamano: file.size },
    });

    after(async () => {
      await processKnowledgeDocument({ documentId: document.id, organizationId });
    });

    return NextResponse.json({ ok: true, id: document.id });
  } catch (error) {
    console.error(
      "[VantixApp] Error inesperado en subida de conocimiento:",
      error instanceof Error ? error.message : "desconocido"
    );
    return jsonError(500, "internal_error", "Ocurrió un error inesperado.");
  }
}
