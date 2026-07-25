import { z } from "zod";

const optionalText = (max: number, message: string) =>
  z.string().max(max, message).optional().or(z.literal(""));

export const businessProfileSchema = z.object({
  name: z
    .string()
    .min(2, "Ingresá el nombre del negocio.")
    .max(120, "El nombre es demasiado largo."),
  description: optionalText(2000, "La descripción es demasiado larga."),
  industry: optionalText(80, "El rubro es demasiado largo."),
  phone: optionalText(30, "El teléfono es demasiado largo."),
  email: z.email("Ingresá un email válido.").optional().or(z.literal("")),
  website: z.url("Ingresá una URL válida (con https://).").optional().or(z.literal("")),
  address: optionalText(200, "La dirección es demasiado larga."),
  city: optionalText(80, "La ciudad es demasiado larga."),
  country: optionalText(80, "El país es demasiado largo."),
  openingHours: optionalText(300, "El horario es demasiado largo."),
  paymentMethods: optionalText(300, "Los métodos de pago son demasiado largos."),
  shippingInfo: optionalText(500, "La información de envíos es demasiado larga."),
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

/**
 * Zona horaria IANA. Se valida contra la lista real de la plataforma en vez
 * de aceptar cualquier texto: el agente la usa para decidir si el negocio está
 * abierto, así que un valor inventado daría respuestas mal calculadas.
 */
export const timeZoneSchema = z
  .string()
  .min(1, "Elegí tu zona horaria.")
  .max(64, "La zona horaria no es válida.")
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Elegí una zona horaria válida.");

/**
 * Paso 2 del onboarding. Cada paso valida SOLO sus campos y escribe SOLO esas
 * columnas: así un cuerpo con campos de más no puede tocar nada que la
 * pantalla no ofrezca (mass assignment).
 */
export const onboardingBusinessInfoSchema = z.object({
  description: z
    .string()
    .trim()
    .min(20, "Contá en al menos 20 caracteres a qué se dedica tu negocio.")
    .max(2000, "La descripción es demasiado larga."),
  industry: optionalText(80, "El rubro es demasiado largo."),
  phone: optionalText(30, "El teléfono es demasiado largo."),
  email: z.email("Ingresá un email válido.").optional().or(z.literal("")),
  address: optionalText(200, "La dirección es demasiado larga."),
  city: optionalText(80, "La ciudad es demasiado larga."),
  country: optionalText(80, "El país es demasiado largo."),
});

export type OnboardingBusinessInfoInput = z.infer<
  typeof onboardingBusinessInfoSchema
>;

/** Paso 3 del onboarding: horarios y zona horaria. */
export const onboardingScheduleSchema = z.object({
  openingHours: z
    .string()
    .trim()
    .min(5, "Contá tus horarios de atención.")
    .max(300, "El horario es demasiado largo."),
  timeZone: timeZoneSchema,
});

export type OnboardingScheduleInput = z.infer<typeof onboardingScheduleSchema>;

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Ingresá el nombre de tu negocio.")
    .max(120, "El nombre es demasiado largo."),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const renameOrganizationSchema = z.object({
  name: z
    .string()
    .min(2, "Ingresá el nombre de la organización.")
    .max(120, "El nombre es demasiado largo."),
});

export type RenameOrganizationInput = z.infer<typeof renameOrganizationSchema>;
