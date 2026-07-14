import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getMaxAttempts } from "@/server/automation/config";
import {
  AUTOMATION_SCHEMA_VERSION,
  MAX_PAYLOAD_BYTES,
  isAutomationEventType,
} from "@/server/automation/constants";
import type {
  AutomationEventInput,
  EmitErrorCode,
  EmitResult,
} from "@/server/automation/types";

/**
 * Validación pura del input de un evento. Separada para poder testearla sin DB.
 */
export function validateEmitInput(input: AutomationEventInput):
  | { ok: true; type: string; payload: Record<string, unknown>; idempotencyKey: string }
  | { ok: false; code: EmitErrorCode; error: string } {
  const type = input.type?.trim();
  if (!type || !isAutomationEventType(type)) {
    return { ok: false, code: "invalid_type", error: "Tipo de evento no admitido." };
  }

  const payload = input.payload ?? {};
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, code: "invalid_payload", error: "El payload debe ser un objeto." };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    return { ok: false, code: "invalid_payload", error: "El payload no es serializable." };
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_PAYLOAD_BYTES) {
    return { ok: false, code: "payload_too_large", error: "El payload es demasiado grande." };
  }

  const idempotencyKey = (input.idempotencyKey?.trim() || `${type}:${randomUUID()}`).slice(
    0,
    200
  );
  return { ok: true, type, payload, idempotencyKey };
}

export type EmitDeps = {
  organizationExists: (organizationId: string) => Promise<boolean>;
  findByIdempotencyKey: (
    organizationId: string,
    idempotencyKey: string
  ) => Promise<{ id: string } | null>;
  createEvent: (data: {
    organizationId: string;
    type: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    maxAttempts: number;
  }) => Promise<{ id: string }>;
  maxAttempts: number;
};

function defaultDeps(): EmitDeps {
  return {
    organizationExists: async (organizationId) =>
      (await prisma.organization.count({ where: { id: organizationId } })) > 0,
    findByIdempotencyKey: (organizationId, idempotencyKey) =>
      prisma.automationEvent.findUnique({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey } },
        select: { id: true },
      }),
    createEvent: (data) =>
      prisma.automationEvent.create({
        data: {
          organizationId: data.organizationId,
          type: data.type,
          payload: data.payload as Prisma.InputJsonValue,
          schemaVersion: AUTOMATION_SCHEMA_VERSION,
          status: "PENDING",
          idempotencyKey: data.idempotencyKey,
          attempts: 0,
          maxAttempts: data.maxAttempts,
          nextAttemptAt: new Date(),
        },
        select: { id: true },
      }),
    maxAttempts: getMaxAttempts(),
  };
}

/**
 * Emite un evento de automatización: valida, deduplica por idempotencia y lo
 * persiste ANTES de cualquier envío. NUNCA lanza hacia el llamador: devuelve un
 * resultado para no bloquear conversaciones, WhatsApp ni respuestas de Claude.
 */
export async function emitAutomationEvent(
  input: AutomationEventInput,
  overrides: Partial<EmitDeps> = {}
): Promise<EmitResult> {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    const validated = validateEmitInput(input);
    if (!validated.ok) return { ok: false, error: validated.error, code: validated.code };

    if (!(await deps.organizationExists(input.organizationId))) {
      return {
        ok: false,
        error: "La organización no existe.",
        code: "organization_not_found",
      };
    }

    const existing = await deps.findByIdempotencyKey(
      input.organizationId,
      validated.idempotencyKey
    );
    if (existing) return { ok: true, eventId: existing.id, duplicate: true };

    try {
      const created = await deps.createEvent({
        organizationId: input.organizationId,
        type: validated.type,
        payload: validated.payload,
        idempotencyKey: validated.idempotencyKey,
        maxAttempts: deps.maxAttempts,
      });
      return { ok: true, eventId: created.id, duplicate: false };
    } catch (error) {
      // Carrera: otro proceso creó el mismo (organizationId, idempotencyKey).
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const dup = await deps.findByIdempotencyKey(
          input.organizationId,
          validated.idempotencyKey
        );
        if (dup) return { ok: true, eventId: dup.id, duplicate: true };
      }
      throw error;
    }
  } catch (error) {
    console.error(
      "[VantixApp] emitAutomationEvent falló:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return {
      ok: false,
      error: "No se pudo registrar el evento de automatización.",
      code: "internal_error",
    };
  }
}
