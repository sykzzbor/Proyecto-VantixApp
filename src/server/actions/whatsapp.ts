"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import {
  whatsappIntegrationConfigSchema,
  type WhatsappIntegrationConfigInput,
} from "@/lib/validations/whatsapp";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { ActionError, toActionFailure, type ActionResult } from "@/server/errors";
import { checkRateLimit } from "@/server/rate-limit";
import {
  CredentialsEncryptionError,
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";
import {
  MetaApiError,
  testWhatsappConnection,
} from "@/server/whatsapp/meta-client";

const INTEGRATION_PATH = "/dashboard/integraciones/whatsapp";
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
    checkConnectionRateLimit(org.id, user.id);
    const data = whatsappIntegrationConfigSchema.parse(input);

    let remote;
    try {
      remote = await testWhatsappConnection({
        phoneNumberId: data.phoneNumberId,
        accessToken: data.accessToken,
      });
    } catch (error) {
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.prueba_conexion",
        entityType: "whatsapp_integration",
        details: { resultado: "error" },
      });
      throw metaActionError(error);
    }

    const encryptedAccessToken = encryptAccessToken(data.accessToken);
    const existing = await prisma.whatsappIntegration.findFirst({
      where: { organizationId: org.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    let integration;
    try {
      integration = existing
        ? await prisma.whatsappIntegration.update({
            where: { id: existing.id },
            data: {
              wabaId: data.wabaId,
              phoneNumberId: data.phoneNumberId,
              displayPhoneNumber: remote.displayPhoneNumber,
              verifiedName: remote.verifiedName,
              encryptedAccessToken,
              status: "CONNECTED",
              connectedAt: new Date(),
              lastError: null,
            },
          })
        : await prisma.whatsappIntegration.create({
            data: {
              organizationId: org.id,
              wabaId: data.wabaId,
              phoneNumberId: data.phoneNumberId,
              displayPhoneNumber: remote.displayPhoneNumber,
              verifiedName: remote.verifiedName,
              encryptedAccessToken,
              status: "CONNECTED",
              connectedAt: new Date(),
            },
          });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ActionError(
          "Ese Phone Number ID ya está vinculado a otra integración."
        );
      }
      throw error;
    }

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "whatsapp.prueba_conexion",
      entityType: "whatsapp_integration",
      entityId: integration.id,
      details: { resultado: "ok" },
    });
    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "whatsapp.conectado",
      entityType: "whatsapp_integration",
      entityId: integration.id,
    });
    revalidateWhatsapp();
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}

export async function testStoredWhatsappConnection(): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "whatsapp.manage");
    checkConnectionRateLimit(org.id, user.id);
    const integration = await prisma.whatsappIntegration.findFirst({
      where: { organizationId: org.id },
      orderBy: { updatedAt: "desc" },
    });
    if (!integration) {
      throw new ActionError("Todavía no hay una integración de WhatsApp guardada.");
    }

    try {
      const accessToken = decryptAccessToken(integration.encryptedAccessToken);
      const remote = await testWhatsappConnection({
        phoneNumberId: integration.phoneNumberId,
        accessToken,
      });
      const wasConnected = integration.status === "CONNECTED";
      await prisma.whatsappIntegration.updateMany({
        where: { id: integration.id, organizationId: org.id },
        data: {
          displayPhoneNumber: remote.displayPhoneNumber,
          verifiedName: remote.verifiedName,
          status: "CONNECTED",
          connectedAt: integration.connectedAt ?? new Date(),
          lastError: null,
        },
      });
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.prueba_conexion",
        entityType: "whatsapp_integration",
        entityId: integration.id,
        details: { resultado: "ok" },
      });
      if (!wasConnected) {
        await recordAudit({
          organizationId: org.id,
          userId: user.id,
          action: "whatsapp.conectado",
          entityType: "whatsapp_integration",
          entityId: integration.id,
        });
      }
    } catch (error) {
      const safe = metaActionError(error);
      await prisma.whatsappIntegration.updateMany({
        where: { id: integration.id, organizationId: org.id },
        data: { status: "ERROR", lastError: safe.message.slice(0, 500) },
      });
      await recordAudit({
        organizationId: org.id,
        userId: user.id,
        action: "whatsapp.prueba_conexion",
        entityType: "whatsapp_integration",
        entityId: integration.id,
        details: { resultado: "error" },
      });
      revalidateWhatsapp();
      throw safe;
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
    const integration = await prisma.whatsappIntegration.findFirst({
      where: { organizationId: org.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!integration) return { ok: true };

    await prisma.whatsappIntegration.updateMany({
      where: { id: integration.id, organizationId: org.id },
      data: { status: "DISCONNECTED", lastError: null },
    });
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
