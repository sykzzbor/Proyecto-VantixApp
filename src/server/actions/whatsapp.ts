"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import {
  whatsappIntegrationConfigSchema,
  type WhatsappIntegrationConfigInput,
} from "@/lib/validations/whatsapp";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { cancelPendingFollowUpsTx } from "@/server/automation/follow-up";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import {
  CredentialsEncryptionError,
  decryptAccessToken,
} from "@/server/whatsapp/crypto";
import { resolveCurrentWhatsappIntegration } from "@/server/whatsapp/current-integration";
import {
  connectManualWhatsapp,
  ManualWhatsappConnectionError,
} from "@/server/whatsapp/manual-connection";
import {
  MetaApiError,
  testWhatsappConnection,
} from "@/server/whatsapp/meta-client";

const INTEGRATION_PATH = "/dashboard/integraciones";
const CONNECTION_TEST_LIMIT = 5;
const CONNECTION_TEST_WINDOW_MS = 60_000;

function revalidateWhatsapp() {
  revalidatePath(INTEGRATION_PATH);
  revalidatePath("/dashboard/conversaciones");
}

function checkConnectionRateLimit(organizationId: string, userId: string) {
  const rate = checkRateLimit(
    `whatsapp-connection:${organizationId}:${userId}`,
    CONNECTION_TEST_LIMIT,
    CONNECTION_TEST_WINDOW_MS
  );
  if (!rate.allowed) {
    throw new ActionError(
      `Hiciste demasiadas pruebas seguidas. Esperá ${rate.retryAfterSeconds} segundos.`
    );
  }
}

function metaActionError(error: unknown): ActionError {
  if (error instanceof MetaApiError) return new ActionError(error.safeMessage);
  if (error instanceof CredentialsEncryptionError) {
    return new ActionError("No se pudo usar la configuración segura de WhatsApp.");
  }
  return new ActionError("No se pudo completar la operación con WhatsApp.");
}

export async function saveWhatsappIntegration(
  input: WhatsappIntegrationConfigInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "whatsapp.manage");
    const data = whatsappIntegrationConfigSchema.parse(input);
    await connectManualWhatsapp({
      organizationId: org.id,
      userId: user.id,
      ...data,
    });
    revalidateWhatsapp();
    return { ok: true };
  } catch (error) {
    if (error instanceof ManualWhatsappConnectionError) {
      return toActionFailure(new ActionError(error.message));
    }
    return toActionFailure(error);
  }
}

export async function testStoredWhatsappConnection(): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "whatsapp.manage");
    checkConnectionRateLimit(org.id, user.id);
    const resolution = await resolveCurrentWhatsappIntegration(org.id);
    if (resolution.state === "ambiguous") {
      throw new ActionError(
        "La conexión de WhatsApp requiere revisión antes de continuar."
      );
    }
    const integration = resolution.state === "current"
      ? await prisma.whatsappIntegration.findFirst({
          where: { id: resolution.id, organizationId: org.id },
        })
      : null;
    if (!integration) {
      throw new ActionError("Todavía no hay una integración de WhatsApp guardada.");
    }

    let remote;
    try {
      const accessToken = decryptAccessToken(integration.encryptedAccessToken);
      remote = await testWhatsappConnection({
        phoneNumberId: integration.phoneNumberId,
        accessToken,
      });
    } catch (error) {
      const safe = metaActionError(error);
      const failureApplied = await prisma.$transaction(
        async (tx) => {
          const current = await resolveCurrentWhatsappIntegration(org.id, tx);
          if (current.state !== "current" || current.id !== integration.id) {
            return false;
          }
          const updated = await tx.whatsappIntegration.updateMany({
            where: {
              id: integration.id,
              organizationId: org.id,
              status: integration.status,
              phoneNumberId: integration.phoneNumberId,
              wabaId: integration.wabaId,
              connectionMethod: integration.connectionMethod,
              businessId: integration.businessId,
              encryptedAccessToken: integration.encryptedAccessToken,
              lastSyncedAt: integration.lastSyncedAt,
            },
            data: {
              status: "ERROR",
              lastErrorCode: "connection_unavailable",
              lastError: safe.message.slice(0, 500),
            },
          });
          if (updated.count !== 1) return false;
          await cancelPendingFollowUpsTx(tx, {
            organizationId: org.id,
            integrationId: integration.id,
            reason: "integration_disabled",
          });
          return true;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.prueba_conexion",
        entityType: "whatsapp_integration",
        entityId: integration.id,
        details: {
          resultado: failureApplied ? "error" : "conexion_cambiada",
        },
      });
      revalidateWhatsapp();
      if (!failureApplied) {
        throw new ActionError(
          "La conexión cambió durante la prueba. Actualizá la página e intentá nuevamente."
        );
      }
      throw safe;
    }

    const now = new Date();
    await prisma.$transaction(
      async (tx) => {
        const current = await resolveCurrentWhatsappIntegration(org.id, tx);
        if (current.state !== "current" || current.id !== integration.id) {
          throw new ActionError(
            "La conexión cambió durante la prueba. Actualizá la página e intentá nuevamente."
          );
        }
        const updated = await tx.whatsappIntegration.updateMany({
          where: {
            id: integration.id,
            organizationId: org.id,
            status: integration.status,
            phoneNumberId: integration.phoneNumberId,
            wabaId: integration.wabaId,
            connectionMethod: integration.connectionMethod,
            businessId: integration.businessId,
            encryptedAccessToken: integration.encryptedAccessToken,
            lastSyncedAt: integration.lastSyncedAt,
          },
          data: {
            displayPhoneNumber: remote.displayPhoneNumber,
            verifiedName: remote.verifiedName,
            status: "CONNECTED",
            connectedAt: integration.connectedAt ?? now,
            lastSyncedAt: now,
            lastErrorCode: null,
            lastError: null,
          },
        });
        if (updated.count !== 1) {
          throw new ActionError(
            "La conexión cambió durante la prueba. Actualizá la página e intentá nuevamente."
          );
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "whatsapp.prueba_conexion",
      entityType: "whatsapp_integration",
      entityId: integration.id,
      details: { resultado: "ok" },
    });
    if (integration.status !== "CONNECTED") {
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.conectado",
        entityType: "whatsapp_integration",
        entityId: integration.id,
      });
    }

    revalidateWhatsapp();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function disconnectWhatsappIntegration(): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "whatsapp.manage");
    const resolution = await resolveCurrentWhatsappIntegration(org.id);
    if (resolution.state === "ambiguous") {
      throw new ActionError(
        "La conexión de WhatsApp requiere revisión antes de continuar."
      );
    }
    const integration = resolution.state === "current"
      ? await prisma.whatsappIntegration.findFirst({
          where: { id: resolution.id, organizationId: org.id },
          select: {
            id: true,
            status: true,
            phoneNumberId: true,
            wabaId: true,
            connectionMethod: true,
            businessId: true,
            encryptedAccessToken: true,
            lastSyncedAt: true,
          },
        })
      : null;
    if (!integration) return { ok: true };

    await prisma.$transaction(
      async (tx) => {
        const current = await resolveCurrentWhatsappIntegration(org.id, tx);
        if (current.state !== "current" || current.id !== integration.id) {
          throw new ActionError(
            "La conexión cambió. Actualizá la página e intentá nuevamente."
          );
        }
        const updated = await tx.whatsappIntegration.updateMany({
          where: {
            id: integration.id,
            organizationId: org.id,
            status: integration.status,
            phoneNumberId: integration.phoneNumberId,
            wabaId: integration.wabaId,
            connectionMethod: integration.connectionMethod,
            businessId: integration.businessId,
            encryptedAccessToken: integration.encryptedAccessToken,
            lastSyncedAt: integration.lastSyncedAt,
          },
          data: {
            status: "DISCONNECTED",
            lastErrorCode: null,
            lastError: null,
          },
        });
        if (updated.count !== 1) {
          throw new ActionError(
            "La conexión cambió. Actualizá la página e intentá nuevamente."
          );
        }
        await cancelPendingFollowUpsTx(tx, {
          organizationId: org.id,
          integrationId: integration.id,
          reason: "integration_disabled",
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "whatsapp.desconectado",
      entityType: "whatsapp_integration",
      entityId: integration.id,
    });
    revalidateWhatsapp();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
