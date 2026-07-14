import assert from "node:assert/strict";
import { test } from "node:test";
import { chunkText } from "@/server/knowledge/chunking";
import {
  ExtractionError,
  extractDocumentText,
  sanitizeExtractedText,
} from "@/server/knowledge/extraction";
import {
  UploadValidationError,
  detectFormat,
  resolveKnowledgeFormat,
  sanitizeFilename,
  validateUpload,
} from "@/server/knowledge/files";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

test("validateUpload acepta PDF, DOCX y TXT válidos", () => {
  assert.equal(
    validateUpload({ filename: "manual.pdf", mimeType: "application/pdf", size: 1000 })
      .format,
    "pdf"
  );
  assert.equal(
    validateUpload({ filename: "guia.docx", mimeType: DOCX_MIME, size: 1000 }).format,
    "docx"
  );
  assert.equal(
    validateUpload({
      filename: "notas.txt",
      mimeType: "text/plain; charset=utf-8",
      size: 1000,
    }).format,
    "txt"
  );
  // MIME genérico + extensión válida: se confía en la extensión.
  assert.equal(
    validateUpload({
      filename: "x.pdf",
      mimeType: "application/octet-stream",
      size: 10,
    }).format,
    "pdf"
  );
});

test("validateUpload rechaza tipo no permitido, vacío y demasiado grande", () => {
  assert.throws(
    () =>
      validateUpload({
        filename: "hoja.xlsx",
        mimeType: "application/vnd.ms-excel",
        size: 10,
      }),
    (error: unknown) =>
      error instanceof UploadValidationError && error.code === "unsupported_type"
  );
  assert.throws(
    () => validateUpload({ filename: "vacio.txt", mimeType: "text/plain", size: 0 }),
    (error: unknown) =>
      error instanceof UploadValidationError && error.code === "empty"
  );
  assert.throws(
    () =>
      validateUpload({
        filename: "grande.pdf",
        mimeType: "application/pdf",
        size: 50 * 1024 * 1024,
      }),
    (error: unknown) =>
      error instanceof UploadValidationError && error.code === "too_large"
  );
});

test("detectFormat rechaza cuando MIME y extensión conocidos no coinciden", () => {
  assert.throws(
    () => detectFormat("application/pdf", "archivo.txt"),
    (error: unknown) =>
      error instanceof UploadValidationError && error.code === "type_mismatch"
  );
});

test("sanitizeFilename evita path traversal y separadores", () => {
  assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  const cleaned = sanitizeFilename("a/b\\c.txt");
  assert.equal(cleaned.includes("/"), false);
  assert.equal(cleaned.includes("\\"), false);
  assert.equal(sanitizeFilename(""), "documento");
});

test("resolveKnowledgeFormat no lanza y usa la extensión", () => {
  assert.equal(resolveKnowledgeFormat("application/octet-stream", "doc.docx"), "docx");
});

test("chunkText divide, no deja fragmentos vacíos y numera en orden", () => {
  const longText = Array.from(
    { length: 60 },
    (_, index) => `Parrafo numero ${index} con suficiente texto como para separarlo.`
  ).join("\n\n");
  const chunks = chunkText(longText, { chunkSize: 200, overlap: 40 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => chunk.content.trim().length > 0));
  assert.deepEqual(
    chunks.map((chunk) => chunk.index),
    chunks.map((_, index) => index)
  );
  assert.ok(chunks.every((chunk) => chunk.tokenCount > 0));
});

test("chunkText devuelve vacío para texto en blanco", () => {
  assert.deepEqual(chunkText("   \n\n  "), []);
});

test("sanitizeExtractedText colapsa espacios dobles y preserva párrafos", () => {
  const dirty = "Hola  mundo\r\n\r\n\r\nSegundo   parrafo\t.";
  const clean = sanitizeExtractedText(dirty);
  assert.equal(clean.includes("  "), false);
  assert.ok(clean.includes("\n\n"));
  assert.ok(clean.includes("Segundo parrafo"));
});

test("extractDocumentText de TXT devuelve el texto y falla si está vacío", async () => {
  const text = await extractDocumentText(
    "txt",
    Buffer.from("Contenido de prueba del documento.", "utf8")
  );
  assert.ok(text.includes("Contenido de prueba"));
  await assert.rejects(
    () => extractDocumentText("txt", Buffer.from("   ", "utf8")),
    (error: unknown) => error instanceof ExtractionError && error.code === "empty"
  );
});
