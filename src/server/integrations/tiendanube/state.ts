import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { TIENDANUBE_OAUTH_STATE_TTL_MS } from "@/server/integrations/tiendanube/config";

export function hashTiendanubeState(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export type TiendanubeStateStore = {
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

const defaultStore: TiendanubeStateStore = {
  async create(data) {
    await prisma.tiendanubeOAuthState.create({ data });
  },
  find(stateHash) {
    return prisma.tiendanubeOAuthState.findUnique({
      where: { stateHash },
      select: { id: true, organizationId: true, userId: true, expiresAt: true, usedAt: true },
    });
  },
  async markUsed(id, now) {
    return (await prisma.tiendanubeOAuthState.updateMany({
      where: { id, usedAt: null },
      data: { usedAt: now },
    })).count;
  },
};

export async function createTiendanubeOAuthState(
  input: { organizationId: string; userId: string },
  store: TiendanubeStateStore = defaultStore
): Promise<string> {
  const state = randomBytes(32).toString("base64url");
  await store.create({
    ...input,
    stateHash: hashTiendanubeState(state),
    expiresAt: new Date(Date.now() + TIENDANUBE_OAUTH_STATE_TTL_MS),
  });
  return state;
}

export async function consumeTiendanubeOAuthState(
  input: { state: string; organizationId: string; userId: string; now?: Date },
  store: TiendanubeStateStore = defaultStore
): Promise<{ ok: true; organizationId: string } | { ok: false }> {
  const now = input.now ?? new Date();
  const found = await store.find(hashTiendanubeState(input.state));
  if (
    !found ||
    found.usedAt ||
    found.expiresAt <= now ||
    found.organizationId !== input.organizationId ||
    found.userId !== input.userId
  ) {
    return { ok: false };
  }
  if (await store.markUsed(found.id, now) !== 1) return { ok: false };
  return { ok: true, organizationId: found.organizationId };
}
