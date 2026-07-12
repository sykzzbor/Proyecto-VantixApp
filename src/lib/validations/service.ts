import { z } from "zod";

export const serviceSchema = z.object({
  name: z
    .string()
    .min(2, "Ingresá el nombre del servicio.")
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
  durationMinutes: z
    .number({ error: "Ingresá una duración válida." })
    .int("La duración debe ser un número entero de minutos.")
    .min(5, "La duración mínima es de 5 minutos.")
    .max(1440, "La duración máxima es de 24 horas."),
  active: z.boolean(),
});

export type ServiceInput = z.infer<typeof serviceSchema>;
