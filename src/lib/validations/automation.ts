import { z } from "zod";

export const automationPeriodSchema = z.enum(["24h", "7d", "30d"]);
export const automationEventStatusSchema = z.enum([
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD_LETTER",
  "CANCELLED",
]);
export const automationRunStatusSchema = z.enum([
  "STARTED",
  "SUCCEEDED",
  "FAILED",
]);

const optionalQueryString = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => value || undefined);

const paginationFields = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(10).max(50).default(20),
};

export const automationEventQuerySchema = z.object({
  ...paginationFields,
  period: automationPeriodSchema.default("7d"),
  status: automationEventStatusSchema.optional(),
  type: optionalQueryString,
  q: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((value) => value || undefined),
  order: z.enum(["desc", "asc"]).default("desc"),
});

export const automationRunQuerySchema = z.object({
  ...paginationFields,
  period: automationPeriodSchema.default("7d"),
  status: automationRunStatusSchema.optional(),
  provider: optionalQueryString,
  type: optionalQueryString,
  order: z.enum(["desc", "asc"]).default("desc"),
});

export const automationTestBodySchema = z.object({
  mock: z.enum(["success", "temporary_error", "permanent_error", "callback"]),
}).strict();

export const automationEventIdSchema = z.string().trim().min(1).max(64);

export type AutomationEventQuery = z.infer<typeof automationEventQuerySchema>;
export type AutomationRunQuery = z.infer<typeof automationRunQuerySchema>;
export type AutomationPeriod = z.infer<typeof automationPeriodSchema>;
export type AutomationTestMode = z.infer<typeof automationTestBodySchema>["mock"];

export function searchParamsToObject(searchParams: URLSearchParams) {
  return Object.fromEntries(searchParams.entries());
}
