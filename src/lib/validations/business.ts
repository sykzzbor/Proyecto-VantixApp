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

export const createOrganizationSchema = z.object({
  name: z
    .string()
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
