import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { whatsappIntegrationConfigSchema } from "@/lib/validations/whatsapp";
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
  inspectMetaEmbeddedSignupToken,
  isMetaAppSubscribedToWaba,
  MetaApiError,
  resolveMetaManualWhatsappAsset,
  subscribeMetaAppToWaba,
  type MetaEmbeddedSignupAsset,
  type MetaEmbeddedSignupGrant,
} from "@/server/whatsapp/meta-client";

const MANUAL_CONNECTION_LIMIT = 5;
const MANUAL_CONNECTION_WINDOW_MS = 60_000;
const SERIALIZABLE_RETRIES = 3;

export type ManualWhatsappConnectionErrorCode =
  | "invalid_input"
  | "rate_limited"
  | "meta_authentication"
  | "meta_rejected"
  | "meta_unavailable"
  | "waba_not_authorized"
  | "asset_mismatch"
  | "webhook_pending"
  | "number_already_connected"
  | "credentials_unavailable"
  | "connection_unavailable";

export class ManualWhatsappConnectionError extends Error {
  constructor(
    readonly code: ManualWhatsappConnectionErrorCode,
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ManualWhatsappConnectionError";
  }
}

type ManualMetaDependencies = {
  inspectToken: typeof inspectMetaEmbeddedSignupToken;
  resolveAsset: typeof resolveMetaManualWhatsappAsset;
  subscribeWaba: typeof subscribeMetaAppToWaba;
  isSubscribed: typeof isMetaAppSubscribedToWaba;
};

type ManualConnectionDependencies = ManualMetaDependencies & {
  encryptToken: typeof encryptAccessToken;
  now: () => Date;
  enforceRateLimit: (organizationId: string, userId: string) => void;
  audit: typeof recordAudit;
};

const defaultMetaDependencies: ManualMetaDependencies = {
  inspectToken: inspectMetaEmbeddedSignupToken,
  resolveAsset: resolveMetaManualWhatsappAsset,
  subscribeWaba: subscribeMetaAppToWaba,
  isSubscribed: isMetaAppSubscribedToWaba,
};

function enforceManualConnectionRateLimit(
  organizationId: string,
  userId: string
) {
  const rate = checkRateLimit(
    `whatsapp-manual-connection:${organizationId}:${userId}`,
    MANUAL_CONNECTION_LIMIT,
    MANUAL_CONNECTION_WINDOW_MS
  );
  if (!rate.allowed) {
    throw new ManualWhatsappConnectionError(
      "rate_limited",
      `Hiciste demasiados intentos seguidos. Esperá ${rate.retryAfterSeconds} segundos.`,
      429
    );
  }
}

const defaultDependencies: ManualConnectionDependencies = {
  ...defaultMetaDependencies,
  encryptToken: encryptAccessToken,
  now: () => new Date(),
  enforceRateLimit: enforceManualConnectionRateLimit,
  audit: recordAudit,
};

export type ValidatedManualWhatsappConnection = {
  grant: MetaEmbeddedSignupGrant;
  asset: MetaEmbeddedSignupAsset;
};

export async function validateManualWhatsappConnectionAgainstMeta(
  input: {
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
  },
  overrides: Partial<ManualMetaDependencies> = {}
): Promise<ValidatedManualWhatsappConnection> {
  const dependencies = { ...defaultMetaDependencies, ...overrides };
  const grant = await dependencies.inspectToken(input.accessToken);
  if (!grant.wabaIds.includes(input.wabaId)) {
    throw new ManualWhatsappConnectionError(
      "waba_not_authorized",
      "El token no tiene acceso a la WABA indicada.",
      422
    );
  }

  const asset = await dependencies.resolveAsset(input);
  if (
    asset.wabaId !== input.wabaId ||
    asset.phoneNumberId !== input.phoneNumberId
  ) {
    throw new ManualWhatsappConnectionError(
      "asset_mismatch",
      "El Phone Number ID no pertenece a la WABA indicada.",
      422
    );
  }

  await dependencies.subscribeWaba({
    accessToken: input.accessToken,
    wabaId: input.wabaId,
  });
  const subscribed = await dependencies.isSubscribed({
    accessToken: input.accessToken,
    wabaId: input.wabaId,
  });
  if (!subscribed) {
    throw new ManualWhatsappConnectionError(
      "webhook_pending",
      "Meta no confirmó la suscripción del webhook. Volvé a intentarlo.",
      409
    );
  }

  return { grant, asset };
}

export function toManualWhatsappConnectionError(
  error: unknown
): ManualWhatsappConnectionError {
  if (error instanceof ManualWhatsappConnectionError) return error;
  if (error instanceof MetaApiError) {
    const unavailable =
      error.retryable ||
      error.code === "timeout" ||
      error.code === "network_error" ||
      error.code === "meta_unavailable";
    const authentication = error.code === "authentication";
    return new ManualWhatsappConnectionError(
      authentication
        ? "meta_authentication"
        : unavailable
          ? "meta_unavailable"
          : "meta_rejected",
      error.safeMessage,
      authentication ? 422 : unavailable ? 503 : 422
    );
  }
  if (error instanceof CredentialsEncryptionError) {
    return new ManualWhatsappConnectionError(
      "credentials_unavailable",
      "No se pudo guardar la credencial de WhatsApp de forma segura.",
      500
    );
  }
  return new ManualWhatsappConnectionError(
    "connection_unavailable",
    "No se pudo completar la conexión manual con WhatsApp.",
    500
  );
}

async function persistManualWhatsappConnection(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  encryptedAccessToken: string;
  validation: ValidatedManualWhatsappConnection;
  now: Date;
}): Promise<string> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const matchingNumber = await tx.whatsappIntegration.findUnique({
            where: { phoneNumberId: input.phoneNumberId },
            select: {
              id: true,
              organizationId: true,
              provider: true,
              connectedAt: true,
            },
          });
          if (matchingNumber && matchingNumber.organizationId !== input.organizationId) {
            throw new ManualWhatsappConnectionError(
              "number_already_connected",
              "Ese Phone Number ID ya está vinculado a otra organización.",
              409
            );
          }

          const integrationData = {
            wabaId: input.wabaId,
            phoneNumberId: input.phoneNumberId,
            displayPhoneNumber: input.validation.asset.displayPhoneNumber,
            verifiedName: input.validation.asset.verifiedName,
            encryptedAccessToken: input.encryptedAccessToken,
            provider: "META_CLOUD" as const,
            providerPhoneNumber: null,
            connectionMethod: "MANUAL" as const,
            businessId: input.validation.asset.businessId,
            tokenExpiresAt: input.validation.grant.expiresAt,
            grantedScopes: input.validation.grant.scopes,
            lastSyncedAt: input.now,
            webhookSubscribedAt: input.now,
            lastWebhookAt:
              matchingNumber?.provider === "META_CLOUD" ? undefined : null,
            status: "CONNECTED" as const,
            connectedAt: matchingNumber?.connectedAt ?? input.now,
            lastErrorCode: null,
            lastError: null,
          };
          const saved = matchingNumber
            ? await tx.whatsappIntegration.update({
                where: { id: matchingNumber.id },
                data: integrationData,
                select: { id: true },
              })
            : await tx.whatsappIntegration.create({
                data: { organizationId: input.organizationId, ...integrationData },
                select: { id: true },
              });

          const previousConnections = await tx.whatsappIntegration.findMany({
            where: {
              organizationId: input.organizationId,
              id: { not: saved.id },
              status: { not: "DISCONNECTED" },
            },
            select: { id: true },
          });
          if (previousConnections.length > 0) {
            await tx.whatsappIntegration.updateMany({
              where: {
                organizationId: input.organizationId,
                id: { in: previousConnections.map(({ id }) => id) },
              },
              data: { status: "DISCONNECTED" },
            });
            for (const previous of previousConnections) {
              await cancelPendingFollowUpsTx(tx, {
                organizationId: input.organizationId,
                integrationId: previous.id,
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
      if (error instanceof ManualWhatsappConnectionError) throw error;
      if (isSerializableTransactionConflict(error) && attempt < SERIALIZABLE_RETRIES - 1) {
        continue;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await prisma.whatsappIntegration.findUnique({
          where: { phoneNumberId: input.phoneNumberId },
          select: { organizationId: true },
        });
        if (
          existing?.organizationId === input.organizationId &&
          attempt < SERIALIZABLE_RETRIES - 1
        ) {
          continue;
        }
        throw new ManualWhatsappConnectionError(
          "number_already_connected",
          "Ese Phone Number ID ya está vinculado a otra organización.",
          409
        );
      }
      throw error;
    }
  }
  throw new ManualWhatsappConnectionError(
    "connection_unavailable",
    "No se pudo completar la conexión manual con WhatsApp.",
    500
  );
}

const inFlightConnections = new Map<string, Promise<{ integrationId: string }>>();

function inFlightKey(input: {
  organizationId: string;
  wabaId: string;
  phoneNumberId: string;
  accessToken: string;
}) {
  const fingerprint = createHash("sha256")
    .update(input.wabaId, "utf8")
    .update("\0")
    .update(input.phoneNumberId, "utf8")
    .update("\0")
    .update(input.accessToken, "utf8")
    .digest("hex");
  return `${input.organizationId}:${fingerprint}`;
}

export async function connectManualWhatsapp(
  input: {
    organizationId: string;
    userId: string;
    wabaId: string;
    phoneNumberId: string;
    accessToken: string;
  },
  overrides: Partial<ManualConnectionDependencies> = {}
): Promise<{ integrationId: string }> {
  const parsed = whatsappIntegrationConfigSchema.safeParse({
    wabaId: input.wabaId,
    phoneNumberId: input.phoneNumberId,
    accessToken: input.accessToken,
  });
  if (!parsed.success) {
    throw new ManualWhatsappConnectionError(
      "invalid_input",
      "Los datos de conexión manual no son válidos.",
      400
    );
  }
  const dependencies = { ...defaultDependencies, ...overrides };
  const key = inFlightKey({
    organizationId: input.organizationId,
    ...parsed.data,
  });
  const existing = inFlightConnections.get(key);
  if (existing) return existing;

  const operation = (async () => {
    try {
      dependencies.enforceRateLimit(input.organizationId, input.userId);
      const validation = await validateManualWhatsappConnectionAgainstMeta(
        parsed.data,
        dependencies
      );
      const encryptedAccessToken = dependencies.encryptToken(
        parsed.data.accessToken
      );
      const now = dependencies.now();
      const integrationId = await persistManualWhatsappConnection({
        organizationId: input.organizationId,
        wabaId: parsed.data.wabaId,
        phoneNumberId: parsed.data.phoneNumberId,
        encryptedAccessToken,
        validation,
        now,
      });
      await dependencies.audit({
        organizationId: input.organizationId,
        userId: input.userId,
        action: "whatsapp.manual_connected",
        entityType: "whatsapp_integration",
        entityId: integrationId,
        details: { method: "MANUAL", result: "ok" },
      });
      return { integrationId };
    } catch (error) {
      const failure = toManualWhatsappConnectionError(error);
      await dependencies.audit({
        organizationId: input.organizationId,
        userId: input.userId,
        action: "whatsapp.manual_connection_failed",
        entityType: "whatsapp_integration",
        details: { method: "MANUAL", result: "error", code: failure.code },
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
