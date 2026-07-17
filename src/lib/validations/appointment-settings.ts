import { z } from "zod";
import { isValidIanaTimeZone } from "@/lib/automation-schedule";

export const APPOINTMENT_DURATION_OPTIONS = [15, 30, 45, 60, 90] as const;
export const APPOINTMENT_DAY_LABELS = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
] as const;

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingresá una hora válida.");

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

const safePlainText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .refine((value) => !/(?:[<>]|\$\{|javascript\s*:)/i.test(value), {
      message: "El texto contiene contenido no permitido.",
    });

export const appointmentTimeRangeSchema = z
  .object({
    start: localTimeSchema,
    end: localTimeSchema,
  })
  .strict()
  .refine((range) => minuteOfDay(range.start) < minuteOfDay(range.end), {
    message: "La hora de fin debe ser posterior a la de inicio.",
    path: ["end"],
  });

export const appointmentDayScheduleSchema = z
  .object({
    day: z.number().int().min(1).max(7),
    enabled: z.boolean(),
    ranges: z.array(appointmentTimeRangeSchema).max(4),
  })
  .strict()
  .superRefine((day, ctx) => {
    const ordered = day.ranges
      .map((range, index) => ({
        index,
        start: minuteOfDay(range.start),
        end: minuteOfDay(range.end),
      }))
      .sort((left, right) => left.start - right.start);
    for (let index = 1; index < ordered.length; index += 1) {
      if (ordered[index].start < ordered[index - 1].end) {
        ctx.addIssue({
          code: "custom",
          message: "Los rangos de un mismo día no pueden superponerse.",
          path: ["ranges", ordered[index].index],
        });
      }
    }
  });

export const weeklyAppointmentScheduleSchema = z
  .array(appointmentDayScheduleSchema)
  .length(7)
  .superRefine((schedule, ctx) => {
    const days = schedule.map((item) => item.day);
    if (new Set(days).size !== 7 || ![1, 2, 3, 4, 5, 6, 7].every((day) => days.includes(day))) {
      ctx.addIssue({
        code: "custom",
        message: "La configuración debe incluir cada día una sola vez.",
      });
    }
  });

export const appointmentSettingsSchema = z
  .object({
    enabled: z.boolean(),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidIanaTimeZone, "La zona horaria no es válida."),
    defaultDurationMinutes: z
      .number()
      .int()
      .refine(
        (value) => (APPOINTMENT_DURATION_OPTIONS as readonly number[]).includes(value),
        "La duración no es válida."
      ),
    bufferMinutes: z.number().int().min(0).max(120).multipleOf(5),
    minimumNoticeMinutes: z.number().int().min(0).max(43_200),
    maxAdvanceDays: z.number().int().min(1).max(365),
    weeklySchedule: weeklyAppointmentScheduleSchema,
    location: safePlainText(200),
    defaultEventTitle: safePlainText(120).min(3),
    allowRescheduling: z.boolean(),
    allowCancellation: z.boolean(),
  })
  .strict()
  .refine(
    (settings) => settings.minimumNoticeMinutes <= settings.maxAdvanceDays * 1440,
    {
      message: "La anticipación mínima supera la ventana futura configurada.",
      path: ["minimumNoticeMinutes"],
    }
  );

export const activeAppointmentSettingsSchema = appointmentSettingsSchema.superRefine(
  (settings, ctx) => {
    const enabledDays = settings.weeklySchedule.filter((day) => day.enabled);
    if (enabledDays.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Elegí al menos un día habilitado.",
        path: ["weeklySchedule"],
      });
    }
    for (const day of enabledDays) {
      if (day.ranges.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: `${APPOINTMENT_DAY_LABELS[day.day - 1]} necesita al menos un rango horario.`,
          path: ["weeklySchedule", day.day - 1, "ranges"],
        });
      }
    }
  }
);

export type AppointmentSettingsInput = z.infer<typeof appointmentSettingsSchema>;
export type AppointmentDaySchedule = z.infer<typeof appointmentDayScheduleSchema>;

export function createDefaultAppointmentSettings(): AppointmentSettingsInput {
  return {
    enabled: false,
    timeZone: "UTC",
    defaultDurationMinutes: 30,
    bufferMinutes: 0,
    minimumNoticeMinutes: 120,
    maxAdvanceDays: 30,
    weeklySchedule: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      day,
      enabled: day <= 5,
      ranges: [],
    })),
    location: "",
    defaultEventTitle: "Turno",
    allowRescheduling: false,
    allowCancellation: false,
  };
}

export const availabilityRequestSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict();

export type AvailabilityRequest = z.infer<typeof availabilityRequestSchema>;
