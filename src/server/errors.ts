import { ZodError } from "zod";

/**
 * Error controlado dentro de una server action. Su mensaje es seguro
 * para mostrar al usuario final.
 */
export class ActionError extends Error {}

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export function toActionFailure(error: unknown): { ok: false; error: string } {
  if (error instanceof ActionError) {
    return { ok: false, error: error.message };
  }
  if (error instanceof ZodError) {
    return { ok: false, error: "Los datos enviados no son válidos. Revisá el formulario." };
  }
  console.error("[VantixApp] Error inesperado en una acción:", error);
  return { ok: false, error: "Ocurrió un error inesperado. Intentá de nuevo en unos segundos." };
}
