import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import {
  buildN8nDiagnostic,
  buildWhatsappDiagnostic,
} from "@/server/integrations/diagnostics";
import { getMetaEmbeddedSignupPublicConfiguration } from "@/server/whatsapp/config";

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("Centro de Integraciones: permisos y diagnósticos seguros", async (t) => {
  await t.test("OWNER y ADMIN administran; AGENT y VIEWER solo leen", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      assert.equal(can(role, "whatsapp.manage"), true);
      assert.equal(can(role, "automation.manage"), true);
    }
    for (const role of ["AGENT", "VIEWER"] as const) {
      assert.equal(can(role, "whatsapp.manage"), false);
      assert.equal(can(role, "automation.manage"), false);
      assert.equal(can(role, "automation.view"), true);
    }
  });

  await t.test("Meta pendiente enumera categorías humanas sin secretos", () => {
    const result = buildWhatsappDiagnostic({
      metaApplication: false,
      embeddedSignupConfiguration: false,
      permissions: false,
      numberConnected: false,
      webhook: false,
    });
    assert.equal(result.state, "pending");
    assert.equal(result.missingCount, 5);
    assert.deepEqual(
      result.steps.map((step) => step.code),
      [
        "meta_application",
        "embedded_signup_configuration",
        "permissions",
        "phone_number",
        "webhook",
      ]
    );
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /META_APP_SECRET|CREDENTIALS_ENCRYPTION_KEY/);
    assert.doesNotMatch(serialized, /https?:\/\//);
  });

  await t.test("n8n incompleto no se declara operativo", () => {
    const result = buildN8nDiagnostic({
      endpoint: true,
      outboundSignature: false,
      callbackSignature: true,
      dispatcher: false,
      workflowsPublished: false,
      connectionTest: false,
      providerActive: false,
    });
    assert.equal(result.state, "pending");
    assert.equal(result.missingCount, 4);
    assert.deepEqual(
      result.steps.filter((step) => !step.ready).map((step) => step.code),
      ["outbound_signature", "dispatcher", "workflows", "connection_test"]
    );
  });

  await t.test(
    "una prueba con callback queda lista pero no operativa mientras sigue mock",
    () => {
      const ready = buildN8nDiagnostic({
        endpoint: true,
        outboundSignature: true,
        callbackSignature: true,
        dispatcher: true,
        workflowsPublished: true,
        connectionTest: true,
        providerActive: false,
      });
      const active = buildN8nDiagnostic({
        endpoint: true,
        outboundSignature: true,
        callbackSignature: true,
        dispatcher: true,
        workflowsPublished: true,
        connectionTest: true,
        providerActive: true,
      });
      assert.equal(ready.state, "ready");
      assert.equal(active.state, "operational");
    }
  );

  await t.test("la configuración pública nunca contiene el App Secret", () => {
    const snapshot = {
      META_APP_ID: process.env.META_APP_ID,
      META_APP_SECRET: process.env.META_APP_SECRET,
      META_EMBEDDED_SIGNUP_CONFIG_ID:
        process.env.META_EMBEDDED_SIGNUP_CONFIG_ID,
      META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
      CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    };
    try {
      delete process.env.META_APP_ID;
      delete process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
      const pending = getMetaEmbeddedSignupPublicConfiguration();
      assert.equal(pending.available, false);
      assert.deepEqual(pending.missingCategories, [
        "meta_application",
        "embedded_signup_configuration",
      ]);

      process.env.META_APP_ID = "123456789012345";
      process.env.META_APP_SECRET = "test-only-secret-never-returned";
      process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = "223456789012345";
      process.env.META_GRAPH_API_VERSION = "v23.0";
      process.env.CREDENTIALS_ENCRYPTION_KEY = "00".repeat(32);
      const configured = getMetaEmbeddedSignupPublicConfiguration();
      assert.equal(configured.available, true);
      assert.deepEqual(Object.keys(configured).sort(), [
        "appId",
        "available",
        "configurationId",
        "graphApiVersion",
        "missingCategories",
      ]);
      assert.doesNotMatch(
        JSON.stringify(configured),
        /test-only-secret|00{20}/
      );
    } finally {
      restoreEnv(snapshot);
    }
  });
});
