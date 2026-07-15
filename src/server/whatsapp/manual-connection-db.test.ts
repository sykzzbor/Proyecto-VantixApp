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
  "conexión manual DB: cifrado, idempotencia, compatibilidad y aislamiento",
  { skip: !isExplicitSafeLocalDatabase() && "requiere opt-in y PostgreSQL local" },
  async () => {
    const [{ prisma }, manual, crypto] = await Promise.all([
      import("@/lib/prisma"),
      import("@/server/whatsapp/manual-connection"),
      import("@/server/whatsapp/crypto"),
    ]);
    const suffix = randomUUID();
    const previousKey = process.env.CREDENTIALS_ENCRYPTION_KEY;
    process.env.CREDENTIALS_ENCRYPTION_KEY = "11".repeat(32);
    const organizations: string[] = [];
    const users: string[] = [];
    const makeTenant = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          id: `manual-user-${label}-${suffix}`,
          name: `Manual ${label}`,
          email: `manual-${label}-${suffix}@example.test`,
          emailVerified: true,
        },
        select: { id: true },
      });
      users.push(user.id);
      const organization = await prisma.organization.create({
        data: {
          name: `Manual ${label}`,
          slug: `manual-${label}-${suffix}`,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
        select: { id: true },
      });
      organizations.push(organization.id);
      return { userId: user.id, organizationId: organization.id };
    };

    const tenantA = await makeTenant("a");
    const tenantB = await makeTenant("b");
    const now = new Date("2026-07-15T18:00:00.000Z");
    const wabaA = "413456789012345";
    const phoneA = "513456789012345";
    const tokenA = "test-only-manual-token-a-long-enough";
    const businessA = "613456789012345";
    const dependenciesFor = (input: {
      wabaId: string;
      phoneNumberId: string;
      businessId: string;
      displayPhoneNumber: string;
      verifiedName: string;
      onSubscribe?: () => Promise<void> | void;
      subscribed?: boolean;
    }) => ({
      now: () => now,
      enforceRateLimit: () => undefined,
      inspectToken: async () => ({
        scopes: [
          "whatsapp_business_management",
          "whatsapp_business_messaging",
        ],
        wabaIds: [input.wabaId],
        expiresAt: new Date("2027-07-15T18:00:00.000Z"),
      }),
      resolveAsset: async () => ({
        wabaId: input.wabaId,
        businessId: input.businessId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: input.displayPhoneNumber,
        verifiedName: input.verifiedName,
      }),
      subscribeWaba: async () => {
        await input.onSubscribe?.();
      },
      isSubscribed: async () => input.subscribed ?? true,
    });

    try {
      let subscribeCalls = 0;
      const inputA = {
        ...tenantA,
        wabaId: wabaA,
        phoneNumberId: phoneA,
        accessToken: tokenA,
      };
      const depsA = dependenciesFor({
        wabaId: wabaA,
        phoneNumberId: phoneA,
        businessId: businessA,
        displayPhoneNumber: "+54 9 351 555 1000",
        verifiedName: "Manual A",
        onSubscribe: () => {
          subscribeCalls += 1;
        },
      });
      const [first, duplicate] = await Promise.all([
        manual.connectManualWhatsapp(inputA, depsA),
        manual.connectManualWhatsapp(inputA, depsA),
      ]);
      assert.equal(first.integrationId, duplicate.integrationId);
      assert.equal(subscribeCalls, 1);
      assert.equal(
        await prisma.whatsappIntegration.count({
          where: { organizationId: tenantA.organizationId, phoneNumberId: phoneA },
        }),
        1
      );
      const storedA = await prisma.whatsappIntegration.findUniqueOrThrow({
        where: { phoneNumberId: phoneA },
      });
      assert.notEqual(storedA.encryptedAccessToken, tokenA);
      assert.equal(crypto.decryptAccessToken(storedA.encryptedAccessToken), tokenA);
      assert.equal(storedA.connectionMethod, "MANUAL");
      assert.equal(storedA.status, "CONNECTED");
      assert.equal(storedA.webhookSubscribedAt?.toISOString(), now.toISOString());
      assert.equal(storedA.businessId, businessA);
      assert.deepEqual(storedA.grantedScopes.sort(), [
        "whatsapp_business_management",
        "whatsapp_business_messaging",
      ]);
      assert.doesNotMatch(JSON.stringify(first), /token|waba|phone/i);

      const replacementToken = "test-only-manual-token-replacement-long-enough";
      const replacement = await manual.connectManualWhatsapp(
        { ...inputA, accessToken: replacementToken },
        depsA
      );
      assert.equal(replacement.integrationId, storedA.id);
      assert.equal(
        await prisma.whatsappIntegration.count({
          where: { organizationId: tenantA.organizationId, phoneNumberId: phoneA },
        }),
        1
      );
      const replaced = await prisma.whatsappIntegration.findUniqueOrThrow({
        where: { phoneNumberId: phoneA },
      });
      assert.equal(
        crypto.decryptAccessToken(replaced.encryptedAccessToken),
        replacementToken
      );

      await assert.rejects(
        manual.connectManualWhatsapp(
          { ...inputA, ...tenantB },
          { ...depsA, enforceRateLimit: () => undefined }
        ),
        (error) =>
          error instanceof manual.ManualWhatsappConnectionError &&
          error.code === "number_already_connected" &&
          !error.message.includes(tokenA)
      );
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { phoneNumberId: phoneA },
            select: { organizationId: true },
          })
        ).organizationId,
        tenantA.organizationId
      );

      const previousB = await prisma.whatsappIntegration.create({
        data: {
          organizationId: tenantB.organizationId,
          wabaId: "713456789012345",
          phoneNumberId: "813456789012345",
          displayPhoneNumber: "+54 9 351 555 2000",
          verifiedName: "Manual B anterior",
          encryptedAccessToken: crypto.encryptAccessToken(
            "test-only-existing-token-b-long-enough"
          ),
          connectionMethod: "MANUAL",
          status: "CONNECTED",
          connectedAt: now,
        },
        select: { id: true },
      });
      const failedPhone = "913456789012345";
      const failedToken = "test-only-subscription-failure-token-long-enough";
      const subscriptionError = new manual.ManualWhatsappConnectionError(
        "webhook_pending",
        "Meta no confirmó la suscripción del webhook.",
        409
      );
      await assert.rejects(
        manual.connectManualWhatsapp(
          {
            ...tenantB,
            wabaId: "723456789012345",
            phoneNumberId: failedPhone,
            accessToken: failedToken,
          },
          dependenciesFor({
            wabaId: "723456789012345",
            phoneNumberId: failedPhone,
            businessId: "733456789012345",
            displayPhoneNumber: "+54 9 351 555 3000",
            verifiedName: "No debe guardarse",
            onSubscribe: () => {
              throw subscriptionError;
            },
          })
        ),
        (error) =>
          error instanceof manual.ManualWhatsappConnectionError &&
          error.code === "webhook_pending" &&
          !error.message.includes(failedToken)
      );
      assert.equal(
        await prisma.whatsappIntegration.count({
          where: { organizationId: tenantB.organizationId, phoneNumberId: failedPhone },
        }),
        0
      );
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { id: previousB.id },
            select: { status: true },
          })
        ).status,
        "CONNECTED"
      );

      const phoneA2 = "523456789012346";
      await manual.connectManualWhatsapp(
        {
          ...tenantA,
          wabaId: "423456789012346",
          phoneNumberId: phoneA2,
          accessToken: "test-only-manual-token-a2-long-enough",
        },
        dependenciesFor({
          wabaId: "423456789012346",
          phoneNumberId: phoneA2,
          businessId: "623456789012346",
          displayPhoneNumber: "+54 9 351 555 1001",
          verifiedName: "Manual A nueva",
        })
      );
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { phoneNumberId: phoneA },
            select: { status: true },
          })
        ).status,
        "DISCONNECTED"
      );
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { id: previousB.id },
            select: { status: true },
          })
        ).status,
        "CONNECTED"
      );
    } finally {
      for (const organizationId of organizations.reverse()) {
        await prisma.organization.deleteMany({ where: { id: organizationId } });
      }
      for (const userId of users.reverse()) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
      if (previousKey === undefined) delete process.env.CREDENTIALS_ENCRYPTION_KEY;
      else process.env.CREDENTIALS_ENCRYPTION_KEY = previousKey;
    }
  }
);
