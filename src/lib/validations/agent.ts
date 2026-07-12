import { z } from "zod";
import { AgentTone } from "@/generated/prisma/enums";

export const AGENT_TONE_LABELS: Record<AgentTone, string> = {
  PROFESSIONAL: "Profesional",
  FRIENDLY: "Amigable",
  FORMAL: "Formal",
  CASUAL: "Cercano",
};

export const agentSettingsSchema = z.object({
  assistantName: z
    .string()
    .min(2, "Ingresá el nombre del asistente.")
    .max(60, "El nombre es demasiado largo."),
  tone: z.enum(AgentTone, { error: "Elegí un tono de respuesta." }),
  welcomeMessage: z
    .string()
    .min(5, "Ingresá el mensaje de bienvenida.")
    .max(500, "El mensaje es demasiado largo."),
  fallbackMessage: z
    .string()
    .min(5, "Ingresá el mensaje para cuando no encuentre información.")
    .max(500, "El mensaje es demasiado largo."),
  handoffRules: z
    .string()
    .max(2000, "Las reglas de derivación son demasiado largas.")
    .optional()
    .or(z.literal("")),
  enabled: z.boolean(),
});

export type AgentSettingsInput = z.infer<typeof agentSettingsSchema>;
