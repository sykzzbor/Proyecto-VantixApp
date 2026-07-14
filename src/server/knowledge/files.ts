import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/knowledge-constants";

/**
 * Validación y saneamiento de archivos del Centro de conocimiento.
 * Formatos iniciales: PDF con texto, DOCX y TXT UTF-8. Sin OCR, imágenes,
 * audio, XLSX ni URLs externas.
 */

// Límite centralizado en @/lib/knowledge-constants (compartido con el frontend).
export const MAX_FILE_SIZE = MAX_UPLOAD_BYTES;

export type KnowledgeFormat = "pdf" | "docx" | "txt";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const FORMAT_BY_MIME: Record<string, KnowledgeFormat> = {
  "application/pdf": "pdf",
  [DOCX_MIME]: "docx",
  "text/plain": "txt",
};

const FORMAT_BY_EXTENSION: Record<string, KnowledgeFormat> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".txt": "txt",
};

/** MIMEs genéricos que los navegadores envían a veces en lugar del real. */
const GENERIC_MIMES = new Set([
  "application/octet-stream",
  "application/binary",
  "",
]);

export const FORMAT_LABEL: Record<KnowledgeFormat, string> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
};

export type UploadValidationCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "type_mismatch";

export class UploadValidationError extends Error {
  constructor(public readonly code: UploadValidationCode) {
    super(code);
    this.name = "UploadValidationError";
  }
}

export const UPLOAD_ERROR_MESSAGE: Record<UploadValidationCode, string> = {
  empty: "El archivo está vacío.",
  too_large: `El archivo supera el límite de ${MAX_UPLOAD_MB} MB.`,
  unsupported_type:
    "Formato no permitido. Solo se aceptan PDF con texto, DOCX y TXT.",
  type_mismatch: "La extensión y el tipo del archivo no coinciden.",
};

function getExtension(filename: string): string {
  const base = filename.toLowerCase().trim();
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

/** Normaliza el MIME quitando parámetros (por ejemplo "; charset=utf-8"). */
function normalizeMime(mimeType: string): string {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Determina el formato validando extensión Y MIME. Si el MIME es genérico
 * (octet-stream) se confía en la extensión. Si ambos son conocidos pero
 * distintos, se rechaza por inconsistencia.
 */
export function detectFormat(
  mimeType: string,
  filename: string
): KnowledgeFormat {
  const mime = normalizeMime(mimeType);
  const ext = getExtension(filename);
  const byExt = FORMAT_BY_EXTENSION[ext];
  const byMime = FORMAT_BY_MIME[mime];

  if (!byExt) throw new UploadValidationError("unsupported_type");
  if (byMime && byMime !== byExt) {
    throw new UploadValidationError("type_mismatch");
  }
  if (!byMime && !GENERIC_MIMES.has(mime)) {
    // El MIME declarado no es genérico ni el esperado: no confiamos.
    throw new UploadValidationError("type_mismatch");
  }
  return byExt;
}

/**
 * Versión tolerante para documentos ya almacenados (que pasaron validación):
 * resuelve el formato por extensión y, si no, por MIME. No lanza.
 */
export function resolveKnowledgeFormat(
  mimeType: string,
  filename: string
): KnowledgeFormat {
  const ext = getExtension(filename);
  return (
    FORMAT_BY_EXTENSION[ext] ?? FORMAT_BY_MIME[normalizeMime(mimeType)] ?? "txt"
  );
}

export function validateUpload(input: {
  filename: string;
  mimeType: string;
  size: number;
}): { format: KnowledgeFormat } {
  if (!input.size || input.size <= 0) {
    throw new UploadValidationError("empty");
  }
  if (input.size > MAX_FILE_SIZE) {
    throw new UploadValidationError("too_large");
  }
  const format = detectFormat(input.mimeType, input.filename);
  return { format };
}

/**
 * Sanea el nombre visible: quita rutas, caracteres de control y separadores,
 * evita path traversal y limita la longitud. Nunca queda vacío.
 */
export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base
    // Caracteres de control (0x00-0x1F y 0x7F).
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 200)
    .trim();
  return cleaned || "documento";
}

/** Nombre por defecto legible a partir del archivo (sin la extensión). */
export function displayNameFromFilename(filename: string): string {
  const safe = sanitizeFilename(filename);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  return stem.trim().slice(0, 160) || safe;
}

/**
 * Clave de almacenamiento aislada por organización, con un identificador
 * aleatorio para que no sea adivinable. No se expone al navegador.
 */
export function buildStorageKey(
  organizationId: string,
  filename: string
): string {
  const safe = sanitizeFilename(filename).replace(/\s+/g, "_");
  return `knowledge/${organizationId}/${randomUUID()}-${safe}`;
}
