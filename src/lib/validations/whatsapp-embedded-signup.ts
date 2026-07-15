import { z } from "zod";

export const whatsappEmptyMutationSchema = z.object({}).strict();

export const whatsappEmbeddedSignupCompleteSchema = z
  .object({
    code: z
      .string()
      .min(20, "El código temporal de Meta no es válido.")
      .max(4096, "El código temporal de Meta no es válido.")
      .refine(
        (value) => value === value.trim() && /^[\x21-\x7e]+$/.test(value),
        "El código temporal de Meta no es válido."
      ),
  })
  .strict();

export type WhatsappEmbeddedSignupCompleteInput = z.infer<
  typeof whatsappEmbeddedSignupCompleteSchema
>;
