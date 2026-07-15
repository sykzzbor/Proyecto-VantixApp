import { z } from "zod";
import { isValidIanaTimeZone } from "@/lib/automation-schedule";

export const AUTOMATION_RULE_TYPES = ["HANDOFF_ALERT", "FOLLOW_UP"] as const;
export const HANDOFF_RECIPIENT_OPTIONS = [
  "ASSIGNED_AGENT",
  "OWNERS_ADMINS",
  "BOTH",
] as const;
export const HANDOFF_CHANNELS = ["WHATSAPP"] as const;
export const FOLLOW_UP_DELAY_OPTIONS = [2, 6, 12, 24, 48] as const;
export const ALLOWED_FOLLOW_UP_PLACEHOLDERS = [
  "{{customerName}}",
  "{{businessName}}",
] as const;

export const DEFAULT_HANDOFF_CONFIG = {
  recipients: "BOTH" as const,
  channel: "WHATSAPP" as const,
  phoneNumbers: [] as string[],
  templateName: "",
  templateLanguage: "es_AR" as const,
};

export const DEFAULT_FOLLOW_UP_CONFIG = {
  delayHours: 24 as const,
  maxFollowUps: 1,
  startTime: "09:00",
  endTime: "18:00",
  enabledDays: [1, 2, 3, 4, 5],
  timeZone: "America/Argentina/Buenos_Aires",
  message:
    "Hola {{customerName}}, queríamos saber si pudiste revisar nuestro último mensaje. Si necesitás ayuda, el equipo de {{businessName}} está a disposición.",
  onlyOpenConversations: true as const,
};

const localTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingresá una hora válida.");

function hasOnlyAllowedPlaceholders(value: string): boolean {
  const placeholders = value.match(/{{[^{}]*}}/g) ?? [];
  if (
    placeholders.some(
      (placeholder) =>
        !(ALLOWED_FOLLOW_UP_PLACEHOLDERS as readonly string[]).includes(
          placeholder
        )
    )
  ) {
    return false;
  }
  const withoutKnown = ALLOWED_FOLLOW_UP_PLACEHOLDERS.reduce(
    (message, placeholder) => message.split(placeholder).join(""),
    value
  );
  return !/{{|}}/.test(withoutKnown);
}

export const handoffPhoneNumberSchema = z
  .string()
  .trim()
  .regex(
    /^\+[1-9]\d{7,14}$/,
    "Ingresá un número E.164 válido con signo + y código de país."
  );

const handoffTemplateNameSchema = z
  .string()
  .trim()
  .max(128, "El nombre de la plantilla no puede superar los 128 caracteres.")
  .refine(
    (value) => value === "" || /^[a-z0-9_]+$/.test(value),
    "Usá únicamente minúsculas, números y guiones bajos."
  );

const handoffTemplateLanguageSchema = z
  .string()
  .trim()
  .max(10, "El código de idioma no puede superar los 10 caracteres.")
  .regex(
    /^[a-z]{2,3}(?:_[A-Z]{2})?$/,
    "Ingresá un código de idioma válido, por ejemplo es_AR."
  );

/**
 * Acepta un borrador pausado e incorpora los campos nuevos a configuraciones
 * históricas. La validación de completitud se realiza por separado para no
 * obligar a inventar destinatarios ni plantillas al migrar reglas existentes.
 */
export const handoffRuleConfigSchema = z
  .object({
    recipients: z.enum(HANDOFF_RECIPIENT_OPTIONS),
    channel: z.literal("WHATSAPP").default("WHATSAPP"),
    phoneNumbers: z
      .array(handoffPhoneNumberSchema)
      .max(10, "Podés configurar como máximo 10 números.")
      .refine((numbers) => new Set(numbers).size === numbers.length, {
        message: "Los números destinatarios no pueden repetirse.",
      })
      .default([]),
    templateName: handoffTemplateNameSchema.default(""),
    templateLanguage: handoffTemplateLanguageSchema.default("es_AR"),
  })
  .strict();

export const completeHandoffRuleConfigSchema = handoffRuleConfigSchema
  .refine((config) => config.phoneNumbers.length >= 1, {
    message: "Agregá al menos un número destinatario.",
    path: ["phoneNumbers"],
  })
  .refine((config) => config.templateName.length > 0, {
    message: "Ingresá el nombre de una plantilla aprobada.",
    path: ["templateName"],
  });

export function isCompleteHandoffConfig(
  config: unknown
): boolean {
  return completeHandoffRuleConfigSchema.safeParse(config).success;
}

export const followUpRuleConfigSchema = z
  .object({
    delayHours: z.union(
      FOLLOW_UP_DELAY_OPTIONS.map((value) => z.literal(value)) as [
        z.ZodLiteral<2>,
        z.ZodLiteral<6>,
        z.ZodLiteral<12>,
        z.ZodLiteral<24>,
        z.ZodLiteral<48>,
      ]
    ),
    maxFollowUps: z.number().int().min(1).max(3),
    startTime: localTimeSchema,
    endTime: localTimeSchema,
    enabledDays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Elegí al menos un día.")
      .max(7)
      .refine((days) => new Set(days).size === days.length, {
        message: "Los días no pueden repetirse.",
      }),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine(isValidIanaTimeZone, "La zona horaria no es válida."),
    message: z
      .string()
      .trim()
      .min(20, "El mensaje es demasiado corto.")
      .max(500, "El mensaje no puede superar los 500 caracteres.")
      .refine(hasOnlyAllowedPlaceholders, {
        message: "El mensaje contiene un placeholder no permitido.",
      })
      .refine((value) => !/[<>]/.test(value), {
        message: "El mensaje no puede contener HTML.",
      })
      .refine((value) => !/(?:javascript\s*:|\$\{)/i.test(value), {
        message: "El mensaje contiene contenido no permitido.",
      }),
    onlyOpenConversations: z.literal(true),
  })
  .strict()
  .refine((config) => config.startTime !== config.endTime, {
    message: "El horario de inicio y fin debe ser diferente.",
    path: ["endTime"],
  });

const handoffUpdateSchema = z
  .object({
    type: z.literal("HANDOFF_ALERT"),
    enabled: z.boolean(),
    config: handoffRuleConfigSchema,
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();

const followUpUpdateSchema = z
  .object({
    type: z.literal("FOLLOW_UP"),
    enabled: z.boolean(),
    config: followUpRuleConfigSchema,
    expectedVersion: z.number().int().min(1).nullable(),
  })
  .strict();

export const automationRuleUpdateSchema = z
  .discriminatedUnion("type", [handoffUpdateSchema, followUpUpdateSchema])
  .superRefine((rule, ctx) => {
    if (
      rule.type === "HANDOFF_ALERT" &&
      rule.enabled &&
      !isCompleteHandoffConfig(rule.config)
    ) {
      const result = completeHandoffRuleConfigSchema.safeParse(rule.config);
      const issue = result.success ? null : result.error.issues[0];
      ctx.addIssue({
        code: "custom",
        message:
          issue?.message ??
          "Completá los destinatarios y la plantilla antes de activar la regla.",
        path: ["config", ...(issue?.path ?? [])],
      });
    }
  });

export const automationRuleTypeSchema = z.enum(AUTOMATION_RULE_TYPES);

export type HandoffRuleConfig = z.input<typeof handoffRuleConfigSchema>;
export type ParsedHandoffRuleConfig = z.output<typeof handoffRuleConfigSchema>;
export type FollowUpRuleConfig = z.infer<typeof followUpRuleConfigSchema>;
export type AutomationRuleUpdate = z.input<typeof automationRuleUpdateSchema>;
export type AutomationRuleTypeValue = z.infer<typeof automationRuleTypeSchema>;

export function parseAutomationRuleConfig(
  type: AutomationRuleTypeValue,
  config: unknown
): ParsedHandoffRuleConfig | FollowUpRuleConfig {
  return type === "HANDOFF_ALERT"
    ? handoffRuleConfigSchema.parse(config)
    : followUpRuleConfigSchema.parse(config);
}

export function renderFollowUpMessage(
  template: string,
  values: { customerName: string; businessName: string }
) {
  const parsed = followUpRuleConfigSchema.shape.message.parse(template);
  return parsed
    .split("{{customerName}}")
    .join(values.customerName.trim().slice(0, 80) || "cliente")
    .split("{{businessName}}")
    .join(values.businessName.trim().slice(0, 100) || "nuestro equipo")
    .slice(0, 500);
}
