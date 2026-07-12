import { z } from "zod";

export const faqSchema = z.object({
  question: z
    .string()
    .min(5, "La pregunta debe tener al menos 5 caracteres.")
    .max(300, "La pregunta es demasiado larga."),
  answer: z
    .string()
    .min(2, "Ingresá la respuesta.")
    .max(5000, "La respuesta es demasiado larga."),
  category: z
    .string()
    .max(60, "La categoría es demasiado larga.")
    .optional()
    .or(z.literal("")),
  active: z.boolean(),
});

export type FaqInput = z.infer<typeof faqSchema>;
