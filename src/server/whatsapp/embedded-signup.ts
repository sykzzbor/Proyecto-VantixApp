import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";
import {
  getMetaEmbeddedSignupPublicConfiguration,
} from "@/server/whatsapp/config";
import {
  CredentialsEncryptionError,
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";
import { resolveCurrentWhatsappIntegration } from "@/server/whatsapp/current-integration";
import {
  exchangeMetaEmbeddedSignupCode,
  inspectMetaEmbeddedSignupToken,
  isMetaAppSubscribedToWaba,
  MetaApiError,
  resolveMetaEmbeddedSignupAsset,
  subscribeMetaAppToWaba,
  testWhatsappConnection,
} from "@/server/whatsapp/meta-client";
import {
  resolveYCloudWhatsappAsset,
  YCloudApiError,
} from "@/server/whatsapp/ycloud-client";

export const EMBEDDED_SIGNUP_COOKIE = "vantix_whatsapp_signup";
export const EMBEDDED_SIGNUP_MAX_BODY_BYTES = 8 * 1024;
const ATTEMPT_TTL_MS = 10 * 60_000;

export type WhatsappEmbeddedSignupErrorCode =
  | "configuration_pending"
  | "signup_in_progress"
  | "invalid_signup_state"
  | "invalid_code"
  | "permissions_pending"
  | "asset_ambiguous"
  | "number_already_connected"
  | "not_connected"
  | "connection_unavailable"
  | "webhook_pending";

export class WhatsappEmbeddedSignupError extends Error {
  readonly code: WhatsappEmbeddedSignupErrorCode;
  readonly status: 400 | 409 | 503;

  constructor(
    code: WhatsappEmbeddedSignupErrorCode,
    message: string,
    status: 400 | 409 | 503 = 409
  ) {
    super(message);
    this.name = "WhatsappEmbeddedSignupError";
    this.code = code;
    this.status = status;
  }
}

export type SafeWhatsappIntegrationView = {
  status:
    | "connecting"
    | "connected"
    | "action_required"
    | "disconnected"
    | "error";
  provider: "META_CLOUD" | "YCLOUD";
  connectionMethod: "MANUAL" | "EMBEDDED_SIGNUP" | "COEXISTENCE";
  maskedPhoneNumber: string;
  verifiedName: string;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
};

export type SafeWhatsappConnectionStatus = {
  integration: SafeWhatsappIntegrationView | null;
  attemptState: "awaiting_code" | "processing" | "failed" | null;
  connectionState: "none" | "current" | "ambiguous";
};

type EmbeddedDependencies = {
  exchangeCode: typeof exchangeMetaEmbeddedSignupCode;
  inspectToken: typeof inspectMetaEmbeddedSignupToken;
  resolveAsset: typeof resolveMetaEmbeddedSignupAsset;
  subscribeWaba: typeof subscribeMetaAppToWaba;
  isSubscribed: typeof isMetaAppSubscribedToWaba;
  testConnection: typeof testWhatsappConnection;
  resolveYCloudAsset: typeof resolveYCloudWhatsappAsset;
  encryptToken: typeof encryptAccessToken;
  decryptToken: typeof decryptAccessToken;
  now: () => Date;
};

const defaultDependencies: EmbeddedDependencies = {
  exchangeCode: exchangeMetaEmbeddedSignupCode,
  inspectToken: inspectMetaEmbeddedSignupToken,
  resolveAsset: resolveMetaEmbeddedSignupAsset,
  subscribeWaba: subscribeMetaAppToWaba,
  isSubscribed: isMetaAppSubscribedToWaba,
  testConnection: testWhatsappConnection,
  resolveYCloudAsset: resolveYCloudWhatsappAsset,
  encryptToken: encryptAccessToken,
  decryptToken: decryptAccessToken,
  now: () => new Date(),
};

function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifySignupNonce(rawNonce: string, expectedHash: string): boolean {
  if (!rawNonce || rawNonce.length > 256 || !/^[A-Za-z0-9_-]+$/.test(rawNonce)) {
    return false;
  }
  return hashesEqual(hashSecret(rawNonce), expectedHash);
}

export function isSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function maskWhatsappPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `•••• ${digits.slice(-4)}`;
}

export function sanitizeWhatsappIntegrationError(value: string | null): string | null {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim().slice(0, 300);
  if (!compact) return null;
  if (
    /https?:\/\//i.test(compact) ||
    /bearer\s+/i.test(compact) ||
    /[A-Za-z0-9_-]{80,}/.test(compact)
  ) {
    return "La integración requiere revisión.";
  }
  return compact;
}

function safeView(input: {
  status:
    | "CONNECTING"
    | "CONNECTED"
    | "ACTION_REQUIRED"
    | "DISCONNECTED"
    | "ERROR";
  provider: "META_CLOUD" | "YCLOUD";
  connectionMethod: "MANUAL" | "EMBEDDED_SIGNUP" | "COEXISTENCE";
  displayPhoneNumber: string;
  verifiedName: string;
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  lastWebhookAt: Date | null;
  lastError: string | null;
}): SafeWhatsappIntegrationView {
  return {
    status: input.status.toLowerCase() as SafeWhatsappIntegrationView["status"],
    provider: input.provider,
    connectionMethod: input.connectionMethod,
    maskedPhoneNumber: maskWhatsappPhone(input.displayPhoneNumber),
    verifiedName: input.verifiedName,
    connectedAt: input.connectedAt?.toISOString() ?? null,
    lastSyncedAt: input.lastSyncedAt?.toISOString() ?? null,
    lastWebhookAt: input.lastWebhookAt?.toISOString() ?? null,
    lastError: sanitizeWhatsappIntegrationError(input.lastError),
  };
}

const SAFE_INTEGRATION_SELECT = {
  status: true,
  provider: true,
  connectionMethod: true,
  displayPhoneNumber: true,
  verifiedName: true,
  connectedAt: true,
  lastSyncedAt: true,
  lastWebhookAt: true,
  lastError: true,
} as const;

export async function getSafeWhatsappConnectionStatus(
  organizationId: string,
  now = new Date()
): Promise<SafeWhatsappConnectionStatus> {
  const [resolution, attempt] = await Promise.all([
    resolveCurrentWhatsappIntegration(organizationId),
    prisma.whatsappEmbeddedSignupAttempt.findUnique({
      where: { organizationId },
      select: { status: true, expiresAt: true },
    }),
  ]);
  const integration = resolution.state === "current"
    ? await prisma.whatsappIntegration.findFirst({
        where: { id: resolution.id, organizationId },
        select: SAFE_INTEGRATION_SELECT,
      })
    : null;
  const attemptState =
    !attempt || attempt.expiresAt <= now || attempt.status === "SUCCEEDED"
      ? null
      : attempt.status === "AWAITING_CODE"
        ? "awaiting_code"
        : attempt.status === "PROCESSING"
          ? "processing"
          : "failed";
  return {
    integration: integration ? safeView(integration) : null,
    attemptState,
    connectionState: resolution.state,
  };
}

export type StartEmbeddedSignupResult =
  | { state: "ready"; nonce: string | null }
  | { state: "in_progress" };

export async function startEmbeddedSignup(input: {
  organizationId: string;
  userId: string;
  currentNonce?: string | null;
  now?: Date;
}): Promise<StartEmbeddedSignupResult> {
  const configuration = getMetaEmbeddedSignupPublicConfiguration();
  if (!configuration.available) {
    throw new WhatsappEmbeddedSignupError(
      "configuration_pending",
      "La configuración de Meta todavía está pendiente."
    );
  }
  const now = input.now ?? new Date();
  const existing = await prisma.whatsappEmbeddedSignupAttempt.findUnique({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      userId: true,
      nonceHash: true,
      status: true,
      expiresAt: true,
      updatedAt: true,
    },
  });

  if (existing && existing.expiresAt > now) {
    const sameBrowser =
      existing.userId === input.userId &&
      !!input.currentNonce &&
      verifySignupNonce(input.currentNonce, existing.nonceHash);
    if (sameBrowser && existing.status === "AWAITING_CODE") {
      return { state: "ready", nonce: null };
    }
    if (existing.status === "AWAITING_CODE" || existing.status === "PROCESSING") {
      return { state: "in_progress" };
    }
  }

  const nonce = randomBytes(32).toString("base64url");
  const data = {
    userId: input.userId,
    nonceHash: hashSecret(nonce),
    codeHash: null,
    status: "AWAITING_CODE" as const,
    integrationId: null,
    lastErrorCode: null,
    expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS),
  };

  try {
    if (!existing) {
      await prisma.whatsappEmbeddedSignupAttempt.create({
        data: { organizationId: input.organizationId, ...data },
      });
    } else {
      const updated = await prisma.whatsappEmbeddedSignupAttempt.updateMany({
        where: { id: existing.id, updatedAt: existing.updatedAt },
        data,
      });
      if (updated.count !== 1) return { state: "in_progress" };
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { state: "in_progress" };
    }
    throw error;
  }
  return { state: "ready", nonce };
}

/**
 * Cierra un intento que todavía espera el código del popup. Es idempotente y
 * nunca interrumpe un intercambio que ya fue reclamado como PROCESSING.
 */
export async function cancelEmbeddedSignupAttempt(input: {
  organizationId: string;
  userId: string;
  nonce: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const cancelled = await prisma.whatsappEmbeddedSignupAttempt.updateMany({
    where: {
      organizationId: input.organizationId,
      userId: input.userId,
      nonceHash: hashSecret(input.nonce),
      status: "AWAITING_CODE",
    },
    data: {
      status: "FAILED",
      codeHash: null,
      lastErrorCode: "signup_cancelled",
      expiresAt: now,
    },
  });
  if (cancelled.count === 1) {
    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "whatsapp.embedded_signup_cancelled",
      entityType: "whatsapp_integration",
      details: { result: "cancelled" },
    });
  }
  return cancelled.count === 1;
}

function embeddedFailure(error: unknown): WhatsappEmbeddedSignupError {
  if (error instanceof WhatsappEmbeddedSignupError) return error;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new WhatsappEmbeddedSignupError(
      "number_already_connected",
      "Ese número ya está conectado a otra organización."
    );
  }
  if (error instanceof CredentialsEncryptionError) {
    return new WhatsappEmbeddedSignupError(
      "connection_unavailable",
      "No se pudo guardar la autorización de forma segura.",
      503
    );
  }
  if (error instanceof MetaApiError) {
    if (error.code === "authentication") {
      return new WhatsappEmbeddedSignupError(
        error.safeMessage.includes("permisos")
          ? "permissions_pending"
          : "invalid_code",
        error.safeMessage,
        400
      );
    }
    if (
      error.code === "invalid_response" &&
      (error.safeMessage.includes("más de un número") ||
        error.safeMessage.includes("cuenta de WhatsApp"))
    ) {
      return new WhatsappEmbeddedSignupError(
        "asset_ambiguous",
        error.safeMessage
      );
    }
    return new WhatsappEmbeddedSignupError(
      "connection_unavailable",
      error.safeMessage,
      error.retryable ? 503 : 400
    );
  }
  if (error instanceof YCloudApiError) {
    return new WhatsappEmbeddedSignupError(
      "connection_unavailable",
      error.safeMessage,
      error.retryable ? 503 : 400
    );
  }
  return new WhatsappEmbeddedSignupError(
    "connection_unavailable",
    "No se pudo completar la conexión con Meta.",
    503
  );
}

function earliestExpiry(...values: Array<Date | null>): Date | null {
  const dates = values.filter((value): value is Date => !!value);
  return dates.length
    ? new Date(Math.min(...dates.map((value) => value.getTime())))
    : null;
}

export type CompleteEmbeddedSignupResult =
  | { state: "processing" }
  | {
      state: "connected" | "already_connected";
      integration: SafeWhatsappIntegrationView;
    };

export async function completeEmbeddedSignup(
  input: {
    organizationId: string;
    userId: string;
    nonce: string;
    code: string;
  },
  overrides: Partial<EmbeddedDependencies> = {}
): Promise<CompleteEmbeddedSignupResult> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const now = dependencies.now();
  const codeHash = hashSecret(input.code);
  const attempt = await prisma.whatsappEmbeddedSignupAttempt.findUnique({
    where: { organizationId: input.organizationId },
    select: {
      id: true,
      userId: true,
      nonceHash: true,
      codeHash: true,
      status: true,
      integrationId: true,
      expiresAt: true,
    },
  });
  if (
    !attempt ||
    attempt.userId !== input.userId ||
    attempt.expiresAt <= now ||
    !verifySignupNonce(input.nonce, attempt.nonceHash)
  ) {
    throw new WhatsappEmbeddedSignupError(
      "invalid_signup_state",
      "La sesión de conexión venció o no es válida.",
      400
    );
  }
  if (attempt.status === "PROCESSING") {
    if (attempt.codeHash && hashesEqual(attempt.codeHash, codeHash)) {
      return { state: "processing" };
    }
    throw new WhatsappEmbeddedSignupError(
      "invalid_code",
      "Ese código temporal no se puede utilizar.",
      400
    );
  }
  if (attempt.status === "SUCCEEDED") {
    if (!attempt.codeHash || !hashesEqual(attempt.codeHash, codeHash)) {
      throw new WhatsappEmbeddedSignupError(
        "invalid_code",
        "Ese código temporal no se puede utilizar.",
        400
      );
    }
    const existing = attempt.integrationId
      ? await prisma.whatsappIntegration.findFirst({
          where: {
            id: attempt.integrationId,
            organizationId: input.organizationId,
          },
          select: SAFE_INTEGRATION_SELECT,
        })
      : null;
    if (!existing) {
      throw new WhatsappEmbeddedSignupError(
        "invalid_signup_state",
        "La conexión anterior ya no está disponible.",
        400
      );
    }
    return { state: "already_connected", integration: safeView(existing) };
  }
  if (attempt.status !== "AWAITING_CODE") {
    throw new WhatsappEmbeddedSignupError(
      "invalid_code",
      "Iniciá nuevamente la conexión con Meta.",
      400
    );
  }

  try {
    const claimed = await prisma.whatsappEmbeddedSignupAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: input.organizationId,
        userId: input.userId,
        nonceHash: attempt.nonceHash,
        status: "AWAITING_CODE",
        codeHash: null,
        expiresAt: { gt: now },
      },
      data: { status: "PROCESSING", codeHash, lastErrorCode: null },
    });
    if (claimed.count !== 1) {
      const concurrent = await prisma.whatsappEmbeddedSignupAttempt.findUnique({
        where: { organizationId: input.organizationId },
        select: { codeHash: true, status: true },
      });
      if (
        concurrent?.status === "PROCESSING" &&
        concurrent.codeHash &&
        hashesEqual(concurrent.codeHash, codeHash)
      ) {
        return { state: "processing" };
      }
      throw new WhatsappEmbeddedSignupError(
        "invalid_code",
        "Ese código temporal no se puede utilizar.",
        400
      );
    }
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new WhatsappEmbeddedSignupError(
        "invalid_code",
        "Ese código temporal ya fue utilizado.",
        400
      );
    }
    throw error;
  }

  try {
    const exchanged = await dependencies.exchangeCode(input.code);
    const grant = await dependencies.inspectToken(exchanged.accessToken);
    if (grant.wabaIds.length !== 1) {
      throw new WhatsappEmbeddedSignupError(
        "asset_ambiguous",
        grant.wabaIds.length === 0
          ? "Meta no informó una cuenta de WhatsApp autorizada."
          : "Meta autorizó más de una cuenta; elegí una conexión inequívoca."
      );
    }
    const asset = await dependencies.resolveAsset({
      accessToken: exchanged.accessToken,
      wabaId: grant.wabaIds[0]!,
    });
    await dependencies.subscribeWaba({
      accessToken: exchanged.accessToken,
      wabaId: asset.wabaId,
    });
    const encryptedAccessToken = dependencies.encryptToken(
      exchanged.accessToken
    );
    const tokenExpiresAt = earliestExpiry(
      exchanged.expiresAt,
      grant.expiresAt
    );

    const integration = await prisma.$transaction(
      async (tx) => {
        const conflicting = await tx.whatsappIntegration.findUnique({
          where: { phoneNumberId: asset.phoneNumberId },
          select: { id: true, organizationId: true },
        });
        if (conflicting && conflicting.organizationId !== input.organizationId) {
          throw new WhatsappEmbeddedSignupError(
            "number_already_connected",
            "Ese número ya está conectado a otra organización."
          );
        }
        const current = conflicting
          ? await tx.whatsappIntegration.findFirst({
              where: {
                id: conflicting.id,
                organizationId: input.organizationId,
              },
              select: { id: true, provider: true, connectedAt: true },
            })
          : null;
        const data = {
          wabaId: asset.wabaId,
          phoneNumberId: asset.phoneNumberId,
          displayPhoneNumber: asset.displayPhoneNumber,
          verifiedName: asset.verifiedName,
          encryptedAccessToken,
          provider: "META_CLOUD" as const,
          providerPhoneNumber: null,
          connectionMethod: "EMBEDDED_SIGNUP" as const,
          businessId: asset.businessId,
          tokenExpiresAt,
          grantedScopes: grant.scopes,
          status: "CONNECTED" as const,
          connectedAt: current?.connectedAt ?? now,
          lastSyncedAt: now,
          webhookSubscribedAt: now,
          lastWebhookAt:
            current?.provider === "META_CLOUD" ? undefined : null,
          lastErrorCode: null,
          lastError: null,
        };
        const saved = current
          ? await tx.whatsappIntegration.update({
              where: { id: current.id },
              data,
              select: { id: true, ...SAFE_INTEGRATION_SELECT },
            })
          : await tx.whatsappIntegration.create({
              data: { organizationId: input.organizationId, ...data },
              select: { id: true, ...SAFE_INTEGRATION_SELECT },
            });
        // Un número distinto obtiene su propia fila. Así las conversaciones
        // históricas conservan la integración y las credenciales con las que
        // fueron creadas; nunca se redirigen silenciosamente al número nuevo.
        const integrationsToDisable = await tx.whatsappIntegration.findMany({
          where: {
            organizationId: input.organizationId,
            id: { not: saved.id },
            status: { not: "DISCONNECTED" },
          },
          select: { id: true },
        });
        if (integrationsToDisable.length > 0) {
          await tx.whatsappIntegration.updateMany({
            where: {
              organizationId: input.organizationId,
              id: { in: integrationsToDisable.map(({ id }) => id) },
            },
            data: { status: "DISCONNECTED" },
          });
          for (const previous of integrationsToDisable) {
            await cancelPendingFollowUpsTx(tx, {
              organizationId: input.organizationId,
              integrationId: previous.id,
              reason: "integration_disabled",
              now,
            });
          }
        }
        const completed = await tx.whatsappEmbeddedSignupAttempt.updateMany({
          where: {
            id: attempt.id,
            organizationId: input.organizationId,
            status: "PROCESSING",
            codeHash,
          },
          data: {
            status: "SUCCEEDED",
            integrationId: saved.id,
            lastErrorCode: null,
          },
        });
        if (completed.count !== 1) {
          throw new WhatsappEmbeddedSignupError(
            "invalid_signup_state",
            "La sesión de conexión ya no está disponible.",
            400
          );
        }
        return saved;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "whatsapp.embedded_signup_connected",
      entityType: "whatsapp_integration",
      entityId: integration.id,
      details: { method: "EMBEDDED_SIGNUP", result: "ok" },
    });
    return { state: "connected", integration: safeView(integration) };
  } catch (error) {
    const failure = embeddedFailure(error);
    await prisma.whatsappEmbeddedSignupAttempt.updateMany({
      where: {
        id: attempt.id,
        organizationId: input.organizationId,
        status: "PROCESSING",
        codeHash,
      },
      data: { status: "FAILED", lastErrorCode: failure.code },
    });
    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "whatsapp.embedded_signup_failed",
      entityType: "whatsapp_integration",
      details: { result: "error", code: failure.code },
    });
    throw failure;
  }
}

async function getStoredIntegration(organizationId: string) {
  const resolution = await resolveCurrentWhatsappIntegration(organizationId);
  if (resolution.state === "ambiguous") {
    throw new WhatsappEmbeddedSignupError(
      "connection_unavailable",
      "La conexión de WhatsApp requiere revisión antes de continuar."
    );
  }
  if (resolution.state === "none") return null;
  return prisma.whatsappIntegration.findFirst({
    where: { id: resolution.id, organizationId },
    select: {
      id: true,
      organizationId: true,
      wabaId: true,
      phoneNumberId: true,
      businessId: true,
      encryptedAccessToken: true,
      provider: true,
      providerPhoneNumber: true,
      connectionMethod: true,
      status: true,
      connectedAt: true,
      lastSyncedAt: true,
    },
  });
}

function storedConfigurationSnapshot(
  integration: NonNullable<Awaited<ReturnType<typeof getStoredIntegration>>>
) {
  return {
    status: integration.status,
    phoneNumberId: integration.phoneNumberId,
    wabaId: integration.wabaId,
    connectionMethod: integration.connectionMethod,
    businessId: integration.businessId,
    encryptedAccessToken: integration.encryptedAccessToken,
    provider: integration.provider,
    providerPhoneNumber: integration.providerPhoneNumber,
    lastSyncedAt: integration.lastSyncedAt,
  };
}

async function verifyStoredConnection(
  integration: NonNullable<Awaited<ReturnType<typeof getStoredIntegration>>>,
  dependencies: EmbeddedDependencies,
  subscribe: boolean
) {
  const accessToken = dependencies.decryptToken(
    integration.encryptedAccessToken
  );
  if (integration.provider === "YCLOUD") {
    const phoneNumber =
      integration.providerPhoneNumber?.trim() || integration.phoneNumberId;
    const remote = await dependencies.resolveYCloudAsset({
      phoneNumber,
      apiKey: accessToken,
    });
    if (
      remote.phoneNumberId !== integration.phoneNumberId ||
      remote.wabaId !== integration.wabaId
    ) {
      throw new WhatsappEmbeddedSignupError(
        "connection_unavailable",
        "YCloud devolvió un canal distinto del conectado."
      );
    }
    return {
      accessToken,
      displayPhoneNumber: remote.displayPhoneNumber,
      verifiedName: remote.verifiedName,
      scopes: [] as string[],
      expiresAt: null as Date | null,
      webhookSubscribed: null as boolean | null,
    };
  }
  if (integration.connectionMethod === "MANUAL") {
    const remote = await dependencies.testConnection({
      phoneNumberId: integration.phoneNumberId,
      accessToken,
    });
    return {
      accessToken,
      displayPhoneNumber: remote.displayPhoneNumber,
      verifiedName: remote.verifiedName,
      scopes: [] as string[],
      expiresAt: null as Date | null,
      webhookSubscribed: null as boolean | null,
    };
  }

  const grant = await dependencies.inspectToken(accessToken);
  if (grant.wabaIds.length !== 1 || grant.wabaIds[0] !== integration.wabaId) {
    throw new WhatsappEmbeddedSignupError(
      "permissions_pending",
      "Meta ya no autoriza la cuenta de WhatsApp conectada."
    );
  }
  const asset = await dependencies.resolveAsset({
    accessToken,
    wabaId: integration.wabaId,
  });
  if (
    asset.phoneNumberId !== integration.phoneNumberId ||
    (integration.businessId && asset.businessId !== integration.businessId)
  ) {
    throw new WhatsappEmbeddedSignupError(
      "connection_unavailable",
      "Meta devolvió activos distintos de los conectados."
    );
  }
  let webhookSubscribed = await dependencies.isSubscribed({
    accessToken,
    wabaId: integration.wabaId,
  });
  if (!webhookSubscribed && subscribe) {
    await dependencies.subscribeWaba({
      accessToken,
      wabaId: integration.wabaId,
    });
    webhookSubscribed = true;
  }
  if (!webhookSubscribed) {
    throw new WhatsappEmbeddedSignupError(
      "webhook_pending",
      "La suscripción del webhook todavía está pendiente."
    );
  }
  return {
    accessToken,
    displayPhoneNumber: asset.displayPhoneNumber,
    verifiedName: asset.verifiedName,
    scopes: grant.scopes,
    expiresAt: grant.expiresAt,
    webhookSubscribed,
  };
}

function connectionChangedError(): WhatsappEmbeddedSignupError {
  return new WhatsappEmbeddedSignupError(
    "connection_unavailable",
    "La conexión cambió durante la operación. Actualizá la página e intentá nuevamente."
  );
}

async function refreshStoredWhatsappConnection(
  input: { organizationId: string; userId: string; subscribe: boolean },
  overrides: Partial<EmbeddedDependencies> = {}
): Promise<SafeWhatsappIntegrationView> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const integration = await getStoredIntegration(input.organizationId);
  if (!integration) {
    throw new WhatsappEmbeddedSignupError(
      "not_connected",
      "Todavía no hay una conexión de WhatsApp."
    );
  }
  const now = dependencies.now();
  let verified: Awaited<ReturnType<typeof verifyStoredConnection>>;
  try {
    verified = await verifyStoredConnection(
      integration,
      dependencies,
      input.subscribe
    );
  } catch (error) {
    const failure = embeddedFailure(error);
    const failureApplied = await prisma.$transaction(
      async (tx) => {
        const current = await resolveCurrentWhatsappIntegration(
          input.organizationId,
          tx
        );
        if (current.state !== "current" || current.id !== integration.id) {
          return false;
        }
        const updated = await tx.whatsappIntegration.updateMany({
          where: {
            id: integration.id,
            organizationId: input.organizationId,
            ...storedConfigurationSnapshot(integration),
          },
          data: {
            status:
              failure.code === "permissions_pending" ||
              failure.code === "webhook_pending"
                ? "ACTION_REQUIRED"
                : "ERROR",
            lastErrorCode: failure.code,
            lastError: failure.message.slice(0, 500),
          },
        });
        if (updated.count !== 1) return false;
        await cancelPendingFollowUpsTx(tx, {
          organizationId: input.organizationId,
          integrationId: integration.id,
          reason: "integration_disabled",
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.subscribe
        ? "whatsapp.reconnect_failed"
        : "whatsapp.connection_test_failed",
      entityType: "whatsapp_integration",
      entityId: integration.id,
      details: {
        result: failureApplied ? "error" : "connection_changed",
        code: failureApplied ? failure.code : "connection_changed",
      },
    });
    if (!failureApplied) throw connectionChangedError();
    throw failure;
  }

  const updated = await prisma.$transaction(
    async (tx) => {
      const current = await resolveCurrentWhatsappIntegration(
        input.organizationId,
        tx
      );
      if (current.state !== "current" || current.id !== integration.id) {
        throw connectionChangedError();
      }
      const changed = await tx.whatsappIntegration.updateMany({
        where: {
          id: integration.id,
          organizationId: input.organizationId,
          ...storedConfigurationSnapshot(integration),
        },
        data: {
          displayPhoneNumber: verified.displayPhoneNumber,
          verifiedName: verified.verifiedName,
          status: "CONNECTED",
          connectedAt: integration.connectedAt ?? now,
          lastSyncedAt: now,
          ...(integration.connectionMethod === "EMBEDDED_SIGNUP"
            ? {
                grantedScopes: verified.scopes,
                tokenExpiresAt: verified.expiresAt,
                webhookSubscribedAt: verified.webhookSubscribed
                  ? now
                  : undefined,
              }
            : {}),
          lastErrorCode: null,
          lastError: null,
        },
      });
      if (changed.count !== 1) throw connectionChangedError();
      return tx.whatsappIntegration.findFirstOrThrow({
        where: { id: integration.id, organizationId: input.organizationId },
        select: SAFE_INTEGRATION_SELECT,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: input.subscribe
      ? "whatsapp.reconnected"
      : "whatsapp.connection_tested",
    entityType: "whatsapp_integration",
    entityId: integration.id,
    details: { result: "ok" },
  });
  return safeView(updated);
}

export function testEmbeddedWhatsappConnection(
  input: { organizationId: string; userId: string },
  overrides: Partial<EmbeddedDependencies> = {}
) {
  return refreshStoredWhatsappConnection(
    { ...input, subscribe: false },
    overrides
  );
}

export function reconnectEmbeddedWhatsapp(
  input: { organizationId: string; userId: string },
  overrides: Partial<EmbeddedDependencies> = {}
) {
  return refreshStoredWhatsappConnection(
    { ...input, subscribe: true },
    overrides
  );
}

export async function disconnectEmbeddedWhatsapp(input: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  const integration = await getStoredIntegration(input.organizationId);
  if (!integration) return;
  await prisma.$transaction(
    async (tx) => {
      const current = await resolveCurrentWhatsappIntegration(
        input.organizationId,
        tx
      );
      if (current.state !== "current" || current.id !== integration.id) {
        throw connectionChangedError();
      }
      const updated = await tx.whatsappIntegration.updateMany({
        where: {
          id: integration.id,
          organizationId: input.organizationId,
          ...storedConfigurationSnapshot(integration),
        },
        data: {
          status: "DISCONNECTED",
          lastErrorCode: null,
          lastError: null,
        },
      });
      if (updated.count !== 1) throw connectionChangedError();
      await cancelPendingFollowUpsTx(tx, {
        organizationId: input.organizationId,
        integrationId: integration.id,
        reason: "integration_disabled",
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "whatsapp.disconnected",
    entityType: "whatsapp_integration",
    entityId: integration.id,
  });
}
