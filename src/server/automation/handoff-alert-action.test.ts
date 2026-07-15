import assert from "node:assert/strict";
import { test } from "node:test";
import { completeHandoffRuleConfigSchema } from "@/lib/validations/automation-rules";
import { n8nHandoffAlertActionSchema } from "@/lib/validations/automation-webhooks";
import { handleHandoffAlertRequest } from "@/app/api/webhooks/n8n/actions/send-handoff-alert/route";
import {
  handoffAlertRecipientHash,
  resolveExistingHandoffAlertAction,
} from "@/server/automation/handoff-alert-action";
import { signTimestampedAutomationBody } from "@/server/automation/signature";

const VALID_CONFIG = {
  recipients: "BOTH",
  channel: "WHATSAPP",
  phoneNumbers: ["+12025550123", "+12025550124"],
  templateName: "handoff_alert_test",
  templateLanguage: "es_AR",
};

function signedRequest(input?: {
  body?: string;
  timestamp?: string;
  signature?: string;
  secret?: string;
}) {
  const body =
    input?.body ??
    JSON.stringify({ eventId: "event-1", organizationId: "org-1" });
  const timestamp = input?.timestamp ?? String(Date.now());
  const secret = input?.secret ?? "test-callback-secret";
  const signature =
    input?.signature ?? signTimestampedAutomationBody(body, timestamp, secret);
  return new Request("http://localhost/api/webhooks/n8n/actions/send-handoff-alert", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vantix-timestamp": timestamp,
      "x-vantix-signature": signature,
    },
    body,
  });
}

test("handoff action HTTP: una firma válida autoriza solo eventId y organizationId", async () => {
  let received: unknown;
  const response = await handleHandoffAlertRequest(signedRequest(), {
    getSecret: () => "test-callback-secret",
    execute: async (input) => {
      received = input;
      return {
        ok: true,
        state: "success",
        duplicate: false,
        sentCount: 2,
        callbackRequired: true,
      };
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(received, { eventId: "event-1", organizationId: "org-1" });
  assert.deepEqual(await response.json(), {
    ok: true,
    state: "success",
    duplicate: false,
    callbackRequired: true,
    sentCount: 2,
  });
});

test("handoff action HTTP: rechaza firma inválida o body alterado", async () => {
  let calls = 0;
  const request = signedRequest({
    body: JSON.stringify({ eventId: "event-altered", organizationId: "org-1" }),
    signature: signTimestampedAutomationBody(
      JSON.stringify({ eventId: "event-1", organizationId: "org-1" }),
      String(Date.now()),
      "test-callback-secret"
    ),
  });
  const response = await handleHandoffAlertRequest(request, {
    getSecret: () => "test-callback-secret",
    execute: async () => {
      calls += 1;
      throw new Error("no debe ejecutarse");
    },
  });
  assert.equal(response.status, 401);
  assert.equal(calls, 0);
  assert.deepEqual(await response.json(), { error: "invalid_signature" });
});

test("handoff action HTTP: el timestamp firmado viejo se rechaza", async () => {
  const timestamp = String(Date.now() - 10 * 60 * 1000);
  const response = await handleHandoffAlertRequest(
    signedRequest({ timestamp }),
    {
      getSecret: () => "test-callback-secret",
      execute: async () => {
        throw new Error("no debe ejecutarse");
      },
    }
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "stale_timestamp" });
});

test("handoff action HTTP: no acepta teléfono, texto, token ni campos extra", async () => {
  const payloads = [
    { eventId: "event-1", organizationId: "org-1", phone: "+12025550123" },
    { eventId: "event-1", organizationId: "org-1", text: "mensaje" },
    { eventId: "event-1", organizationId: "org-1", token: "token" },
  ];
  for (const payload of payloads) {
    const body = JSON.stringify(payload);
    const response = await handleHandoffAlertRequest(signedRequest({ body }), {
      getSecret: () => "test-callback-secret",
      execute: async () => {
        throw new Error("no debe ejecutarse");
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_body" });
    assert.equal(n8nHandoffAlertActionSchema.safeParse(payload).success, false);
  }
});

test("handoff config: valida límites E.164, duplicados, plantilla e idioma", () => {
  assert.equal(completeHandoffRuleConfigSchema.safeParse(VALID_CONFIG).success, true);
  const invalid = [
    { ...VALID_CONFIG, phoneNumbers: [] },
    { ...VALID_CONFIG, phoneNumbers: ["2025550123"] },
    { ...VALID_CONFIG, phoneNumbers: ["+12025550123", "+12025550123"] },
    {
      ...VALID_CONFIG,
      phoneNumbers: Array.from(
        { length: 11 },
        (_, index) => `+12025550${String(100 + index)}`
      ),
    },
    { ...VALID_CONFIG, templateName: "" },
    { ...VALID_CONFIG, templateName: "Handoff Alert" },
    { ...VALID_CONFIG, templateLanguage: "../../secret" },
  ];
  for (const config of invalid) {
    assert.equal(completeHandoffRuleConfigSchema.safeParse(config).success, false);
  }
});

test("handoff ledger: clasifica reservas y el hash no correlaciona eventos", () => {
  assert.equal(
    resolveExistingHandoffAlertAction({
      actionClaimedAt: null,
      deliveries: [],
    }),
    "ready"
  );
  assert.equal(
    resolveExistingHandoffAlertAction({
      actionClaimedAt: new Date(),
      deliveries: [{ status: "PROCESSING" }],
    }),
    "in_progress"
  );
  assert.equal(
    resolveExistingHandoffAlertAction({
      actionClaimedAt: new Date(),
      deliveries: [{ status: "SENT" }, { status: "SENT" }],
    }),
    "already_sent"
  );
  assert.equal(
    resolveExistingHandoffAlertAction({
      actionClaimedAt: new Date(),
      deliveries: [{ status: "SENT" }, { status: "FAILED" }],
    }),
    "failed"
  );

  const first = handoffAlertRecipientHash({
    eventId: "event-a",
    phoneNumber: "+12025550123",
    secret: "test-ledger-secret",
  });
  const same = handoffAlertRecipientHash({
    eventId: "event-a",
    phoneNumber: "+12025550123",
    secret: "test-ledger-secret",
  });
  const otherEvent = handoffAlertRecipientHash({
    eventId: "event-b",
    phoneNumber: "+12025550123",
    secret: "test-ledger-secret",
  });
  assert.equal(first, same);
  assert.notEqual(first, otherEvent);
  assert.equal(first.includes("2025550123"), false);
});
