import { z } from "zod";

const safeText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => !/(?:[<>]|\$\{|javascript\s*:)/i.test(value), {
      message: "El texto contiene contenido no permitido.",
    });

const safeId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);

const minuteInstant = z
  .string()
  .datetime({ offset: true })
  .refine((value) => {
    const date = new Date(value);
    return date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  }, "La fecha debe tener precisión de minutos.");

const optionalPhone = z
  .string()
  .trim()
  .max(30)
  .transform((value) => value.replace(/[\s()-]/g, ""))
  .refine((value) => value === "" || /^\+[1-9]\d{7,14}$/.test(value), {
    message: "Ingresá el teléfono en formato internacional, por ejemplo +5493511234567.",
  });

export const appointmentIdSchema = safeId;
export const appointmentIdempotencyKeySchema = safeId;

export const createAppointmentSchema = z
  .object({
    customerId: safeId.nullable().optional(),
    conversationId: safeId.nullable().optional(),
    startAt: minuteInstant,
    title: safeText(120).min(3).optional(),
    customerName: safeText(120).min(2),
    customerPhone: optionalPhone.optional().default(""),
    notes: safeText(1000).optional().default(""),
    idempotencyKey: appointmentIdempotencyKeySchema,
  })
  .strict();

export const rescheduleAppointmentSchema = z
  .object({
    startAt: minuteInstant,
    idempotencyKey: appointmentIdempotencyKeySchema,
  })
  .strict();

export const cancelAppointmentSchema = z
  .object({
    reason: safeText(240).optional().default(""),
    idempotencyKey: appointmentIdempotencyKeySchema,
  })
  .strict();

export const appointmentListQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    status: z
      .enum(["PENDING", "CONFIRMED", "RESCHEDULED", "CANCELLED", "FAILED"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .superRefine((query, ctx) => {
    if (!query.from || !query.to) return;
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from >= to || to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: "custom", message: "El rango solicitado no es válido." });
    }
  });

export type CreateAppointmentRequest = z.infer<typeof createAppointmentSchema>;
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentSchema>;
export type CancelAppointmentRequest = z.infer<typeof cancelAppointmentSchema>;
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;
