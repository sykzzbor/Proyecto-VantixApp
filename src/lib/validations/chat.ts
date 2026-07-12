import { z } from "zod";

export const MAX_CHAT_MESSAGE_LENGTH = 1000;

export const chatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "El mensaje no puede estar vacío.")
    .max(
      MAX_CHAT_MESSAGE_LENGTH,
      `El mensaje no puede superar los ${MAX_CHAT_MESSAGE_LENGTH} caracteres.`
    ),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
