import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

function isExplicitSafeLocalDatabase() {
  if (process.env.RUN_STAGE6C_DB_TESTS !== "1") return false;
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return false;
  const value = process.env.DATABASE_URL?.trim();
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

test(
  "YCloud DB: cifrado, idempotencia, estados y aislamiento multiempresa",
  { skip: !isExplicitSafeLocalDatabase() && "requiere opt-in y PostgreSQL local" },
  async () => {
    const [{ prisma }, connection, crypto, persistence, client] = await Promise.all([
      import("@/lib/prisma"),
      import("@/server/whatsapp/ycloud-connection"),
      import("@/server/whatsapp/crypto"),
      import("@/server/whatsapp/persistence"),
      import("@/server/whatsapp/ycloud-client"),
    ]);
    const suffix = randomUUID();
    const previousKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = "33".repeat(32);
    const organizations: string[] = [];
    const users: string[] = [];

    const makeTenant = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          id: `ycloud-user-${label}-${suffix}`,
          name: `YCloud ${label}`,
          email: `ycloud-${label}-${suffix}@example.test`,
          emailVerified: true,
        },
        select: { id: true },
      });
      users.push(user.id);
      const organization = await prisma.organization.create({
        data: {
          name: `YCloud ${label}`,
          slug: `ycloud-${label}-${suffix}`,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
        select: { id: true },
      });
      organizations.push(organization.id);
      return { userId: user.id, organizationId: organization.id };
    };

    const tenantA = await makeTenant("a");
    const tenantB = await makeTenant("b");
    const apiKey = "test-only-db-ycloud-api-key-long-enough";
    const phoneNumber = "+5493515556789";
    const phoneNumberId = `ycloud-phone-${suffix}`;
    const wabaId = `ycloud-waba-${suffix}`;
    const now = new Date("2026-07-15T20:00:00.000Z");
    const asset = {
      phoneNumber,
      phoneNumberId,
      wabaId,
      displayPhoneNumber: "+54 9 351 555-6789",
      verifiedName: "YCloud DB Test",
      status: "CONNECTED" as const,
    };
    const dependencies = {
      resolveAsset: async () => asset,
      enforceRateLimit: () => undefined,
      now: () => now,
      audit: async () => undefined,
    };

    try {
      const input = {
        ...tenantA,
        apiKey,
        phoneNumber,
      };
      const [first, duplicate] = await Promise.all([
        connection.connectYCloudWhatsapp(input, dependencies),
        connection.connectYCloudWhatsapp(input, dependencies),
      ]);
      assert.equal(first.integrationId, duplicate.integrationId);
      const stored = await prisma.whatsappIntegration.findUniqueOrThrow({
        where: { phoneNumberId },
      });
      assert.equal(stored.organizationId, tenantA.organizationId);
      assert.equal(stored.provider, "YCLOUD");
      assert.equal(stored.connectionMethod, "COEXISTENCE");
      assert.equal(stored.providerPhoneNumber, phoneNumber);
      assert.notEqual(stored.encryptedAccessToken, apiKey);
      assert.equal(crypto.decryptAccessToken(stored.encryptedAccessToken), apiKey);
      assert.doesNotMatch(JSON.stringify(first), /apiKey|phoneNumber|waba/i);

      await assert.rejects(
        connection.connectYCloudWhatsapp(
          { ...input, ...tenantB },
          dependencies
        ),
        (error) =>
          error instanceof connection.YCloudConnectionError &&
          error.code === "number_already_connected"
      );
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { phoneNumberId },
            select: { organizationId: true },
          })
        ).organizationId,
        tenantA.organizationId
      );

      const previousMeta = await prisma.whatsappIntegration.create({
        data: {
          organizationId: tenantB.organizationId,
          wabaId: `meta-waba-${suffix}`,
          phoneNumberId: `meta-phone-${suffix}`,
          displayPhoneNumber: "+54 9 351 555-7777",
          verifiedName: "Meta anterior",
          encryptedAccessToken: crypto.encryptAccessToken(
            "test-only-existing-meta-token-long-enough"
          ),
          provider: "META_CLOUD",
          connectionMethod: "MANUAL",
          status: "CONNECTED",
          connectedAt: now,
        },
        select: { id: true },
      });
      await assert.rejects(
        connection.connectYCloudWhatsapp(
          {
            ...tenantB,
            apiKey: "test-only-invalid-ycloud-key-long-enough",
            phoneNumber: "+5493515558888",
          },
          {
            ...dependencies,
            resolveAsset: async () => {
              throw new client.YCloudApiError(
                "authentication",
                "YCloud rechazó la API key."
              );
            },
          }
        ),
        (error) =>
          error instanceof connection.YCloudConnectionError &&
          error.code === "ycloud_authentication"
      );
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { id: previousMeta.id },
            select: { status: true },
          })
        ).status,
        "CONNECTED"
      );

      const resolved = await persistence.resolveYCloudIntegration({
        phoneNumber,
        wabaId,
      });
      assert.equal(resolved?.organizationId, tenantA.organizationId);
      assert.equal(resolved?.provider, "YCLOUD");
      assert.equal(
        await persistence.resolveYCloudIntegration({
          phoneNumber,
          wabaId: `other-${suffix}`,
        }),
        null
      );

      const event = {
        kind: "message" as const,
        provider: "YCLOUD" as const,
        webhookEventId: `evt-${suffix}`,
        wabaId,
        phoneNumberId: phoneNumber,
        externalMessageId: `ycloud-in-${suffix}`,
        whatsappMessageId: `wamid.in.${suffix}`,
        from: "+5493515559999",
        customerName: "Cliente YCloud",
        timestamp: "2026-07-15T20:01:00.000Z",
        messageType: "text" as const,
        content: "Hola",
        metadata: { source: "whatsapp", provider: "ycloud" },
      };
      const scope = {
        organizationId: tenantA.organizationId,
        integrationId: stored.id,
      };
      const persisted = await persistence.persistIncomingWhatsappMessage(event, scope);
      const replay = await persistence.persistIncomingWhatsappMessage(event, scope);
      assert.equal(persisted.duplicate, false);
      assert.equal(replay.duplicate, true);
      const inbound = await prisma.message.findUniqueOrThrow({
        where: { externalMessageId: event.externalMessageId },
      });
      assert.equal(inbound.whatsappMessageId, event.whatsappMessageId);
      assert.equal(inbound.organizationId, tenantA.organizationId);

      const outbound = await prisma.message.create({
        data: {
          organizationId: tenantA.organizationId,
          conversationId: inbound.conversationId,
          senderType: "AI",
          content: "Respuesta",
          externalMessageId: `ycloud-out-${suffix}`,
          deliveryStatus: "SENT",
        },
        select: { id: true },
      });
      for (const deliveryStatus of ["SENT", "DELIVERED", "READ"] as const) {
        const applied = await persistence.applyWhatsappStatus(
          {
            kind: "status",
            provider: "YCLOUD",
            phoneNumberId: phoneNumber,
            externalMessageId: `ycloud-out-${suffix}`,
            whatsappMessageId: `wamid.out.${suffix}`,
            internalMessageId: outbound.id,
            timestamp: null,
            deliveryStatus,
            errorCode: null,
            errorMessage: null,
          },
          tenantA.organizationId
        );
        assert.equal(applied.found, true);
      }
      const delivered = await prisma.message.findUniqueOrThrow({
        where: { id: outbound.id },
      });
      assert.equal(delivered.deliveryStatus, "READ");
      assert.equal(delivered.whatsappMessageId, `wamid.out.${suffix}`);

      const wrongTenant = await persistence.applyWhatsappStatus(
        {
          kind: "status",
          provider: "YCLOUD",
          phoneNumberId: phoneNumber,
          externalMessageId: `ycloud-out-${suffix}`,
          timestamp: null,
          deliveryStatus: "FAILED",
          errorCode: "safe",
          errorMessage: "No entregado",
        },
        tenantB.organizationId
      );
      assert.deepEqual(wrongTenant, { found: false });
    } finally {
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      if (previousKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      else process.env.CREDENTIALS_ENCRYPTION_KEY = previousKey;
      await prisma.$disconnect();
    }
  }
);
