import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { chunkText } from "@/server/knowledge/chunking";
import {
  EXTRACTION_ERROR_MESSAGE,
  ExtractionError,
  extractDocumentText,
} from "@/server/knowledge/extraction";
import { resolveKnowledgeFormat } from "@/server/knowledge/files";
import { getStorage } from "@/server/knowledge/storage";

/** Límite defensivo de fragmentos por documento. */
const MAX_CHUNKS = 400;
/** Tope de texto extraído que se guarda para "ver texto" (evita filas enormes). */
const EXTRACTED_TEXT_CAP = 200_000;

const GENERIC_ERROR =
  "No se pudo procesar el documento. Probá reprocesarlo; si el problema persiste, revisá el archivo.";

/**
 * Procesa un documento: descarga, extrae texto, limpia, divide en fragmentos
 * y persiste todo antes de marcarlo READY. Un documento NUNCA queda READY sin
 * que sus fragmentos estén guardados. Los errores se guardan sanitizados.
 *
 * Es idempotente: reemplaza los fragmentos previos. Diseñada para ejecutarse
 * fuera del render (via `after()`), compatible con Vercel.
 */
export async function processKnowledgeDocument(input: {
  documentId: string;
  organizationId: string;
}): Promise<{ status: "READY" | "FAILED" }> {
  const { documentId, organizationId } = input;

  const document = await prisma.knowledgeDocument.findFirst({
    where: { id: documentId, organizationId },
  });
  if (!document) return { status: "FAILED" };

  await prisma.knowledgeDocument.updateMany({
    where: { id: documentId, organizationId },
    data: { status: "PROCESSING", processingError: null },
  });

  try {
    const data = await getStorage().download(document.storageKey);
    const format = resolveKnowledgeFormat(
      document.mimeType,
      document.originalFilename
    );
    const text = await extractDocumentText(format, data);
    const chunks = chunkText(text).slice(0, MAX_CHUNKS);
    if (chunks.length === 0) throw new ExtractionError("empty");

    await prisma.$transaction(async (tx) => {
      await tx.knowledgeChunk.deleteMany({
        where: { documentId, organizationId },
      });
      await tx.knowledgeChunk.createMany({
        data: chunks.map((chunk) => ({
          organizationId,
          documentId,
          chunkIndex: chunk.index,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
        })),
      });
      await tx.knowledgeDocument.updateMany({
        where: { id: documentId, organizationId },
        data: {
          status: "READY",
          extractedText: text.slice(0, EXTRACTED_TEXT_CAP),
          processingError: null,
          chunkCount: chunks.length,
          processedAt: new Date(),
        },
      });
    });

    await recordAudit({
      organizationId,
      userId: null,
      action: "knowledge.document_processed",
      entityType: "knowledge_document",
      entityId: documentId,
      details: { fragmentos: chunks.length },
    });
    return { status: "READY" };
  } catch (error) {
    const message =
      error instanceof ExtractionError
        ? EXTRACTION_ERROR_MESSAGE[error.code]
        : GENERIC_ERROR;

    await prisma.knowledgeDocument.updateMany({
      where: { id: documentId, organizationId },
      data: {
        status: "FAILED",
        processingError: message,
        chunkCount: 0,
        processedAt: null,
      },
    });
    // Los fragmentos previos ya no son válidos.
    await prisma.knowledgeChunk.deleteMany({
      where: { documentId, organizationId },
    });

    await recordAudit({
      organizationId,
      userId: null,
      action: "knowledge.document_failed",
      entityType: "knowledge_document",
      entityId: documentId,
      details: {
        motivo: error instanceof ExtractionError ? error.code : "processing_error",
      },
    });
    return { status: "FAILED" };
  }
}
