import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { ycloudConnectionSchema } from "@/lib/validations/whatsapp";
import { prisma } from "@/lib/prisma";
import { isSerializableTransactionConflict } from "@/lib/prisma-errors";
import { recordAudit } from "@/server/audit";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";
import { checkRateLimit } from "@/server/rate-limit";
import {
  CredentialsEncryptionError,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";
import {
  resolveYCloudWhatsappAsset,
  YCloudApiError,
  type YCloudWhatsappAsset,
} from "@/server/whatsapp/ycloud-client";

const CONNECTION_LIMIT = 5;
const CONNECTION_WINDOW_MS = 60_000;
const SERIALIZABLE_RETRIES = 3;

export type YCloudConnectionErrorCode =
  | "invalid_input"
  | "rate_limited"
  | "ycloud_authentication"
  | "ycloud_number_not_found"
  | "ycloud_number_not_operational"
  | "ycloud_unavailable"
  | "number_already_connected"
  | "credentials_unavailable"
  | "connection_unavailable";

export class YCloudConnectionError extends Error {
  constructor(
    readonly code: YCloudConnectionErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "YCloudConnectionError";
  }
}

type YCloudConnectionDependencies = {
  resolveAsset: typeof resolveYCloudWhatsappAsset;
  encryptApiKey: typeof encryptAccessToken;
  now: () => Date;
  enforceRateLimit: (organizationId: string, userId: string) => void;
  audit: typeof recordAudit;
};

function enforceConnectionRateLimit(organizationId: string, userId: string) {
  const rate = checkRateLimit(
    `whatsapp-ycloud-connection:${organizationId}:${userId}`,
    CONNECTION_LIMIT,
    CONNECTION_WINDOW_MS
  );
  if (!rate.allowed) {
    throw new YCloudConnectionError(
      "rate_limited",
      `Hiciste demasiados intentos seguidos. Esperá ${rate.retryAfterSeconds} segundos.`,
      429
    );
  }
}

const defaultDependencies: YCloudConnectionDependencies = {
  resolveAsset: resolveYCloudWhatsappAsset,
  encryptApiKey: encryptAccessToken,
  now: () => new Date(),
  enforceRateLimit: enforceConnectionRateLimit,
  audit: recordAudit,
};

export function toYCloudConnectionError(error: unknown): YCloudConnectionError {
  if (error instanceof YCloudConnectionError) return error;
  if (error instanceof YCloudApiError) {
    if (error.code === "authentication") {
      return new YCloudConnectionError(
        "ycloud_authentication",
        error.safeMessage,
        422
      );
    }
    if (error.code === "number_not_found") {
      return new YCloudConnectionError(
        "ycloud_number_not_found",
        error.safeMessage,
        422
      );
    }
    if (error.code === "number_not_operational") {
      return new YCloudConnectionError(
        "ycloud_number_not_operational",
        error.safeMessage,
        409
      );
    }
    if (error.retryable || error.code === "timeout" || error.code === "network_error") {
      return new YCloudConnectionError(
        "ycloud_unavailable",
        error.safeMessage,
        503
      );
    }
  }
  if (error instanceof CredentialsEncryptionError) {
    return new YCloudConnectionError(
      "credentials_unavailable",
      "No se pudo guardar la API key de forma segura.",
      500
    );
  }
  return new YCloudConnectionError(
    "connection_unavailable",
    "No se pudo completar la conexión con YCloud.",
    500
  );
}

async function persistYCloudConnection(input: {
  organizationId: string;
  encryptedApiKey: string;
  asset: YCloudWhatsappAsset;
  now: Date;
}) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const matching = await tx.whatsappIntegration.findMany({
            where: {
              OR: [
                { phoneNumberId: input.asset.phoneNumberId },
                { providerPhoneNumber: input.asset.phoneNumber },
              ],
            },
            take: 3,
            select: {
              id: true,
              organizationId: true,
              provider: true,
              connectedAt: true,
              webhookSubscribedAt: true,
              lastWebhookAt: true,
            },
          });
          if (
            matching.some(
              (item) => item.organizationId !== input.organizationId
            )
          ) {
            throw new YCloudConnectionError(
              "number_already_connected",
              "Ese número ya está vinculado a otra organización.",
              409
            );
          }
          if (matching.length > 1) {
            throw new YCloudConnectionError(
              "connection_unavailable",
              "La conexión existente requiere revisión antes de continuar.",
              409
            );
          }
          const existing = matching[0];
          const preserveYCloudTelemetry = existing?.provider === "YCLOUD";
          const data = {
            wabaId: input.asset.wabaId,
            phoneNumberId: input.asset.phoneNumberId,
            providerPhoneNumber: input.asset.phoneNumber,
            displayPhoneNumber: input.asset.displayPhoneNumber,
            verifiedName: input.asset.verifiedName,
            encryptedAccessToken: input.encryptedApiKey,
            provider: "YCLOUD" as const,
            connectionMethod: "COEXISTENCE" as const,
            status: "CONNECTED" as const,
            businessId: null,
            tokenExpiresAt: null,
            grantedScopes: [],
            connectedAt: existing?.connectedAt ?? input.now,
            lastSyncedAt: input.now,
            webhookSubscribedAt: preserveYCloudTelemetry
              ? existing.webhookSubscribedAt
              : null,
            lastWebhookAt: preserveYCloudTelemetry
              ? existing.lastWebhookAt
              : null,
            lastErrorCode: null,
            lastError: null,
          };
          const saved = existing
            ? await tx.whatsappIntegration.update({
                where: { id: existing.id },
                data,
                select: { id: true },
              })
            : await tx.whatsappIntegration.create({
                data: { organizationId: input.organizationId, ...data },
                select: { id: true },
              });

          const previous = await tx.whatsappIntegration.findMany({
            where: {
              organizationId: input.organizationId,
              id: { not: saved.id },
              status: { not: "DISCONNECTED" },
            },
            select: { id: true },
          });
          if (previous.length > 0) {
            await tx.whatsappIntegration.updateMany({
              where: {
                organizationId: input.organizationId,
                id: { in: previous.map(({ id }) => id) },
              },
              data: { status: "DISCONNECTED" },
            });
            for (const item of previous) {
              await cancelPendingFollowUpsTx(tx, {
                organizationId: input.organizationId,
                integrationId: item.id,
                reason: "integration_disabled",
                now: input.now,
              });
            }
          }
          return saved.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (error instanceof YCloudConnectionError) throw error;
      if (
        isSerializableTransactionConflict(error) &&
        attempt < SERIALIZABLE_RETRIES - 1
      ) {
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new YCloudConnectionError(
          "number_already_connected",
          "Ese número ya está vinculado a otra organización.",
          409
        );
      }
      throw error;
    }
  }
  throw new YCloudConnectionError(
    "connection_unavailable",
    "No se pudo completar la conexión con YCloud.",
    500
  );
}

const inFlightConnections = new Map<string, Promise<{ integrationId: string }>>();

function inFlightKey(input: {
  organizationId: string;
  phoneNumber: string;
  apiKey: string;
}) {
  const fingerprint = createHash("sha256")
    .update(input.phoneNumber, "utf8")
    .update("\0")
    .update(input.apiKey, "utf8")
    .digest("hex");
  return `${input.organizationId}:${fingerprint}`;
}

export async function connectYCloudWhatsapp(
  input: {
    organizationId: string;
    userId: string;
    apiKey: string;
    phoneNumber: string;
  },
  overrides: Partial<YCloudConnectionDependencies> = {}
): Promise<{ integrationId: string }> {
  const parsed = ycloudConnectionSchema.safeParse({
    apiKey: input.apiKey,
    phoneNumber: input.phoneNumber,
  });
  if (!parsed.success) {
    throw new YCloudConnectionError(
      "invalid_input",
      "Los datos de conexión con YCloud no son válidos.",
      400
    );
  }
  const dependencies = { ...defaultDependencies, ...overrides };
  const key = inFlightKey({ organizationId: input.organizationId, ...parsed.data });
  const existing = inFlightConnections.get(key);
  if (existing) return existing;

  const operation = (async () => {
    try {
      dependencies.enforceRateLimit(input.organizationId, input.userId);
      const asset = await dependencies.resolveAsset(parsed.data);
      const encryptedApiKey = dependencies.encryptApiKey(parsed.data.apiKey);
      const integrationId = await persistYCloudConnection({
        organizationId: input.organizationId,
        encryptedApiKey,
        asset,
        now: dependencies.now(),
      });
      await dependencies.audit({
        organizationId: input.organizationId,
        userId: input.userId,
        action: "whatsapp.ycloud_connected",
        entityType: "whatsapp_integration",
        entityId: integrationId,
        details: { provider: "YCLOUD", method: "COEXISTENCE", result: "ok" },
      });
      return { integrationId };
    } catch (error) {
      const failure = toYCloudConnectionError(error);
      await dependencies.audit({
        organizationId: input.organizationId,
        userId: input.userId,
        action: "whatsapp.ycloud_connection_failed",
        entityType: "whatsapp_integration",
        details: {
          provider: "YCLOUD",
          method: "COEXISTENCE",
          result: "error",
          code: failure.code,
        },
      });
      throw failure;
    }
  })();

  inFlightConnections.set(key, operation);
  try {
    return await operation;
  } finally {
    if (inFlightConnections.get(key) === operation) {
      inFlightConnections.delete(key);
    }
  }
}
