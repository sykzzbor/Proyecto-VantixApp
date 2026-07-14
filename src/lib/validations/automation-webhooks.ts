import { z } from "zod";

export const n8nCallbackSchema = z
  .object({
    eventId: z.string().trim().min(1).max(64),
    runId: z.string().trim().min(1).max(64),
    organizationId: z.string().trim().min(1).max(64),
    timestamp: z.number().int().positive(),
    status: z.enum(["succeeded", "failed"]),
    externalExecutionId: z.string().max(200).nullish(),
    errorCode: z.string().max(120).nullish(),
    errorMessage: z.string().max(500).nullish(),
    responseMeta: z.record(z.string(), z.unknown()).nullish(),
  })
  .strict();

export const n8nFollowUpActionSchema = z
  .object({
    eventId: z.string().trim().min(1).max(64),
    runId: z.string().trim().min(1).max(64),
    organizationId: z.string().trim().min(1).max(64),
    conversationId: z.string().trim().min(1).max(64),
    timestamp: z.number().int().positive(),
  })
  .strict();

export function signedTimestampMatches(
  bodyTimestamp: number,
  timestampHeader: string | null | undefined
) {
  return String(bodyTimestamp) === timestampHeader;
}
