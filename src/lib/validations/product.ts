import { z } from "zod";

export const productSchema = z.object({
  name: z
    .string()
    .min(2, "Ingresá el nombre del producto.")
    .max(120, "El nombre es demasiado largo."),
  description: z
    .string()
    .max(2000, "La descripción es demasiado larga.")
    .optional()
    .or(z.literal("")),
  price: z
    .number({ error: "Ingresá un precio válido." })
    .min(0, "El precio no puede ser negativo.")
    .max(99_999_999, "El precio es demasiado alto."),
  stock: z
    .number({ error: "Ingresá un stock válido." })
    .int("El stock debe ser un número entero.")
    .min(0, "El stock no puede ser negativo.")
    .max(9_999_999, "El stock es demasiado alto."),
  category: z
    .string()
    .max(60, "La categoría es demasiado larga.")
    .optional()
    .or(z.literal("")),
  active: z.boolean(),
});

export type ProductInput = z.infer<typeof productSchema>;
