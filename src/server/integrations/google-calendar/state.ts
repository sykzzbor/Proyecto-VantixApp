import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { OAUTH_STATE_TTL_MS } from "@/server/integrations/google-calendar/config";

/**
 * State OAuth de un solo uso (protección CSRF y anti-replay del callback).
 * En la base se guarda SOLO el hash SHA-256 del state: un volcado de la tabla
 * no permite forjar callbacks válidos.
 */

export function hashOAuthState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/**
 * Decisión pura de consumo (testeable sin base de datos): el state es válido
 * una única vez, dentro de su ventana, y para la organización de la sesión.
 */
export function resolveStateConsumption(input: {
  record: {
    organizationId: string;
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null;
  sessionOrganizationId: string;
  now?: Date;
}):
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "org_mismatch" } {
  const now = input.now ?? new Date();
  if (!input.record) return { ok: false, reason: "not_found" };
  if (input.record.usedAt) return { ok: false, reason: "already_used" };
  if (input.record.expiresAt <= now) return { ok: false, reason: "expired" };
  if (input.record.organizationId !== input.sessionOrganizationId) {
    return { ok: false, reason: "org_mismatch" };
  }
  return { ok: true };
}

export type StateStore = {
  create: (data: {
    organizationId: string;
    userId: string;
    stateHash: string;
    expiresAt: Date;
  }) => Promise<void>;
  find: (stateHash: string) => Promise<{
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null>;
  /** Marca como usado de forma atómica; devuelve cuántas filas cambió. */
  markUsed: (id: string, now: Date) => Promise<number>;
};

const defaultStore: StateStore = {
  create: async (data) => {
    await prisma.googleOAuthState.create({ data });
  },
  find: (stateHash) =>
    prisma.googleOAuthState.findUnique({
      where: { stateHash },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        expiresAt: true,
        usedAt: true,
      },
    }),
  markUsed: async (id, now) => {
    const updated = await prisma.googleOAuthState.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    });
    return updated.count;
  },
};

/** Genera y persiste un state nuevo; devuelve el valor crudo para la URL. */
export async function createGoogleOAuthState(
  input: { organizationId: string; userId: string },
  store: StateStore = defaultStore
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await store.create({
    organizationId: input.organizationId,
    userId: input.userId,
    stateHash: hashOAuthState(state),
    expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
  });
  return state;
}

/**
 * Consume el state: única vez, no vencido y de la organización de la sesión.
 * El doble callback pierde la carrera en `markUsed` (update atómico).
 */
export async function consumeGoogleOAuthState(
  input: { state: string; sessionOrganizationId: string; now?: Date },
  store: StateStore = defaultStore
): Promise<
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; reason: "not_found" | "expired" | "already_used" | "org_mismatch" }
> {
  const now = input.now ?? new Date();
  const record = await store.find(hashOAuthState(input.state));
  const decision = resolveStateConsumption({
    record,
    sessionOrganizationId: input.sessionOrganizationId,
    now,
  });
  if (!decision.ok) return decision;
  const marked = await store.markUsed(record!.id, now);
  if (marked !== 1) return { ok: false, reason: "already_used" };
  return { ok: true, organizationId: record!.organizationId, userId: record!.userId };
}
