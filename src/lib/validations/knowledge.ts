import { z } from "zod";

// Límite de subida centralizado (misma fuente que frontend y backend).
export { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/knowledge-constants";

export const CATEGORY_MAX_LENGTH = 60;
export const DOCUMENT_NAME_MAX_LENGTH = 160;

export const renameDocumentSchema = z.object({
  id: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, "Ingresá un nombre para el documento.")
    .max(DOCUMENT_NAME_MAX_LENGTH, "El nombre es demasiado largo."),
});

export const categoryDocumentSchema = z.object({
  id: z.string().min(1),
  category: z
    .string()
    .trim()
    .max(CATEGORY_MAX_LENGTH, "La categoría es demasiado larga.")
    .optional()
    .or(z.literal("")),
});

export const toggleDocumentSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
});

export type RenameDocumentInput = z.infer<typeof renameDocumentSchema>;
export type CategoryDocumentInput = z.infer<typeof categoryDocumentSchema>;
export type ToggleDocumentInput = z.infer<typeof toggleDocumentSchema>;

/** Normaliza una categoría entrante: vacío -> null, recortada al máximo. */
export function normalizeCategory(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, CATEGORY_MAX_LENGTH) : null;
}
