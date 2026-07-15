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
  "Embedded Signup DB: doble clic, replay, aislamiento y manual compatible",
  { skip: !isExplicitSafeLocalDatabase() && "requiere opt-in y PostgreSQL local" },
  async () => {
    const [{ prisma }, embedded, persistence] = await Promise.all([
      import("@/lib/prisma"),
      import("@/server/whatsapp/embedded-signup"),
      import("@/server/whatsapp/persistence"),
    ]);
    const suffix = randomUUID();
    const previousEnv = {
      META_APP_ID: process.env.META_APP_ID,
      META_APP_SECRET: process.env.META_APP_SECRET,
      META_EMBEDDED_SIGNUP_CONFIG_ID:
        process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
      META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
      CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    };
    process.env.META_APP_ID = "123456789012345";
    process.env.META_APP_SECRET = "test-only-meta-app-secret-long-enough";
    process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "223456789012345";
    process.env.META_GRAPH_API_VERSION = "v23.0";
    process.env.CREDENTIALS_ENCRYPTION_KEY = "00".repeat(32);

    const organizations: string[] = [];
    const users: string[] = [];
    const makeTenant = async (label: string) => {
      const user = await prisma.user.create({
        data: {
          id: `embedded-user-${label}-${suffix}`,
          name: `Owner ${label}`,
          email: `embedded-${label}-${suffix}@example.test`,
          emailVerified: true,
        },
        select: { id: true },
      });
      users.push(user.id);
      const organization = await prisma.organization.create({
        data: {
          name: `Embedded ${label}`,
          slug: `embedded-${label}-${suffix}`,
          members: { create: { userId: user.id, role: "OWNER" } },
        },
        select: { id: true },
      });
      organizations.push(organization.id);
      return { userId: user.id, organizationId: organization.id };
    };

    const now = new Date("2026-07-15T12:00:00.000Z");
    const asset = {
      wabaId: "323456789012345",
      businessId: "423456789012345",
      phoneNumberId: "523456789012345",
      displayPhoneNumber: "+54 9 351 123 4567",
      verifiedName: "Negocio Embedded",
    };
    let releaseExchange!: () => void;
    const exchangeGate = new Promise<void>((resolve) => {
      releaseExchange = resolve;
    });
    let exchangeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      exchangeStarted = resolve;
    });
    const dependencies = {
      now: () => now,
      exchangeCode: async () => {
        exchangeStarted();
        await exchangeGate;
        return {
          accessToken: "test-only-embedded-access-token-long-enough",
          expiresAt: null,
        };
      },
      inspectToken: async () => ({
        scopes: [
          "whatsapp_business_management",
          "whatsapp_business_messaging",
        ],
        wabaIds: [asset.wabaId],
        expiresAt: null,
      }),
      resolveAsset: async () => asset,
      subscribeWaba: async () => undefined,
      encryptToken: () => "v1.test-only-encrypted-token",
    };

    try {
      const tenantA = await makeTenant("a");
      const startA = await embedded.startEmbeddedSignup({ ...tenantA, now });
      assert.equal(startA.state, "ready");
      assert.ok(startA.state === "ready" && startA.nonce);
      const nonceA = startA.state === "ready" ? startA.nonce! : "";
      assert.equal(
        (await embedded.startEmbeddedSignup({
          ...tenantA,
          now,
          currentNonce: nonceA,
        })).state,
        "ready"
      );

      const codeA = "temporary-meta-code-for-tenant-a-123456";
      const first = embedded.completeEmbeddedSignup(
        { ...tenantA, nonce: nonceA, code: codeA },
        dependencies
      );
      await started;
      const duplicate = await embedded.completeEmbeddedSignup(
        { ...tenantA, nonce: nonceA, code: codeA },
        dependencies
      );
      assert.equal(duplicate.state, "processing");
      releaseExchange();
      assert.equal((await first).state, "connected");
      assert.equal(
        (
          await embedded.completeEmbeddedSignup(
            { ...tenantA, nonce: nonceA, code: codeA },
            dependencies
          )
        ).state,
        "already_connected"
      );
      const storedAttempt =
        await prisma.whatsappEmbeddedSignupAttempt.findUniqueOrThrow({
          where: { organizationId: tenantA.organizationId },
          select: { nonceHash: true, codeHash: true },
        });
      assert.match(storedAttempt.nonceHash, /^[a-f0-9]{64}$/);
      assert.match(storedAttempt.codeHash ?? "", /^[a-f0-9]{64}$/);
      assert.notEqual(storedAttempt.nonceHash, nonceA);
      assert.notEqual(storedAttempt.codeHash, codeA);

      const storedA = await prisma.whatsappIntegration.findFirstOrThrow({
        where: { organizationId: tenantA.organizationId },
        select: {
          phoneNumberId: true,
          connectionMethod: true,
          encryptedAccessToken: true,
        },
      });
      assert.equal(storedA.phoneNumberId, asset.phoneNumberId);
      assert.equal(storedA.connectionMethod, "EMBEDDED_SIGNUP");
      assert.notEqual(
        storedA.encryptedAccessToken,
        "test-only-embedded-access-token-long-enough"
      );

      const tenantB = await makeTenant("b");
      const startB = await embedded.startEmbeddedSignup({ ...tenantB, now });
      assert.ok(startB.state === "ready" && startB.nonce);
      await assert.rejects(
        () =>
          embedded.completeEmbeddedSignup(
            {
              ...tenantB,
              nonce: startB.state === "ready" ? startB.nonce! : "",
              code: "temporary-meta-code-for-tenant-b-123456",
            },
            {
              ...dependencies,
              exchangeCode: async () => ({
                accessToken: "test-only-second-access-token-long-enough",
                expiresAt: null,
              }),
            }
          ),
        (error: unknown) =>
          error instanceof embedded.WhatsappEmbeddedSignupError &&
          error.code === "number_already_connected"
      );
      assert.equal(
        await prisma.whatsappIntegration.count({
          where: { organizationId: tenantB.organizationId },
        }),
        0
      );

      const tenantCancel = await makeTenant("cancel");
      const startedCancel = await embedded.startEmbeddedSignup({
        ...tenantCancel,
        now,
      });
      assert.equal(startedCancel.state, "ready");
      const cancelNonce =
        startedCancel.state === "ready" ? startedCancel.nonce! : "";
      assert.equal(
        await embedded.cancelEmbeddedSignupAttempt({
          ...tenantCancel,
          nonce: "stale-or-incorrect-nonce",
          now: new Date(now.getTime() + 500),
        }),
        false
      );
      assert.equal(
        await embedded.cancelEmbeddedSignupAttempt({
          ...tenantCancel,
          nonce: cancelNonce,
          now: new Date(now.getTime() + 1_000),
        }),
        true
      );
      assert.equal(
        await embedded.cancelEmbeddedSignupAttempt({
          ...tenantCancel,
          nonce: cancelNonce,
          now: new Date(now.getTime() + 2_000),
        }),
        false
      );
      assert.equal(
        (
          await embedded.getSafeWhatsappConnectionStatus(
            tenantCancel.organizationId,
            new Date(now.getTime() + 2_000)
          )
        ).attemptState,
        null
      );

      const tenantPreserve = await makeTenant("preserve");
      const previousIntegration = await prisma.whatsappIntegration.create({
        data: {
          organizationId: tenantPreserve.organizationId,
          wabaId: "823456789012340",
          phoneNumberId: "823456789012341",
          displayPhoneNumber: "+1 202-555-0101",
          verifiedName: "Número anterior",
          encryptedAccessToken: "legacy-preserved-encrypted-token",
          status: "CONNECTED",
        },
        select: { id: true },
      });
      const preservedCustomer = await prisma.customer.create({
        data: {
          organizationId: tenantPreserve.organizationId,
          name: "Cliente histórico",
          phone: "+12025550102",
        },
        select: { id: true },
      });
      const preservedConversation = await prisma.conversation.create({
        data: {
          organizationId: tenantPreserve.organizationId,
          customerId: preservedCustomer.id,
          channel: "whatsapp",
          whatsappIntegrationId: previousIntegration.id,
        },
        select: { id: true },
      });
      const preserveStart = await embedded.startEmbeddedSignup({
        ...tenantPreserve,
        now,
      });
      assert.ok(preserveStart.state === "ready" && preserveStart.nonce);
      const replacementAsset = {
        wabaId: "923456789012340",
        businessId: "923456789012341",
        phoneNumberId: "923456789012342",
        displayPhoneNumber: "+1 202-555-0103",
        verifiedName: "Número nuevo",
      };
      await embedded.completeEmbeddedSignup(
        {
          ...tenantPreserve,
          nonce: preserveStart.state === "ready" ? preserveStart.nonce! : "",
          code: "temporary-meta-code-for-preservation-123456",
        },
        {
          ...dependencies,
          exchangeCode: async () => ({
            accessToken: "test-only-preservation-access-token-long-enough",
            expiresAt: null,
          }),
          inspectToken: async () => ({
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
            wabaIds: [replacementAsset.wabaId],
            expiresAt: null,
          }),
          resolveAsset: async () => replacementAsset,
        }
      );
      assert.equal(
        await prisma.whatsappIntegration.count({
          where: { organizationId: tenantPreserve.organizationId },
        }),
        2
      );
      assert.deepEqual(
        await prisma.whatsappIntegration.findUniqueOrThrow({
          where: { id: previousIntegration.id },
          select: { phoneNumberId: true, status: true },
        }),
        { phoneNumberId: "823456789012341", status: "DISCONNECTED" }
      );
      assert.equal(
        (
          await prisma.conversation.findUniqueOrThrow({
            where: { id: preservedConversation.id },
            select: { whatsappIntegrationId: true },
          })
        ).whatsappIntegrationId,
        previousIntegration.id
      );
      // Un delivery tardío del número histórico cambia updatedAt, pero nunca
      // debe desplazar a la conexión vigente en estado/acciones.
      await prisma.whatsappIntegration.update({
        where: { id: previousIntegration.id },
        data: { lastWebhookAt: new Date(now.getTime() + 10_000) },
      });
      const currentAfterHistoricalWebhook =
        await embedded.getSafeWhatsappConnectionStatus(
          tenantPreserve.organizationId,
          new Date(now.getTime() + 11_000)
        );
      assert.equal(
        currentAfterHistoricalWebhook.integration?.verifiedName,
        "Número nuevo"
      );
      assert.equal(
        currentAfterHistoricalWebhook.integration?.maskedPhoneNumber,
        "•••• 0103"
      );
      assert.equal(currentAfterHistoricalWebhook.integration?.status, "connected");

      const tenantAmbiguous = await makeTenant("ambiguous");
      await prisma.whatsappIntegration.createMany({
        data: [
          {
            organizationId: tenantAmbiguous.organizationId,
            wabaId: "103456789012340",
            phoneNumberId: "103456789012341",
            displayPhoneNumber: "+1 202-555-0110",
            verifiedName: "Ambigua uno",
            encryptedAccessToken: "ambiguous-encrypted-token-one",
            status: "CONNECTED",
          },
          {
            organizationId: tenantAmbiguous.organizationId,
            wabaId: "103456789012342",
            phoneNumberId: "103456789012343",
            displayPhoneNumber: "+1 202-555-0111",
            verifiedName: "Ambigua dos",
            encryptedAccessToken: "ambiguous-encrypted-token-two",
            status: "ERROR",
          },
        ],
      });
      const ambiguousStatus = await embedded.getSafeWhatsappConnectionStatus(
        tenantAmbiguous.organizationId,
        now
      );
      assert.equal(ambiguousStatus.connectionState, "ambiguous");
      assert.equal(ambiguousStatus.integration, null);
      await assert.rejects(
        () =>
          embedded.testEmbeddedWhatsappConnection(tenantAmbiguous, {
            decryptToken: () => "must-not-be-used",
            testConnection: async () => {
              throw new Error("must-not-be-used");
            },
          }),
        (error: unknown) =>
          error instanceof embedded.WhatsappEmbeddedSignupError &&
          error.code === "connection_unavailable"
      );

      const tenantRace = await makeTenant("race");
      const raceOriginal = await prisma.whatsappIntegration.create({
        data: {
          organizationId: tenantRace.organizationId,
          wabaId: "113456789012340",
          phoneNumberId: "113456789012341",
          displayPhoneNumber: "+1 202-555-0120",
          verifiedName: "Número carrera anterior",
          encryptedAccessToken: "race-encrypted-token-one",
          status: "CONNECTED",
          lastSyncedAt: now,
        },
        select: { id: true },
      });
      let releaseRaceVerification!: () => void;
      const raceVerificationGate = new Promise<void>((resolve) => {
        releaseRaceVerification = resolve;
      });
      let markRaceVerificationStarted!: () => void;
      const raceVerificationStarted = new Promise<void>((resolve) => {
        markRaceVerificationStarted = resolve;
      });
      const raceTest = embedded.testEmbeddedWhatsappConnection(tenantRace, {
        now: () => new Date(now.getTime() + 20_000),
        decryptToken: () => "test-only-race-access-token",
        testConnection: async ({ phoneNumberId }) => {
          markRaceVerificationStarted();
          await raceVerificationGate;
          return {
            phoneNumberId,
            displayPhoneNumber: "+1 202-555-0120",
            verifiedName: "Verificación tardía",
          };
        },
      });
      await raceVerificationStarted;
      const raceReplacement = await prisma.$transaction(async (tx) => {
        await tx.whatsappIntegration.update({
          where: { id: raceOriginal.id },
          data: { status: "DISCONNECTED" },
        });
        return tx.whatsappIntegration.create({
          data: {
            organizationId: tenantRace.organizationId,
            wabaId: "113456789012342",
            phoneNumberId: "113456789012343",
            displayPhoneNumber: "+1 202-555-0121",
            verifiedName: "Número carrera vigente",
            encryptedAccessToken: "race-encrypted-token-two",
            status: "CONNECTED",
            lastSyncedAt: new Date(now.getTime() + 10_000),
          },
          select: { id: true },
        });
      });
      releaseRaceVerification();
      await assert.rejects(
        () => raceTest,
        (error: unknown) =>
          error instanceof embedded.WhatsappEmbeddedSignupError &&
          error.code === "connection_unavailable"
      );
      assert.deepEqual(
        await prisma.whatsappIntegration.findMany({
          where: {
            organizationId: tenantRace.organizationId,
            status: { not: "DISCONNECTED" },
          },
          select: { id: true },
        }),
        [{ id: raceReplacement.id }]
      );

      const tenantTelemetry = await makeTenant("telemetry");
      const telemetryIntegration = await prisma.whatsappIntegration.create({
        data: {
          organizationId: tenantTelemetry.organizationId,
          wabaId: "123456789012340",
          phoneNumberId: "123456789012341",
          displayPhoneNumber: "+1 202-555-0130",
          verifiedName: "Número con telemetría",
          encryptedAccessToken: "telemetry-encrypted-token",
          status: "CONNECTED",
          lastSyncedAt: now,
        },
        select: { id: true },
      });
      let releaseTelemetryVerification!: () => void;
      const telemetryGate = new Promise<void>((resolve) => {
        releaseTelemetryVerification = resolve;
      });
      let markTelemetryStarted!: () => void;
      const telemetryStarted = new Promise<void>((resolve) => {
        markTelemetryStarted = resolve;
      });
      const telemetryTest = embedded.testEmbeddedWhatsappConnection(
        tenantTelemetry,
        {
          now: () => new Date(now.getTime() + 30_000),
          decryptToken: () => "test-only-telemetry-access-token",
          testConnection: async ({ phoneNumberId }) => {
            markTelemetryStarted();
            await telemetryGate;
            return {
              phoneNumberId,
              displayPhoneNumber: "+1 202-555-0130",
              verifiedName: "Telemetría verificada",
            };
          },
        }
      );
      await telemetryStarted;
      await prisma.whatsappIntegration.update({
        where: { id: telemetryIntegration.id },
        data: { lastWebhookAt: new Date(now.getTime() + 25_000) },
      });
      releaseTelemetryVerification();
      assert.equal((await telemetryTest).status, "connected");
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { id: telemetryIntegration.id },
            select: { verifiedName: true },
          })
        ).verifiedName,
        "Telemetría verificada"
      );

      const tenantManual = await makeTenant("manual");
      const manual = await prisma.whatsappIntegration.create({
        data: {
          organizationId: tenantManual.organizationId,
          wabaId: "623456789012345",
          phoneNumberId: "723456789012345",
          displayPhoneNumber: "+54 9 351 000 0000",
          verifiedName: "Manual",
          encryptedAccessToken: "legacy-encrypted-token",
          status: "CONNECTED",
        },
        select: { id: true },
      });
      await embedded.testEmbeddedWhatsappConnection(tenantManual, {
        now: () => now,
        decryptToken: () => "test-only-manual-access-token-long-enough",
        testConnection: async ({ phoneNumberId }) => ({
          phoneNumberId,
          displayPhoneNumber: "+54 9 351 000 0000",
          verifiedName: "Manual verificado",
        }),
      });
      assert.deepEqual(
        await prisma.whatsappIntegration.findUniqueOrThrow({
          where: { id: manual.id },
          select: { connectionMethod: true, status: true },
        }),
        { connectionMethod: "MANUAL", status: "CONNECTED" }
      );
      await embedded.disconnectEmbeddedWhatsapp(tenantManual);
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { id: manual.id },
            select: { status: true },
          })
        ).status,
        "DISCONNECTED"
      );
      assert.equal(
        (
          await persistence.resolveWhatsappIntegration("723456789012345")
        )?.status,
        "DISCONNECTED"
      );
      await embedded.reconnectEmbeddedWhatsapp(tenantManual, {
        now: () => new Date(now.getTime() + 1_000),
        decryptToken: () => "test-only-manual-access-token-long-enough",
        testConnection: async ({ phoneNumberId }) => ({
          phoneNumberId,
          displayPhoneNumber: "+54 9 351 000 0000",
          verifiedName: "Manual reconectado",
        }),
      });
      assert.equal(
        (
          await prisma.whatsappIntegration.findUniqueOrThrow({
            where: { id: manual.id },
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
      for (const [name, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
);
