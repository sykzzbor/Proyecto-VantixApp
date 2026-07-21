import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { GOOGLE_SHEETS_OAUTH_STATE_TTL_MS } from "@/server/integrations/google-sheets/config";

export function hashGoogleSheetsState(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

export type GoogleSheetsStateStore = {
  create(data: { organizationId: string; userId: string; stateHash: string; expiresAt: Date }): Promise<void>;
  find(stateHash: string): Promise<{
    id: string;
    organizationId: string;
    userId: string;
    expiresAt: Date;
    usedAt: Date | null;
  } | null>;
  markUsed(id: string, now: Date): Promise<number>;
};

const defaultStore: GoogleSheetsStateStore = {
  async create(data) { await prisma.googleSheetsOAuthState.create({ data }); },
  find(stateHash) {
    return prisma.googleSheetsOAuthState.findUnique({
      where: { stateHash },
      select: { id: true, organizationId: true, userId: true, expiresAt: true, usedAt: true },
    });
  },
  async markUsed(id, now) {
    return (await prisma.googleSheetsOAuthState.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    })).count;
  },
};

export async function createGoogleSheetsOAuthState(
  input: { organizationId: string; userId: string },
  store: GoogleSheetsStateStore = defaultStore
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await store.create({
    ...input,
    stateHash: hashGoogleSheetsState(state),
    expiresAt: new Date(Date.now() + GOOGLE_SHEETS_OAUTH_STATE_TTL_MS),
  });
  return state;
}

export async function consumeGoogleSheetsOAuthState(
  input: { state: string; organizationId: string; userId: string; now?: Date },
  store: GoogleSheetsStateStore = defaultStore
): Promise<{ ok: true; organizationId: string } | { ok: false }> {
  const now = input.now ?? new Date();
  const record = await store.find(hashGoogleSheetsState(input.state));
  if (
    !record ||
    record.usedAt ||
    record.expiresAt <= now ||
    record.organizationId !== input.organizationId ||
    record.userId !== input.userId
  ) return { ok: false };
  if (await store.markUsed(record.id, now) !== 1) return { ok: false };
  return { ok: true, organizationId: record.organizationId };
}
