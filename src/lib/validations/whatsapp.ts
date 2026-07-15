import { z } from "zod";

const META_ID_PATTERN = /^\d{5,32}$/;
const E164_PATTERN = /^\+?[1-9]\d{6,14}$/;

export const whatsappMetaIdSchema = z
  .string()
  .trim()
  .regex(META_ID_PATTERN, "El identificador de Meta no es valido.");

export const whatsappPhoneNumberIdSchema = whatsappMetaIdSchema;

export const whatsappAccessTokenSchema = z
  .string()
  .trim()
  .min(20, "El access token no es valido.")
  .max(4096, "El access token no es valido.");

/**
 * Datos ingresados por un administrador. El nombre y el numero visibles se
 * obtienen desde Meta y no se confian al navegador.
 */
export const whatsappIntegrationConfigSchema = z.object({
  wabaId: whatsappMetaIdSchema,
  phoneNumberId: whatsappPhoneNumberIdSchema,
  accessToken: whatsappAccessTokenSchema,
}).strict();

// Alias explicito para consumidores que nombren el formulario como configuracion.
export const whatsappConfigurationSchema = whatsappIntegrationConfigSchema;

export type WhatsappIntegrationConfigInput = z.infer<
  typeof whatsappIntegrationConfigSchema
>;

export const whatsappSimulatorMessageSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Ingresa un nombre ficticio.")
    .max(80, "El nombre es demasiado largo."),
  phone: z
    .string()
    .trim()
    .regex(E164_PATTERN, "Ingresa un telefono internacional valido."),
  message: z
    .string()
    .trim()
    .min(1, "El mensaje no puede estar vacio.")
    .max(2000, "El mensaje no puede superar los 2000 caracteres."),
});

export type WhatsappSimulatorMessageInput = z.infer<
  typeof whatsappSimulatorMessageSchema
>;

export const whatsappDeliveryStatusSchema = z.enum([
  "sent",
  "delivered",
  "read",
  "failed",
]);

export const whatsappExternalMessageIdSchema = z
  .string()
  .trim()
  .min(1, "El ID externo no es valido.")
  .max(255, "El ID externo no es valido.");

const optionalErrorText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal(""));

export const whatsappSimulatorStatusSchema = z.object({
  externalMessageId: whatsappExternalMessageIdSchema,
  status: whatsappDeliveryStatusSchema,
  errorCode: optionalErrorText(100),
  errorMessage: optionalErrorText(500),
});

// El webhook y el simulador comparten exactamente la misma forma interna.
export const whatsappStatusUpdateSchema = whatsappSimulatorStatusSchema;

export type WhatsappSimulatorStatusInput = z.infer<
  typeof whatsappSimulatorStatusSchema
>;
