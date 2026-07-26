import { z } from "zod";

/**
 * Validaciones del CRM.
 *
 * Se comparten entre el formulario y la acción de servidor, pero la que manda
 * es la del servidor: el cliente puede saltearse cualquier chequeo.
 */

/** Solo #rrggbb: evita que entre `javascript:` o una URL en un atributo de estilo. */
export const TAG_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

/** Paleta sugerida; el servidor acepta cualquier #rrggbb válido. */
export const TAG_COLORS = [
  "#64748b",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

export const tagNameSchema = z
  .string()
  .trim()
  .min(2, "El nombre debe tener al menos 2 caracteres.")
  .max(40, "El nombre es demasiado largo.")
  // Sin `<` ni `>`: la etiqueta se muestra en muchas pantallas.
  .regex(/^[^<>]+$/, "El nombre no puede contener < ni >.");

export const tagColorSchema = z
  .string()
  .trim()
  .regex(TAG_COLOR_PATTERN, "Elegí un color válido.");

export const createTagSchema = z.object({
  name: tagNameSchema,
  color: tagColorSchema,
});
export type CreateTagInput = z.infer<typeof createTagSchema>;

export const updateTagSchema = z.object({
  id: z.string().min(1),
  name: tagNameSchema,
  color: tagColorSchema,
});
export type UpdateTagInput = z.infer<typeof updateTagSchema>;

export const noteBodySchema = z
  .string()
  .trim()
  .min(1, "Escribí algo antes de guardar.")
  .max(2000, "La nota es demasiado larga (máximo 2000 caracteres).");

export const createNoteSchema = z.object({
  conversationId: z.string().min(1),
  body: noteBodySchema,
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const updateNoteSchema = z.object({
  id: z.string().min(1),
  body: noteBodySchema,
});
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/** Máximo de etiquetas por conversación o cliente, para que la UI no reviente. */
export const MAX_TAGS_PER_ENTITY = 12;
/** Máximo de etiquetas por organización. */
export const MAX_TAGS_PER_ORGANIZATION = 60;
