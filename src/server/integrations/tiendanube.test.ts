import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BILLING_PLANS, planHasFeature } from "@/lib/billing/plans";
import { openAiToolsForCapabilities } from "@/server/agent/providers/openai";
import { toolsForCapabilities } from "@/server/agent/providers/anthropic";
import {
  TiendanubeApiError,
  buildTiendanubeAuthUrl,
  exchangeTiendanubeCode,
  getTiendanubeStore,
  hasRequiredTiendanubeScopes,
  listTiendanubeProducts,
} from "@/server/integrations/tiendanube/api";
import { getTiendanubeConfigurationStatus } from "@/server/integrations/tiendanube/config";
import { sameTiendanubeCustomerIdentity } from "@/server/integrations/tiendanube/agent-tools";
import {
  consumeTiendanubeOAuthState,
  createTiendanubeOAuthState,
  type TiendanubeStateStore,
} from "@/server/integrations/tiendanube/state";
import {
  buildTiendanubeWebhookDedupeKey,
  parseTiendanubeWebhook,
  verifyTiendanubeWebhookSignature,
} from "@/server/integrations/tiendanube/webhook";
import { decryptAccessToken, encryptAccessToken } from "@/server/whatsapp/crypto";

const ENV_KEYS = ["TIENDANUBE_APP_ID", "TIENDANUBE_CLIENT_SECRET", "NEXT_PUBLIC_APP_URL", "BETTER_AUTH_URL"] as const;

async function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, run: () => void | Promise<void>) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      const value = values[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function fetchJson(value: unknown, status = 200, inspect?: (url: string, init: RequestInit | undefined) => void): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    inspect?.(String(input), init);
    return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

test("Tiendanube exige configuración completa y genera el callback seguro", async () => {
  await withEnv({}, () => {
    assert.equal(getTiendanubeConfigurationStatus().configured, false);
  });
  await withEnv({
    TIENDANUBE_APP_ID: "12345",
    TIENDANUBE_CLIENT_SECRET: "private-test-secret",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
  }, () => {
    assert.deepEqual(getTiendanubeConfigurationStatus(), { configured: true, issue: null, message: null });
    const authUrl = new URL(buildTiendanubeAuthUrl("csrf-state"));
    assert.equal(authUrl.origin, "https://www.tiendanube.com");
    assert.equal(authUrl.pathname, "/apps/12345/authorize");
    assert.equal(authUrl.searchParams.get("state"), "csrf-state");
    assert.equal(authUrl.toString().includes("private-test-secret"), false);
  });
});

test("OAuth intercambia el código en servidor y no mezcla IDs del navegador", async () => {
  await withEnv({
    TIENDANUBE_APP_ID: "12345",
    TIENDANUBE_CLIENT_SECRET: "private-test-secret",
    NEXT_PUBLIC_APP_URL: "https://app.example.test",
  }, async () => {
    let body = "";
    const tokens = await exchangeTiendanubeCode("temporary-code", fetchJson({
      access_token: "access-token-only-server",
      token_type: "bearer",
      scope: "read_products,read_customers,read_orders",
      user_id: 98765,
    }, 200, (_url, init) => { body = String(init?.body ?? ""); }));
    assert.deepEqual(tokens, {
      accessToken: "access-token-only-server",
      storeId: "98765",
      scopes: ["read_products", "read_customers", "read_orders"],
    });
    assert.match(body, /temporary-code/);
    assert.equal(JSON.stringify(tokens).includes("private-test-secret"), false);
  });
});

test("el token de Tiendanube se cifra con AES-256-GCM", () => {
  const key = "66".repeat(32);
  const token = "tiendanube-sensitive-access-token";
  const encrypted = encryptAccessToken(token, key);
  assert.notEqual(encrypted, token);
  assert.doesNotMatch(encrypted, /sensitive-access-token/);
  assert.equal(decryptAccessToken(encrypted, key), token);
});

test("el state OAuth vence, es de un solo uso y queda ligado a usuario/organización", async () => {
  let record: (NonNullable<Awaited<ReturnType<TiendanubeStateStore["find"]>>> & { stateHash: string }) | null = null;
  const store: TiendanubeStateStore = {
    async create(data) { record = { id: "state-1", ...data, usedAt: null }; },
    async find(hash) { return record?.stateHash === hash ? record : null; },
    async markUsed(id, now) {
      if (!record || record.id !== id || record.usedAt) return 0;
      record = { ...record, usedAt: now };
      return 1;
    },
  };
  const state = await createTiendanubeOAuthState({ organizationId: "org-a", userId: "user-a" }, store);
  assert.deepEqual(await consumeTiendanubeOAuthState({ state, organizationId: "org-b", userId: "user-a" }, store), { ok: false });
  assert.deepEqual(await consumeTiendanubeOAuthState({ state, organizationId: "org-a", userId: "user-a" }, store), { ok: true, organizationId: "org-a" });
  assert.deepEqual(await consumeTiendanubeOAuthState({ state, organizationId: "org-a", userId: "user-a" }, store), { ok: false });
});

test("la tienda y el catálogo se validan contra la API y usan Bearer sin filtrarlo", async () => {
  await withEnv({ NEXT_PUBLIC_APP_URL: "https://app.example.test" }, async () => {
    let authorization = "";
    const store = await getTiendanubeStore("server-token", "98765", fetchJson({
      id: 98765,
      name: { es: "Mi tienda" },
      original_domain: "mitienda.mitiendanube.com",
      main_language: "es",
    }, 200, (_url, init) => { authorization = String((init?.headers as Record<string, string>)?.Authorization ?? ""); }));
    assert.equal(store.id, "98765");
    assert.equal(authorization, "Bearer server-token");

    const products = await listTiendanubeProducts("server-token", "98765", fetchJson([{
      id: 10,
      name: { es: "Remera" },
      description: { es: "Algodón" },
      handle: { es: "remera" },
      published: true,
      variants: [{ id: 11, sku: "REM-1", price: "1000.00", stock: 4, stock_management: true, values: [] }],
    }]));
    assert.equal(products[0]?.variants[0]?.stock, 4);
    assert.equal(JSON.stringify(products).includes("server-token"), false);
  });
});

test("un 401 exige reconexión y entrega un error sanitizado", async () => {
  await withEnv({ NEXT_PUBLIC_APP_URL: "https://app.example.test" }, async () => {
    await assert.rejects(
      () => getTiendanubeStore("rejected-token", "98765", fetchJson({ error: "raw-sensitive-detail" }, 401)),
      (error) => error instanceof TiendanubeApiError && error.code === "authorization_expired" && !error.message.includes("raw-sensitive-detail")
    );
  });
});

test("webhook valida body crudo, firma y payload", () => {
  const raw = JSON.stringify({ store_id: 98765, event: "product/updated", id: 10 });
  const signature = createHmac("sha256", "webhook-secret").update(raw).digest("hex");
  assert.equal(verifyTiendanubeWebhookSignature(raw, signature, "webhook-secret"), true);
  assert.equal(verifyTiendanubeWebhookSignature(`${raw} `, signature, "webhook-secret"), false);
  assert.deepEqual(parseTiendanubeWebhook(raw), { store_id: "98765", event: "product/updated", id: "10" });
});

test("la clave idempotente agrupa retries inmediatos sin bloquear eventos futuros", () => {
  const raw = JSON.stringify({ store_id: 1, event: "order/updated", id: 2 });
  const now = new Date("2026-07-23T12:01:00.000Z");
  const one = buildTiendanubeWebhookDedupeKey(raw, "a".repeat(64), now);
  assert.equal(one, buildTiendanubeWebhookDedupeKey(raw, "a".repeat(64), new Date("2026-07-23T12:04:00.000Z")));
  assert.notEqual(one, buildTiendanubeWebhookDedupeKey(raw, "a".repeat(64), new Date("2026-07-23T12:06:00.000Z")));
});

test("Tiendanube queda bloqueado en Trial y Standard y habilitado desde Profesional", () => {
  assert.equal(planHasFeature("PROFESSIONAL", "TRIALING", "tiendanube"), false);
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "tiendanube"), false);
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "tiendanube"), true);
  assert.equal(planHasFeature("ENTERPRISE", "ACTIVE", "tiendanube"), true);
});

test("el agente solo recibe las tools de Tiendanube cuando la conexión está habilitada", () => {
  for (const tools of [toolsForCapabilities({ commerce: false }), openAiToolsForCapabilities({ commerce: false })]) {
    assert.equal(tools.some((tool) => tool.name === "search_store_products"), false);
    assert.equal(tools.some((tool) => tool.name === "get_store_order_status"), false);
  }
  for (const tools of [toolsForCapabilities({ commerce: true }), openAiToolsForCapabilities({ commerce: true })]) {
    assert.equal(tools.some((tool) => tool.name === "search_store_products"), true);
    assert.equal(tools.some((tool) => tool.name === "get_store_order_status"), true);
  }
});

test("un pedido solo se asocia al cliente por email o teléfono coincidente", () => {
  assert.equal(sameTiendanubeCustomerIdentity({
    conversationEmail: "Cliente@Example.com ",
    conversationPhone: null,
    storeEmail: "cliente@example.com",
    storePhone: null,
  }), true);
  assert.equal(sameTiendanubeCustomerIdentity({
    conversationEmail: null,
    conversationPhone: "+54 9 351 555-1234",
    storeEmail: null,
    storePhone: "5493515551234",
  }), true);
  assert.equal(sameTiendanubeCustomerIdentity({
    conversationEmail: "otro@example.com",
    conversationPhone: "+54 9 351 555-9999",
    storeEmail: "cliente@example.com",
    storePhone: "+54 9 351 555-1234",
  }), false);
  assert.equal(sameTiendanubeCustomerIdentity({
    conversationEmail: null,
    conversationPhone: null,
    storeEmail: null,
    storePhone: null,
  }), false);
});

test("los precios comerciales quedan en USD 89, 179 y 349", () => {
  assert.deepEqual(
    [BILLING_PLANS.STANDARD.usdMonthly, BILLING_PLANS.PROFESSIONAL.usdMonthly, BILLING_PLANS.ENTERPRISE.usdMonthly],
    [89, 179, 349]
  );
});

test("la migración impone unicidad por tienda y claves multiempresa", () => {
  const sql = readFileSync("prisma/migrations/20260723120000_tiendanube_integration/migration.sql", "utf8");
  assert.match(sql, /tiendanube_connections_storeId_key/);
  assert.match(sql, /tiendanube_products_organizationId_externalId_key/);
  assert.match(sql, /tiendanube_sync_runs_organizationId_idempotencyKey_key/);
  assert.match(sql, /FOREIGN KEY \("organizationId", "productId"\)/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);
});

test("los scopes de lectura deben estar completos", () => {
  assert.equal(hasRequiredTiendanubeScopes(["read_products", "read_customers", "read_orders"]), true);
  assert.equal(hasRequiredTiendanubeScopes(["read_products", "read_orders"]), false);
});
