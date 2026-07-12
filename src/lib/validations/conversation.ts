import { z } from "zod";

export const MAX_HUMAN_MESSAGE_LENGTH = 2000;

export const humanMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "El mensaje no puede estar vacío.")
    .max(
      MAX_HUMAN_MESSAGE_LENGTH,
      `El mensaje no puede superar los ${MAX_HUMAN_MESSAGE_LENGTH} caracteres.`
    ),
});

export type HumanMessageInput = z.infer<typeof humanMessageSchema>;

export const conversationStatusSchema = z.enum(["OPEN", "PENDING", "CLOSED"], {
  error: "El estado no es válido.",
});

export type ConversationStatusInput = z.infer<typeof conversationStatusSchema>;

const optionalText = (max: number, message: string) =>
  z.string().trim().max(max, message).optional().or(z.literal(""));

export const customerFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Ingresá el nombre del cliente.")
    .max(80, "El nombre es demasiado largo."),
  phone: optionalText(30, "El teléfono es demasiado largo."),
  email: z.email("Ingresá un email válido.").optional().or(z.literal("")),
  notes: optionalText(1000, "Las notas son demasiado largas."),
});

export type CustomerFormInput = z.infer<typeof customerFormSchema>;
