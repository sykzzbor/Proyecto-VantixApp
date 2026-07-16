import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { ycloudConnectionSchema } from "@/lib/validations/whatsapp";
import { handleYCloudConnectionRequest } from "@/app/api/integrations/whatsapp/ycloud/route";
import { parseWhatsappWebhookPayload } from "@/server/whatsapp/parser";
import { decryptAccessToken, encryptAccessToken } from "@/server/whatsapp/crypto";
import { ingestWhatsappWebhookEvents } from "@/server/whatsapp/processing";
import type {
  ResolvedWhatsappIntegration,
  WhatsappInboundEvent,
} from "@/server/whatsapp/types";
import {
  resolveYCloudWhatsappAsset,
  sendYCloudTextMessage,
  YCloudApiError,
} from "@/server/whatsapp/ycloud-client";
import {
  toYCloudConnectionError,
  YCloudConnectionError,
} from "@/server/whatsapp/ycloud-connection";
import { parseYCloudWebhookPayload } from "@/server/whatsapp/ycloud-parser";
import { verifyYCloudWebhookSignature } from "@/server/whatsapp/ycloud-signature";
import { handleYCloudWebhookPost } from "@/server/whatsapp/ycloud-webhook-http";

const API_KEY = "test-only-ycloud-api-key-long-enough";
const PHONE = "+5493515550000";
const PHONE_ID = "123456789012345";
const WABA_ID = "223456789012345";
const WEBHOOK_SECRET = "unit-test-ycloud-webhook-secret";
const NOW = new Date("2026-07-15T18:00:00.000Z");

function phonePage(overrides: Record<string, unknown> = {}) {
  return {
    items: [
      {
        id: PHONE_ID,
        phoneNumber: PHONE,
        displayPhoneNumber: "+54 9 351 555-0000",
        wabaId: WABA_ID,
        verifiedName: "Vantix Test",
        status: "CONNECTED",
        ...overrides,
      },
    ],
    offset: 0,
    limit: 100,
    length: 1,
    total: 1,
  };
}

function inboundPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_inbound_1",
    type: "whatsapp.inbound_message.received",
    apiVersion: "v2",
    createTime: "2026-07-15T18:00:00.000Z",
    whatsappInboundMessage: {
      id: "ycloud-message-in-1",
      wamid: "wamid.inbound.1",
      wabaId: WABA_ID,
      from: "+5493515551111",
      fromUserId: "AR.1234",
      to: PHONE,
      customerProfile: { name: "Ana Test" },
      sendTime: "2026-07-15T17:59:59.000Z",
      type: "text",
      text: { body: "Hola desde YCloud" },
    },
    ...overrides,
  };
}

function statusPayload(status: "sent" | "delivered" | "read" | "failed") {
  return {
    id: `evt_status_${status}`,
    type: "whatsapp.message.updated",
    apiVersion: "v2",
    createTime: "2026-07-15T18:01:00.000Z",
    whatsappMessage: {
      id: "ycloud-message-out-1",
      wamid: "wamid.outbound.1",
      wabaId: WABA_ID,
      from: PHONE,
      to: "+5493515551111",
      status,
      externalId: "message-internal-1",
      updateTime: "2026-07-15T18:01:00.000Z",
      ...(status === "failed"
        ? { errorCode: "META_REJECTED", errorMessage: `Bearer ${API_KEY}` }
        : {}),
    },
  };
}

function connectedIntegration(): ResolvedWhatsappIntegration {
  return {
    id: "integration-ycloud",
    organizationId: "organization-a",
    provider: "YCLOUD",
    wabaId: WABA_ID,
    phoneNumberId: PHONE_ID,
    providerPhoneNumber: PHONE,
    displayPhoneNumber: "+54 9 351 555-0000",
    encryptedAccessToken: "encrypted-placeholder",
    status: "CONNECTED",
  };
}

test("cliente YCloud valida API key, número accesible y estado operativo", async (t) => {
  await t.test("resuelve exclusivamente datos devueltos por YCloud", async () => {
    let receivedKey = "";
    const asset = await resolveYCloudWhatsappAsset({
      apiKey: API_KEY,
      phoneNumber: PHONE,
      fetchImpl: (async (_url, init) => {
        receivedKey = new Headers(init?.headers).get("x-api-key") ?? "";
        return Response.json(phonePage());
      }) as typeof fetch,
    });
    assert.equal(receivedKey, API_KEY);
    assert.deepEqual(asset, {
      wabaId: WABA_ID,
      phoneNumberId: PHONE_ID,
      phoneNumber: PHONE,
      displayPhoneNumber: "+54 9 351 555-0000",
      verifiedName: "Vantix Test",
      status: "CONNECTED",
    });
  });

  await t.test("rechaza API key inválida, número inexistente y canal no operativo", async () => {
    await assert.rejects(
      resolveYCloudWhatsappAsset({
        apiKey: API_KEY,
        phoneNumber: PHONE,
        fetchImpl: (async () => new Response("private error", { status: 401 })) as typeof fetch,
      }),
      (error) => error instanceof YCloudApiError && error.code === "authentication"
    );
    await assert.rejects(
      resolveYCloudWhatsappAsset({
        apiKey: API_KEY,
        phoneNumber: PHONE,
        fetchImpl: (async () =>
          Response.json({ ...phonePage(), items: [], length: 0, total: 0 })) as typeof fetch,
      }),
      (error) => error instanceof YCloudApiError && error.code === "number_not_found"
    );
    await assert.rejects(
      resolveYCloudWhatsappAsset({
        apiKey: API_KEY,
        phoneNumber: PHONE,
        fetchImpl: (async () =>
          Response.json(phonePage({ status: "DISCONNECTED" }))) as typeof fetch,
      }),
      (error) =>
        error instanceof YCloudApiError && error.code === "number_not_operational"
    );
  });
});

test("API key YCloud se cifra con AES-256-GCM y no queda en texto plano", () => {
  const encrypted = encryptAccessToken(API_KEY, "55".repeat(32));
  assert.notEqual(encrypted, API_KEY);
  assert.doesNotMatch(encrypted, /test-only-ycloud/i);
  assert.equal(decryptAccessToken(encrypted, "55".repeat(32)), API_KEY);
});

test("cliente YCloud envía texto con externalId y conserva ID YCloud y wamid", async () => {
  let sentBody: Record<string, unknown> = {};
  const result = await sendYCloudTextMessage({
    apiKey: API_KEY,
    from: PHONE,
    to: "+5493515551111",
    text: "Respuesta de Claude",
    externalId: "message-internal-1",
    expectedWabaId: WABA_ID,
    fetchImpl: (async (url, init) => {
      assert.equal(
        String(url),
        "https://api.ycloud.com/v2/whatsapp/messages/sendDirectly"
      );
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        id: "ycloud-message-out-1",
        wamid: "wamid.outbound.1",
        wabaId: WABA_ID,
        from: PHONE,
        status: "accepted",
      });
    }) as typeof fetch,
  });
  assert.deepEqual(sentBody, {
    from: PHONE,
    to: "+5493515551111",
    type: "text",
    text: { body: "Respuesta de Claude" },
    externalId: "message-internal-1",
  });
  assert.deepEqual(result, {
    messageId: "ycloud-message-out-1",
    whatsappMessageId: "wamid.outbound.1",
  });
});

test("sendDirectly clasifica errores por código real de YCloud, no solo por status", async () => {
  const previousError = console.error;
  console.error = () => undefined;
  try {
    const send = (status: number, body: unknown) =>
      sendYCloudTextMessage({
        apiKey: API_KEY,
        from: PHONE,
        to: "+5493515551111",
        text: "Hola",
        externalId: "message-internal-2",
        expectedWabaId: WABA_ID,
        fetchImpl: (async () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
      });

    const cases: Array<{
      status: number;
      providerCode: string;
      expected: string;
      retryable?: boolean;
    }> = [
      { status: 401, providerCode: "UNAUTHORIZED", expected: "authentication" },
      { status: 403, providerCode: "FORBIDDEN", expected: "permission_denied" },
      {
        status: 403,
        providerCode: "BALANCE_INSUFFICIENT",
        expected: "balance_insufficient",
      },
      { status: 403, providerCode: "ACCOUNT_LIMITED", expected: "account_pending" },
      {
        status: 403,
        providerCode: "WHATSAPP_PHONE_NUMBER_UNAVAILABLE",
        expected: "number_not_operational",
      },
      {
        status: 403,
        providerCode: "RECIPIENT_IN_BLOCK_LIST",
        expected: "recipient_invalid",
      },
      {
        status: 403,
        providerCode: "CONTENT_PROHIBITED",
        expected: "content_rejected",
      },
      { status: 400, providerCode: "PARAM_INVALID", expected: "invalid_request" },
      {
        status: 429,
        providerCode: "SENDER_RATE_LIMITED",
        expected: "rate_limited",
        retryable: true,
      },
      {
        status: 503,
        providerCode: "SERVICE_UNAVAILABLE",
        expected: "ycloud_unavailable",
        retryable: true,
      },
    ];
    for (const item of cases) {
      await assert.rejects(
        send(item.status, {
          error: {
            status: item.status,
            code: item.providerCode,
            message: `interno ${API_KEY} https://privado.example`,
            requestId: "req-unit-1",
          },
        }),
        (error) =>
          error instanceof YCloudApiError &&
          error.code === item.expected &&
          error.retryable === (item.retryable ?? false) &&
          error.httpStatus === item.status &&
          error.providerCode === item.providerCode &&
          error.requestId === "req-unit-1" &&
          !/test-only|privado\.example|interno/i.test(error.safeMessage),
        `caso ${item.providerCode}`
      );
    }

    // 403 sin código reconocible NO debe reportarse como API key rechazada.
    await assert.rejects(
      send(403, { detalle: "sin formato de error" }),
      (error) =>
        error instanceof YCloudApiError &&
        error.code === "permission_denied" &&
        !/API key/i.test(error.safeMessage)
    );
    // 401 sin cuerpo sigue siendo autenticación.
    await assert.rejects(
      send(401, "no-json"),
      (error) => error instanceof YCloudApiError && error.code === "authentication"
    );

    // Errores internos de WhatsApp/Meta (error.whatsappApiError).
    await assert.rejects(
      send(400, {
        error: { status: 400, code: "OTRO", whatsappApiError: { code: 131047 } },
      }),
      (error) =>
        error instanceof YCloudApiError && error.code === "message_window_closed"
    );
    await assert.rejects(
      send(400, {
        error: { status: 400, code: "OTRO", whatsappApiError: { code: "135000" } },
      }),
      (error) => error instanceof YCloudApiError && error.code === "whatsapp_error"
    );

    // 200 con status "failed" es un rechazo de WhatsApp, no una respuesta inválida.
    await assert.rejects(
      send(200, { id: "out-1", wabaId: WABA_ID, from: PHONE, status: "failed" }),
      (error) => error instanceof YCloudApiError && error.code === "whatsapp_error"
    );
  } finally {
    console.error = previousError;
  }
});

test("sendDirectly tolera respuesta mínima, verifica wabaId/from y normaliza destino", async () => {
  // Respuesta mínima (sin wabaId/from): el mensaje ya fue enviado; no se
  // etiqueta como fallido.
  const minimal = await sendYCloudTextMessage({
    apiKey: API_KEY,
    from: PHONE,
    to: "+54 9 351 555-1111",
    text: "Hola",
    externalId: "message-internal-3",
    expectedWabaId: WABA_ID,
    fetchImpl: (async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.to, "+5493515551111");
      assert.equal(body.from, PHONE);
      return Response.json({ id: "minimal-1" });
    }) as typeof fetch,
  });
  assert.deepEqual(minimal, { messageId: "minimal-1", whatsappMessageId: null });

  // Si los campos vienen y no coinciden, sigue siendo respuesta inválida.
  await assert.rejects(
    sendYCloudTextMessage({
      apiKey: API_KEY,
      from: PHONE,
      to: "+5493515551111",
      text: "Hola",
      externalId: "message-internal-4",
      expectedWabaId: WABA_ID,
      fetchImpl: (async () =>
        Response.json({ id: "out-2", wabaId: "otra-waba" })) as typeof fetch,
    }),
    (error) => error instanceof YCloudApiError && error.code === "invalid_response"
  );

  // Destinatario no normalizable: error de configuración local, sin llamar a YCloud.
  await assert.rejects(
    sendYCloudTextMessage({
      apiKey: API_KEY,
      from: PHONE,
      to: "0351-555-1111",
      text: "Hola",
      externalId: "message-internal-5",
      expectedWabaId: WABA_ID,
      fetchImpl: (async () => {
        assert.fail("no debería llamar a YCloud");
      }) as typeof fetch,
    }),
    (error) =>
      error instanceof YCloudApiError && error.code === "invalid_configuration"
  );
});

test("firma YCloud valida body crudo, timestamp y anti-replay", () => {
  const raw = JSON.stringify(inboundPayload());
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${timestamp}.${raw}`)
    .digest("hex");
  const header = `t=${timestamp},s=${signature}`;
  assert.equal(
    verifyYCloudWebhookSignature(raw, header, {
      secret: WEBHOOK_SECRET,
      now: NOW,
    }),
    true
  );
  assert.equal(
    verifyYCloudWebhookSignature(`${raw} `, header, {
      secret: WEBHOOK_SECRET,
      now: NOW,
    }),
    false
  );
  assert.equal(
    verifyYCloudWebhookSignature(raw, header, {
      secret: WEBHOOK_SECRET,
      now: new Date(NOW.getTime() + 301_000),
    }),
    false
  );
  assert.equal(
    verifyYCloudWebhookSignature(raw, `t=${timestamp},s=${"0".repeat(64)}`, {
      secret: WEBHOOK_SECRET,
      now: NOW,
    }),
    false
  );
});

test("parser YCloud normaliza inbound y estados sin conservar errores privados", () => {
  const inbound = parseYCloudWebhookPayload(inboundPayload());
  assert.equal(inbound.ignored, false);
  if (inbound.ignored || inbound.event.kind !== "message") assert.fail();
  assert.equal(inbound.event.provider, "YCLOUD");
  assert.equal(inbound.event.externalMessageId, "ycloud-message-in-1");
  assert.equal(inbound.event.whatsappMessageId, "wamid.inbound.1");
  assert.equal(inbound.event.content, "Hola desde YCloud");
  assert.equal(inbound.event.customerName, "Ana Test");
  assert.equal(inbound.event.metadata.whatsappUserId, "AR.1234");

  for (const status of ["sent", "delivered", "read", "failed"] as const) {
    const parsed = parseYCloudWebhookPayload(statusPayload(status));
    assert.equal(parsed.ignored, false);
    if (parsed.ignored || parsed.event.kind !== "status") assert.fail();
    assert.equal(parsed.event.deliveryStatus, status.toUpperCase());
    assert.equal(parsed.event.externalMessageId, "ycloud-message-out-1");
    assert.equal(parsed.event.whatsappMessageId, "wamid.outbound.1");
    assert.equal(parsed.event.internalMessageId, "message-internal-1");
    assert.doesNotMatch(parsed.event.errorMessage ?? "", /Bearer|test-only/i);
  }

  const ignored = parseYCloudWebhookPayload({
    id: "evt_unknown",
    type: "contact.created",
    apiVersion: "v2",
    createTime: "2026-07-15T18:00:00.000Z",
  });
  assert.deepEqual(ignored, {
    ignored: true,
    eventId: "evt_unknown",
    eventType: "contact.created",
  });
});

test("conexión YCloud exige permisos y nunca devuelve la API key ni IDs internos", async () => {
  const makeRequest = (body: unknown) =>
    new Request("https://app.example/api/integrations/whatsapp/ycloud", {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  for (const role of ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const) {
    let calls = 0;
    const response = await handleYCloudConnectionRequest(
      makeRequest({ apiKey: API_KEY, phoneNumber: PHONE }),
      {
        authorize: async (_request, permission) =>
          can(role, permission)
            ? {
                ok: true as const,
                ctx: {
                  userId: `user-${role}`,
                  organizationId: `org-${role}`,
                  role,
                },
              }
            : {
                ok: false as const,
                response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
              },
        connect: async (input) => {
          calls += 1;
          assert.equal(input.organizationId, `org-${role}`);
          return { integrationId: "private-integration-id" };
        },
      }
    );
    assert.equal(response.status, can(role, "whatsapp.manage") ? 200 : 403);
    assert.equal(calls, can(role, "whatsapp.manage") ? 1 : 0);
    if (response.status === 200) {
      const serialized = JSON.stringify(await response.json());
      assert.doesNotMatch(
        serialized,
        /test-only|apiKey|wabaId|phoneNumberId|private-integration-id/i
      );
    }
  }
  assert.equal(
    ycloudConnectionSchema.safeParse({
      apiKey: API_KEY,
      phoneNumber: PHONE,
      organizationId: "attacker-org",
    }).success,
    false
  );
});

test("webhook YCloud es idempotente por event ID y agenda IA una sola vez", async () => {
  const raw = JSON.stringify(inboundPayload());
  const integration = connectedIntegration();
  let receipt = false;
  let ingested = 0;
  let scheduled = 0;
  const dependencies = {
    verifySignature: () => true,
    resolveIntegration: async () => integration,
    receiptExists: async () => receipt,
    recordReceipt: async () => {
      receipt = true;
    },
    ingest: async (events: Parameters<typeof ingestWhatsappWebhookEvents>[0]) => {
      ingested += 1;
      const event = events[0];
      if (!event || event.kind !== "message") return [];
      return [
        {
          integration,
          event,
          persisted: {
            duplicate: false as const,
            organizationId: integration.organizationId,
            integrationId: integration.id,
            conversationId: "conversation-1",
            messageId: "message-1",
            handlingMode: "AI" as const,
            content: event.content,
          },
        },
      ];
    },
  };
  const request = () =>
    new Request("https://app.example/api/webhooks/ycloud", {
      method: "POST",
      headers: { "ycloud-signature": "test" },
      body: raw,
    });
  const first = await handleYCloudWebhookPost(
    request(),
    () => {
      scheduled += 1;
    },
    dependencies
  );
  const duplicate = await handleYCloudWebhookPost(
    request(),
    () => {
      scheduled += 1;
    },
    dependencies
  );
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.equal(ingested, 1);
  assert.equal(scheduled, 1);
  assert.deepEqual(await duplicate.json(), { received: true, duplicate: true });
});

test("webhook YCloud rechaza firma inválida e ignora tenant o evento desconocido", async () => {
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    const invalid = await handleYCloudWebhookPost(
      new Request("https://app.example/api/webhooks/ycloud", {
        method: "POST",
        body: JSON.stringify(inboundPayload()),
      }),
      () => undefined,
      { verifySignature: () => false }
    );
    assert.equal(invalid.status, 401);

    let ingested = 0;
    const otherTenant = await handleYCloudWebhookPost(
      new Request("https://app.example/api/webhooks/ycloud", {
        method: "POST",
        body: JSON.stringify(inboundPayload()),
      }),
      () => undefined,
      {
        verifySignature: () => true,
        resolveIntegration: async () => null,
        ingest: async () => {
          ingested += 1;
          return [];
        },
      }
    );
    assert.equal(otherTenant.status, 200);
    assert.equal(ingested, 0);

    const unknown = await handleYCloudWebhookPost(
      new Request("https://app.example/api/webhooks/ycloud", {
        method: "POST",
        body: JSON.stringify({
          id: "evt_unknown",
          type: "contact.created",
          apiVersion: "v2",
          createTime: "2026-07-15T18:00:00.000Z",
        }),
      }),
      () => undefined,
      { verifySignature: () => true }
    );
    assert.deepEqual(await unknown.json(), { received: true, ignored: true });
  } finally {
    console.warn = previousWarn;
  }
});

test("pipeline compartido genera job para IA, respeta modo humano y aísla WABA", async () => {
  const integration = connectedIntegration();
  const base = parseYCloudWebhookPayload(inboundPayload());
  if (base.ignored || base.event.kind !== "message") assert.fail();
  const aiEvent = base.event;
  const humanEvent: WhatsappInboundEvent = {
    ...aiEvent,
    webhookEventId: "evt-inbound-human",
    externalMessageId: "ycloud-message-human",
  };
  const mismatched: WhatsappInboundEvent = {
    ...aiEvent,
    webhookEventId: "evt-inbound-other-waba",
    externalMessageId: "ycloud-message-other-waba",
    wabaId: "other-waba",
  };
  const persisted: string[] = [];
  const jobs = await ingestWhatsappWebhookEvents(
    [aiEvent, humanEvent, mismatched],
    {
      resolveIntegration: async () => integration,
      persistIncoming: async (event) => {
        persisted.push(event.externalMessageId);
        return {
          duplicate: false as const,
          organizationId: integration.organizationId,
          integrationId: integration.id,
          conversationId: `conversation-${event.externalMessageId}`,
          messageId: `message-${event.externalMessageId}`,
          handlingMode:
            event.externalMessageId === "ycloud-message-human"
              ? ("HUMAN" as const)
              : ("AI" as const),
          content: event.content,
        };
      },
      applyStatus: async () => ({ found: false as const }),
      touchIntegration: async () => undefined,
      audit: async () => undefined,
      onUnknownNumber: () => undefined,
    }
  );
  assert.deepEqual(persisted, ["ycloud-message-in-1", "ycloud-message-human"]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.integration.provider, "YCLOUD");
});

test("errores YCloud quedan sanitizados y Meta conserva su parser", () => {
  const unknown = toYCloudConnectionError(
    new Error(`X-API-Key ${API_KEY} https://private.example/path`)
  );
  assert.equal(unknown.code, "connection_unavailable");
  assert.doesNotMatch(unknown.message, /test-only|private\.example|X-API-Key/i);
  const known = toYCloudConnectionError(
    new YCloudApiError("authentication", "YCloud rechazó la API key.")
  );
  assert.equal(known.code, "ycloud_authentication");
  assert.equal(known.status, 422);
  assert.ok(known instanceof YCloudConnectionError);

  const meta = parseWhatsappWebhookPayload({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PHONE_ID },
              messages: [
                {
                  id: "wamid.meta",
                  from: "5493515551111",
                  type: "text",
                  text: { body: "Meta sigue operativo" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(meta[0]?.provider, "META_CLOUD");
});
