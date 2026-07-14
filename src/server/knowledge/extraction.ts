import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import type { KnowledgeFormat } from "@/server/knowledge/files";

/**
 * Extracción de texto en el servidor. Sin OCR: si un PDF no tiene texto
 * extraíble se informa con claridad y NUNCA se simula un procesamiento exitoso.
 */

export type ExtractionErrorCode =
  | "pdf_no_text"
  | "empty"
  | "corrupt"
  | "unsupported";

export class ExtractionError extends Error {
  constructor(public readonly code: ExtractionErrorCode) {
    super(code);
    this.name = "ExtractionError";
  }
}

export const EXTRACTION_ERROR_MESSAGE: Record<ExtractionErrorCode, string> = {
  pdf_no_text:
    "El PDF no contiene texto extraíble. Por ahora no procesamos PDFs escaneados o de solo imágenes (sin OCR).",
  empty: "El archivo no contiene texto utilizable.",
  corrupt: "No se pudo leer el archivo. Puede estar dañado o protegido con contraseña.",
  unsupported: "El formato del archivo no está soportado.",
};

/** Cantidad mínima de caracteres “reales” para considerar que hay texto. */
const MIN_MEANINGFUL_CHARS = 8;

/**
 * Limpia caracteres inválidos preservando saltos de párrafo. Mantiene
 * títulos y párrafos (separados por líneas en blanco) cuando es posible.
 */
export function sanitizeExtractedText(raw: string): string {
  const cleaned = raw
    .replace(/\x00/g, "")
    .replace(/\r\n?/g, "\n")
    // Tabs, form feed y espacios especiales (NBSP, zero-width) pasan a espacio.
    .replace(/[\t\f\xa0​]/g, " ")
    // Resto de caracteres de control, excepto el salto de línea (\n = \x0a).
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/ {2,}/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned;
}

function hasMeaningfulText(text: string): boolean {
  return text.replace(/\s/g, "").length >= MIN_MEANINGFUL_CHARS;
}

async function extractPdf(data: Buffer): Promise<string> {
  let raw: string;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const result = await extractPdfText(pdf, { mergePages: true });
    raw = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } catch {
    throw new ExtractionError("corrupt");
  }
  const clean = sanitizeExtractedText(raw ?? "");
  if (!hasMeaningfulText(clean)) throw new ExtractionError("pdf_no_text");
  return clean;
}

async function extractDocx(data: Buffer): Promise<string> {
  let raw: string;
  try {
    const result = await mammoth.extractRawText({ buffer: data });
    raw = result.value;
  } catch {
    throw new ExtractionError("corrupt");
  }
  const clean = sanitizeExtractedText(raw ?? "");
  if (!clean) throw new ExtractionError("empty");
  return clean;
}

function extractTxt(data: Buffer): string {
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(data);
  const clean = sanitizeExtractedText(decoded);
  if (!clean) throw new ExtractionError("empty");
  return clean;
}

export async function extractDocumentText(
  format: KnowledgeFormat,
  data: Buffer
): Promise<string> {
  switch (format) {
    case "pdf":
      return extractPdf(data);
    case "docx":
      return extractDocx(data);
    case "txt":
      return extractTxt(data);
    default:
      throw new ExtractionError("unsupported");
  }
}
