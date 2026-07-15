import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import {
  getAIProviderMode,
  isAgentConfigured,
} from "@/server/agent/openai";
import { isWhatsappDevMode } from "@/server/whatsapp/config";
import {
  CredentialsEncryptionError,
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";
import { nextDeliveryStatus } from "@/server/whatsapp/delivery";
import {
  MetaApiError,
  sendWhatsappTemplateMessage,
  sendWhatsappTextMessage,
  testWhatsappConnection,
} from "@/server/whatsapp/meta-client";
import { parseWhatsappWebhookPayload } from "@/server/whatsapp/parser";
import { ingestWhatsappWebhookEvents } from "@/server/whatsapp/processing";
import {
  verifyWhatsappSignature,
  verifyWhatsappVerifyToken,
} from "@/server/whatsapp/signature";
import type {
  ResolvedWhatsappIntegration,
  WhatsappInboundEvent,
  WhatsappStatusEvent,
  WhatsappWebhookEvent,
} from "@/server/whatsapp/types";
import {
  handleWhatsappWebhookPost,
  handleWhatsappWebhookVerification,
} from "@/server/whatsapp/webhook-http";

const FAKE_APP_SECRET = "unit-test-meta-app-secret";
const FAKE_ACCESS_TOKEN = "unit-test-access-token-long-enough";
const FAKE_PHONE_NUMBER_ID = "123456789012345";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) setEnv(name, value);
}

function signatureFor(body: string, secret = FAKE_APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function webhookPayload(value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-test",
        changes: [{ field: "messages", value }],
      },
    ],
  };
}

test("GET del webhook devuelve el challenge solo con token correcto", async () => {
  const previous = process.env.WHATSAPP_VERIFY_TOKEN;
  process.env.WHATSAPP_VERIFY_TOKEN = "unit-verify-token";

  try {
    const valid = handleWhatsappWebhookVerification(
      new Request(
        "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=unit-verify-token&hub.challenge=challenge-123"
      )
    );
    assert.equal(valid.status, 200);
    assert.equal(await valid.text(), "challenge-123");

    const invalid = handleWhatsappWebhookVerification(
      new Request(
        "http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123"
      )
    );
    assert.equal(invalid.status, 403);
    assert.notEqual(await invalid.text(), "challenge-123");
  } finally {
    setEnv("WHATSAPP_VERIFY_TOKEN", previous);
  }
});

test("POST acepta firma valida y rechaza firma invalida sin tocar la DB", async () => {
  const previousSecret = process.env.META_APP_SECRET;
  const previousWarn = console.warn;
  process.env.META_APP_SECRET = FAKE_APP_SECRET;
  console.warn = () => undefined;
  const rawBody = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [],
  });

  try {
    let scheduled = 0;
    const valid = await handleWhatsappWebhookPost(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": signatureFor(rawBody),
        },
        body: rawBody,
      }),
      () => {
        scheduled += 1;
      }
    );
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { received: true });
    assert.equal(scheduled, 0);

    const invalid = await handleWhatsappWebhookPost(
      new Request("http://localhost/api/webhooks/whatsapp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        },
        body: rawBody,
      }),
      () => {
        scheduled += 1;
      }
    );
    assert.equal(invalid.status, 401);
    assert.equal(scheduled, 0);
  } finally {
    console.warn = previousWarn;
    setEnv("META_APP_SECRET", previousSecret);
  }
});

test("AES-256-GCM hace roundtrip y rechaza ciphertext alterado", () => {
  const key = "42".repeat(32);
  const token = "fake-access-token-for-aes-roundtrip";
  const encrypted = encryptAccessToken(token, key);

  assert.match(encrypted, /^v1\./);
  assert.notEqual(encrypted, token);
  assert.equal(decryptAccessToken(encrypted, key), token);

  const parts = encrypted.split(".");
  const ciphertext = parts[3] ?? "";
  parts[3] = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("A") ? "B" : "A"}`;
  assert.throws(
    () => decryptAccessToken(parts.join("."), key),
    CredentialsEncryptionError
  );
});

test("HMAC y verify token usan comparaciones seguras", () => {
  const body = Buffer.from('{"event":"unit-test"}', "utf8");
  const validSignature = signatureFor(body.toString("utf8"));

  assert.equal(
    verifyWhatsappSignature(body, validSignature, FAKE_APP_SECRET),
    true
  );
  assert.equal(
    verifyWhatsappSignature(
      body,
      `sha256=${"f".repeat(64)}`,
      FAKE_APP_SECRET
    ),
    false
  );
  assert.equal(verifyWhatsappVerifyToken("same-token", "same-token"), true);
  assert.equal(verifyWhatsappVerifyToken("wrong-token", "same-token"), false);
});

test("parser convierte texto y medios a contenido descriptivo y metadata minima", () => {
  const from = "5491112345678";
  const events = parseWhatsappWebhookPayload(
    webhookPayload({
      messaging_product: "whatsapp",
      metadata: { phone_number_id: FAKE_PHONE_NUMBER_ID },
      contacts: [{ wa_id: from, profile: { name: "  Ana Test  " } }],
      messages: [
        {
          id: "wamid.text",
          from,
          timestamp: "1710000000",
          type: "text",
          text: { body: "  Hola desde WhatsApp  " },
        },
        {
          id: "wamid.audio",
          from,
          type: "audio",
          audio: { id: "media-audio", mime_type: "audio/ogg" },
        },
        {
          id: "wamid.image",
          from,
          type: "image",
          image: {
            id: "media-image",
            mime_type: "image/jpeg",
            caption: "  Foto del producto  ",
          },
        },
        {
          id: "wamid.document",
          from,
          type: "document",
          document: { id: "media-document", filename: "lista.pdf" },
        },
        {
          id: "wamid.sticker",
          from,
          type: "sticker",
          sticker: { id: "media-sticker", mime_type: "image/webp" },
        },
        {
          id: "wamid.location",
          from,
          type: "location",
          location: {
            latitude: -34.6037,
            longitude: -58.3816,
            name: "Obelisco",
            address: "Buenos Aires",
          },
        },
      ],
    })
  );

  assert.equal(events.length, 6);
  assert.equal(events[0]?.kind, "message");
  if (events[0]?.kind !== "message") assert.fail("Se esperaba texto");
  assert.equal(events[0].customerName, "Ana Test");
  assert.equal(events[0].content, "Hola desde WhatsApp");
  assert.deepEqual(
    events.map((event) => (event.kind === "message" ? event.content : "")),
    [
      "Hola desde WhatsApp",
      "[Audio recibido]",
      "[Imagen recibida] Foto del producto",
      "[Documento recibido: lista.pdf]",
      "[Sticker recibido]",
      "[Ubicación recibida] Obelisco · Buenos Aires",
    ]
  );
  const image = events[2];
  if (image?.kind !== "message") assert.fail("Se esperaba imagen");
  assert.deepEqual(image.metadata.media, {
    id: "media-image",
    mimeType: "image/jpeg",
  });
});

test("parser reconoce sent, delivered, read y failed", () => {
  const events = parseWhatsappWebhookPayload(
    webhookPayload({
      messaging_product: "whatsapp",
      metadata: { phone_number_id: FAKE_PHONE_NUMBER_ID },
      statuses: [
        { id: "wamid.1", status: "sent", timestamp: "1" },
        { id: "wamid.2", status: "delivered", timestamp: "2" },
        { id: "wamid.3", status: "read", timestamp: "3" },
        {
          id: "wamid.4",
          status: "failed",
          timestamp: "4",
          errors: [{ code: 131026, title: "raw detail ignored" }],
        },
      ],
    })
  );

  assert.deepEqual(
    events.map((event) =>
      event.kind === "status" ? event.deliveryStatus : null
    ),
    ["SENT", "DELIVERED", "READ", "FAILED"]
  );
  const failed = events[3];
  if (failed?.kind !== "status") assert.fail("Se esperaba estado failed");
  assert.equal(failed.errorCode, "131026");
  assert.equal(
    failed.errorMessage,
    "WhatsApp informó que el mensaje no pudo entregarse."
  );
  assert.doesNotMatch(failed.errorMessage ?? "", /raw detail/i);
});

test("estados de entrega avanzan sin retroceder", () => {
  assert.equal(nextDeliveryStatus(null, "SENT"), "SENT");
  assert.equal(nextDeliveryStatus("SENT", "DELIVERED"), "DELIVERED");
  assert.equal(nextDeliveryStatus("DELIVERED", "READ"), "READ");
  assert.equal(nextDeliveryStatus("READ", "DELIVERED"), "READ");
  assert.equal(nextDeliveryStatus("DELIVERED", "SENT"), "DELIVERED");
  assert.equal(nextDeliveryStatus("SENT", "FAILED"), "FAILED");
  assert.equal(nextDeliveryStatus("DELIVERED", "FAILED"), "DELIVERED");
  assert.equal(nextDeliveryStatus("FAILED", "READ"), "FAILED");
});

test("ingest usa tenant resuelto, ignora desconocidos y duplicados y aplica status", async () => {
  const integration: ResolvedWhatsappIntegration = {
    id: "integration-1",
    organizationId: "organization-1",
    phoneNumberId: FAKE_PHONE_NUMBER_ID,
    displayPhoneNumber: "+54 9 11 1234-5678",
    encryptedAccessToken: "encrypted-placeholder",
    status: "CONNECTED",
  };
  const message = (id: string, phoneNumberId = FAKE_PHONE_NUMBER_ID) =>
    ({
      kind: "message",
      phoneNumberId,
      externalMessageId: id,
      from: "5491112345678",
      customerName: "Cliente Test",
      timestamp: null,
      messageType: "text",
      content: `Mensaje ${id}`,
      metadata: { source: "whatsapp" },
    }) satisfies WhatsappInboundEvent;
  const status = {
    kind: "status",
    phoneNumberId: FAKE_PHONE_NUMBER_ID,
    externalMessageId: "wamid.outbound",
    timestamp: null,
    deliveryStatus: "FAILED",
    errorCode: "131026",
    errorMessage: "No entregado",
  } satisfies WhatsappStatusEvent;
  const events: WhatsappWebhookEvent[] = [
    message("wamid.new"),
    message("wamid.duplicate"),
    message("wamid.unknown", "999999999999999"),
    status,
  ];

  const resolved: string[] = [];
  const persisted: string[] = [];
  const statusCalls: string[] = [];
  const touched: string[] = [];
  const unknown: string[] = [];
  const audits: string[] = [];

  const jobs = await ingestWhatsappWebhookEvents(events, {
    resolveIntegration: async (phoneNumberId) => {
      resolved.push(phoneNumberId);
      return phoneNumberId === FAKE_PHONE_NUMBER_ID ? integration : null;
    },
    persistIncoming: async (event, scope) => {
      persisted.push(event.externalMessageId);
      assert.equal(scope.organizationId, integration.organizationId);
      assert.equal(scope.integrationId, integration.id);
      if (event.externalMessageId === "wamid.duplicate") {
        return {
          duplicate: true,
          conversationId: "conversation-duplicate",
          messageId: "message-duplicate",
        };
      }
      return {
        duplicate: false,
        organizationId: integration.organizationId,
        integrationId: integration.id,
        conversationId: "conversation-1",
        messageId: "message-1",
        handlingMode: "AI",
        content: event.content,
      };
    },
    applyStatus: async (event, organizationId) => {
      statusCalls.push(event.externalMessageId);
      assert.equal(organizationId, integration.organizationId);
      return {
        found: true,
        changed: true,
        organizationId,
        messageId: "message-outbound",
        deliveryStatus: event.deliveryStatus,
      };
    },
    touchIntegration: async (integrationId) => {
      touched.push(integrationId);
    },
    audit: async (input) => {
      audits.push(input.action);
    },
    onUnknownNumber: (phoneNumberId) => {
      unknown.push(phoneNumberId);
    },
  });

  assert.deepEqual(resolved.sort(), [FAKE_PHONE_NUMBER_ID, "999999999999999"].sort());
  assert.deepEqual(persisted, ["wamid.new", "wamid.duplicate"]);
  assert.deepEqual(statusCalls, ["wamid.outbound"]);
  assert.deepEqual(unknown, ["999999999999999"]);
  assert.deepEqual(touched, [integration.id]);
  assert.deepEqual(audits, [
    "whatsapp.mensaje_recibido",
    "whatsapp.envio_fallido",
  ]);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]?.event.externalMessageId, "wamid.new");
  assert.equal(jobs[0]?.persisted.organizationId, integration.organizationId);
});

test("roles separan lectura, respuesta y administracion de WhatsApp", () => {
  assert.equal(can("VIEWER", "inbox.respond"), false);
  assert.equal(can("VIEWER", "whatsapp.manage"), false);
  assert.equal(can("AGENT", "inbox.respond"), true);
  assert.equal(can("AGENT", "whatsapp.manage"), false);
  assert.equal(can("ADMIN", "whatsapp.manage"), true);
  assert.equal(can("OWNER", "whatsapp.manage"), true);
});

test("AI_PROVIDER demo, sin clave y compatibilidad openai legacy", () => {
  assert.equal(
    getAIProviderMode({ AI_PROVIDER: "demo", OPENAI_API_KEY: "fake-key" }),
    "demo"
  );
  assert.equal(getAIProviderMode({}), "demo");
  assert.equal(
    getAIProviderMode({ AI_PROVIDER: "openai", OPENAI_API_KEY: "fake-key" }),
    "openai"
  );
  assert.equal(getAIProviderMode({ OPENAI_API_KEY: "legacy-fake-key" }), "openai");
  assert.equal(
    getAIProviderMode({ AI_PROVIDER: "unknown", OPENAI_API_KEY: "fake-key" }),
    "demo"
  );
});

test("isAgentConfigured respeta demo, ausencia de clave y legacy", () => {
  const snapshot = {
    AI_PROVIDER: process.env.AI_PROVIDER,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  try {
    process.env.AI_PROVIDER = "demo";
    process.env.OPENAI_API_KEY = "fake-key";
    assert.equal(isAgentConfigured(), false);

    delete process.env.AI_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    assert.equal(isAgentConfigured(), false);

    process.env.OPENAI_API_KEY = "legacy-fake-key";
    assert.equal(isAgentConfigured(), true);
  } finally {
    restoreEnv(snapshot);
  }
});

test("WHATSAPP_DEV_MODE nunca habilita el simulador en produccion", () => {
  const nodeEnvDescriptor = Object.getOwnPropertyDescriptor(
    process.env,
    "NODE_ENV"
  );
  const nodeEnvValue = process.env.NODE_ENV;
  const previousDevMode = process.env.WHATSAPP_DEV_MODE;
  const setNodeEnv = (value: string) => {
    Object.defineProperty(process.env, "NODE_ENV", {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  };
  try {
    setNodeEnv("development");
    process.env.WHATSAPP_DEV_MODE = "true";
    assert.equal(isWhatsappDevMode(), true);

    process.env.WHATSAPP_DEV_MODE = "false";
    assert.equal(isWhatsappDevMode(), false);

    setNodeEnv("production");
    process.env.WHATSAPP_DEV_MODE = "true";
    assert.equal(isWhatsappDevMode(), false);
  } finally {
    if (nodeEnvDescriptor) {
      Object.defineProperty(process.env, "NODE_ENV", {
        ...nodeEnvDescriptor,
        value: nodeEnvValue,
      });
    } else {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    }
    setEnv("WHATSAPP_DEV_MODE", previousDevMode);
  }
});

test("cliente Meta ejecuta GET y POST sin reintentos ni exponer el token", async () => {
  const previousFetch = globalThis.fetch;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_GRAPH_API_VERSION = "v99.0";
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith(`/${FAKE_PHONE_NUMBER_ID}/messages`)) {
      return Response.json({ messages: [{ id: "wamid.sent" }] });
    }
    return Response.json({
      id: FAKE_PHONE_NUMBER_ID,
      display_phone_number: "+54 9 11 1234-5678",
      verified_name: "Vantix Test",
    });
  }) as typeof fetch;

  try {
    const profile = await testWhatsappConnection({
      phoneNumberId: FAKE_PHONE_NUMBER_ID,
      accessToken: FAKE_ACCESS_TOKEN,
    });
    assert.deepEqual(profile, {
      phoneNumberId: FAKE_PHONE_NUMBER_ID,
      displayPhoneNumber: "+54 9 11 1234-5678",
      verifiedName: "Vantix Test",
    });

    const sent = await sendWhatsappTextMessage({
      phoneNumberId: FAKE_PHONE_NUMBER_ID,
      accessToken: FAKE_ACCESS_TOKEN,
      to: "+5491112345678",
      text: "Hola desde Vantix",
    });
    assert.deepEqual(sent, { messageId: "wamid.sent" });
    assert.equal(calls.length, 2);
    assert.match(calls[0]?.url ?? "", /fields=/);
    assert.equal(calls[0]?.init?.method, "GET");
    assert.equal(calls[1]?.init?.method, "POST");

    const headers = new Headers(calls[1]?.init?.headers);
    assert.equal(headers.get("authorization"), `Bearer ${FAKE_ACCESS_TOKEN}`);
    const body = JSON.parse(String(calls[1]?.init?.body)) as Record<
      string,
      unknown
    >;
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.to, "5491112345678");
    assert.equal(JSON.stringify(calls.map((call) => call.url)).includes(FAKE_ACCESS_TOKEN), false);
  } finally {
    globalThis.fetch = previousFetch;
    setEnv("META_GRAPH_API_VERSION", previousVersion);
  }
});

test("cliente Meta envia una plantilla aprobada con payload exacto", async () => {
  const previousFetch = globalThis.fetch;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_GRAPH_API_VERSION = "v99.0";
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ) => {
    calls.push({ url: String(input), init });
    return Response.json({ messages: [{ id: "wamid.template-sent" }] });
  }) as typeof fetch;

  try {
    const sent = await sendWhatsappTemplateMessage({
      phoneNumberId: FAKE_PHONE_NUMBER_ID,
      accessToken: FAKE_ACCESS_TOKEN,
      to: "+5491112345678",
      templateName: "handoff_alert_v1",
      language: "es_AR",
    });

    assert.deepEqual(sent, { messageId: "wamid.template-sent" });
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      `https://graph.facebook.com/v99.0/${FAKE_PHONE_NUMBER_ID}/messages`
    );
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5491112345678",
      type: "template",
      template: {
        name: "handoff_alert_v1",
        language: { code: "es_AR" },
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    setEnv("META_GRAPH_API_VERSION", previousVersion);
  }
});

test("cliente Meta rechaza destinatario, plantilla e idioma invalidos sin enviar", async () => {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ messages: [{ id: "unexpected" }] });
  }) as typeof fetch;

  const valid = {
    phoneNumberId: FAKE_PHONE_NUMBER_ID,
    accessToken: FAKE_ACCESS_TOKEN,
    to: "+5491112345678",
    templateName: "handoff_alert_v1",
    language: "es_AR",
  };
  const invalidInputs = [
    { ...valid, to: "5491112345678" },
    { ...valid, to: "+0491112345678" },
    { ...valid, templateName: "Handoff_Alert" },
    { ...valid, templateName: "handoff-alert" },
    { ...valid, templateName: "" },
    { ...valid, language: "es-ar" },
    { ...valid, language: "../../es_AR" },
  ];

  try {
    for (const input of invalidInputs) {
      await assert.rejects(
        () => sendWhatsappTemplateMessage(input),
        (error: unknown) => {
          assert.ok(error instanceof MetaApiError);
          assert.equal(error.code, "invalid_request");
          assert.equal(error.safeMessage, "La plantilla de WhatsApp no es valida.");
          assert.doesNotMatch(error.safeMessage, /549111|handoff|\.\.\//i);
          return true;
        }
      );
    }
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("cliente Meta sanitiza errores remotos al enviar plantillas", async () => {
  const previousFetch = globalThis.fetch;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_GRAPH_API_VERSION = "v99.0";
  globalThis.fetch = (async () =>
    Response.json(
      {
        error: {
          code: 100,
          message: "raw-sensitive-template-error-for-5491112345678",
        },
      },
      { status: 400 }
    )) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        sendWhatsappTemplateMessage({
          phoneNumberId: FAKE_PHONE_NUMBER_ID,
          accessToken: FAKE_ACCESS_TOKEN,
          to: "+5491112345678",
          templateName: "handoff_alert_v1",
          language: "es_AR",
        }),
      (error: unknown) => {
        assert.ok(error instanceof MetaApiError);
        assert.equal(error.code, "invalid_request");
        assert.equal(error.metaCode, "100");
        assert.doesNotMatch(
          error.safeMessage,
          /raw-sensitive|549111|handoff_alert|access-token/i
        );
        assert.equal("accessToken" in error, false);
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    setEnv("META_GRAPH_API_VERSION", previousVersion);
  }
});

test("cliente Meta convierte errores remotos en MetaApiError sanitizado", async () => {
  const previousFetch = globalThis.fetch;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_GRAPH_API_VERSION = "v99.0";
  globalThis.fetch = (async () =>
    Response.json(
      {
        error: {
          code: 190,
          message: "raw-sensitive-error-that-must-not-leak",
        },
      },
      { status: 400 }
    )) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        testWhatsappConnection({
          phoneNumberId: FAKE_PHONE_NUMBER_ID,
          accessToken: FAKE_ACCESS_TOKEN,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MetaApiError);
        assert.equal(error.code, "authentication");
        assert.equal(error.metaCode, "190");
        assert.doesNotMatch(error.safeMessage, /raw-sensitive|fake-access/i);
        assert.equal("accessToken" in error, false);
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    setEnv("META_GRAPH_API_VERSION", previousVersion);
  }
});

test("cliente Meta aborta por timeout y no reintenta", async () => {
  const previousFetch = globalThis.fetch;
  const previousSetTimeout = globalThis.setTimeout;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_GRAPH_API_VERSION = "v99.0";
  let calls = 0;

  globalThis.setTimeout = ((
    handler: (...args: unknown[]) => void,
    _delay?: number,
    ...args: unknown[]
  ) => previousSetTimeout(handler, 0, ...args)) as typeof setTimeout;
  globalThis.fetch = (async (
    _input: string | URL | Request,
    init?: RequestInit
  ) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () =>
        testWhatsappConnection({
          phoneNumberId: FAKE_PHONE_NUMBER_ID,
          accessToken: FAKE_ACCESS_TOKEN,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MetaApiError);
        assert.equal(error.code, "timeout");
        assert.equal(error.retryable, true);
        return true;
      }
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.setTimeout = previousSetTimeout;
    setEnv("META_GRAPH_API_VERSION", previousVersion);
  }
});
