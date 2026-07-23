import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { planHasFeature } from "@/lib/billing/plans";
import { openAiToolsForCapabilities } from "@/server/agent/providers/openai";
import { toolsForCapabilities } from "@/server/agent/providers/anthropic";
import {
  WooCommerceApiError,
  ensureWooCommerceWebhooks,
  listWooCommerceCustomers,
  listWooCommerceOrders,
  listWooCommerceProducts,
  normalizeWooCommerceStoreUrl,
  validateWooCommerceConnection,
} from "@/server/integrations/woocommerce/api";
import { sameWooCommerceCustomerIdentity } from "@/server/integrations/woocommerce/agent-tools";
import {
  buildWooCommerceWebhookDedupeKey,
  parseWooCommerceWebhookResourceId,
  verifyWooCommerceWebhookSignature,
} from "@/server/integrations/woocommerce/webhook";
import {
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";

const CREDENTIALS = {
  storeUrl: "https://shop.example.test",
  consumerKey: `ck_${"a".repeat(40)}`,
  consumerSecret: `cs_${"b".repeat(40)}`,
};

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("WooCommerce valida URL pública y bloquea destinos privados", () => {
  assert.equal(
    normalizeWooCommerceStoreUrl("https://shop.example.test/"),
    "https://shop.example.test"
  );
  assert.equal(
    normalizeWooCommerceStoreUrl("https://example.test/wordpress/"),
    "https://example.test/wordpress"
  );
  assert.throws(
    () => normalizeWooCommerceStoreUrl("http://shop.example.test"),
    WooCommerceApiError
  );
  assert.throws(
    () => normalizeWooCommerceStoreUrl("https://127.0.0.1"),
    WooCommerceApiError
  );
  assert.throws(
    () =>
      normalizeWooCommerceStoreUrl(
        "https://consumer:secret@shop.example.test"
      ),
    WooCommerceApiError
  );
});

test("la conexión valida productos, clientes y pedidos sin filtrar credenciales", async () => {
  const paths: string[] = [];
  const authorizations: string[] = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    paths.push(new URL(String(input)).pathname);
    authorizations.push(
      String((init?.headers as Record<string, string>)?.Authorization ?? "")
    );
    return response([]);
  }) as typeof fetch;
  const result = await validateWooCommerceConnection(CREDENTIALS, fetchImpl);
  assert.deepEqual(paths, [
    "/wp-json/wc/v3/products",
    "/wp-json/wc/v3/customers",
    "/wp-json/wc/v3/orders",
  ]);
  assert.equal(authorizations.every((value) => value.startsWith("Basic ")), true);
  assert.equal(result.storeUrl, CREDENTIALS.storeUrl);
  assert.equal(JSON.stringify(result).includes(CREDENTIALS.consumerSecret), false);
});

test("credenciales inválidas producen un error sanitizado", async () => {
  const fetchImpl = (async () =>
    response(
      {
        code: "woocommerce_rest_cannot_view",
        message: "raw server detail with secret",
      },
      401
    )) as typeof fetch;
  await assert.rejects(
    () => validateWooCommerceConnection(CREDENTIALS, fetchImpl),
    (error) =>
      error instanceof WooCommerceApiError &&
      error.code === "authorization_expired" &&
      !error.message.includes("raw server detail") &&
      !error.message.includes(CREDENTIALS.consumerSecret)
  );
});

test("la sincronización interpreta productos, variantes, clientes y pedidos", async () => {
  const fetchImpl = (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/products/10/variations")) {
      return response([
        {
          id: 11,
          sku: "REM-AZUL",
          price: "1200.00",
          regular_price: "1500.00",
          sale_price: "1200.00",
          manage_stock: true,
          stock_quantity: 4,
          attributes: [{ name: "Color", option: "Azul" }],
        },
      ]);
    }
    if (url.pathname.endsWith("/products")) {
      return response([
        {
          id: 10,
          name: "Remera",
          description: "<p>Algodón</p>",
          slug: "remera",
          status: "publish",
          type: "variable",
          variations: [11],
        },
      ]);
    }
    if (url.pathname.endsWith("/customers")) {
      return response([
        {
          id: 20,
          first_name: "Ana",
          last_name: "Pérez",
          email: "ana@example.test",
          billing: { phone: "+5493515550000" },
          total_spent: "2400.00",
          orders_count: 2,
        },
      ]);
    }
    if (url.pathname.endsWith("/orders")) {
      return response([
        {
          id: 30,
          number: "1001",
          status: "processing",
          currency: "ARS",
          total: "1200.00",
          customer_id: 20,
          billing: {
            first_name: "Ana",
            last_name: "Pérez",
            email: "ana@example.test",
            phone: "+5493515550000",
          },
          line_items: [
            {
              name: "Remera",
              quantity: 1,
              total: "1200.00",
              price: 1200,
              sku: "REM-AZUL",
            },
          ],
        },
      ]);
    }
    return response([], 404);
  }) as typeof fetch;
  const [products, customers, orders] = await Promise.all([
    listWooCommerceProducts(CREDENTIALS, fetchImpl),
    listWooCommerceCustomers(CREDENTIALS, fetchImpl),
    listWooCommerceOrders(CREDENTIALS, fetchImpl),
  ]);
  assert.equal(products[0]?.resolvedVariants[0]?.sku, "REM-AZUL");
  assert.equal(products[0]?.resolvedVariants[0]?.stock_quantity, 4);
  assert.equal(customers[0]?.email, "ana@example.test");
  assert.equal(orders[0]?.number, "1001");
  assert.equal(orders[0]?.line_items[0]?.sku, "REM-AZUL");
});

test("las claves y el secreto de webhook usan AES-256-GCM", () => {
  const encryptionKey = "77".repeat(32);
  for (const value of [
    CREDENTIALS.consumerKey,
    CREDENTIALS.consumerSecret,
    "woocommerce-webhook-secret",
  ]) {
    const encrypted = encryptAccessToken(value, encryptionKey);
    assert.notEqual(encrypted, value);
    assert.equal(encrypted.includes(value), false);
    assert.equal(decryptAccessToken(encrypted, encryptionKey), value);
  }
});

test("los webhooks se registran firmados sin incluir secretos en la URL", async () => {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
  const requests: Array<{ url: string; body: string }> = [];
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/webhooks?")) return response([]);
    requests.push({ url, body: String(init?.body ?? "") });
    return response({
      id: requests.length,
      topic: JSON.parse(String(init?.body)).topic,
      status: "active",
      delivery_url: JSON.parse(String(init?.body)).delivery_url,
    });
  }) as typeof fetch;
  try {
    await ensureWooCommerceWebhooks(
      CREDENTIALS,
      "32ed3b34-cf51-4c87-b844-1f6032d77d6b",
      "only-server-webhook-secret",
      fetchImpl
    );
    assert.equal(requests.length, 9);
    assert.equal(
      requests.every(
        (item) =>
          !item.url.includes("only-server-webhook-secret") &&
          item.body.includes("only-server-webhook-secret")
      ),
      true
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previous;
  }
});

test("webhook valida HMAC sobre body crudo e idempotencia de delivery", () => {
  const raw = JSON.stringify({ id: 123, status: "processing" });
  const signature = createHmac("sha256", "webhook-secret")
    .update(raw)
    .digest("base64");
  assert.equal(
    verifyWooCommerceWebhookSignature(raw, signature, "webhook-secret"),
    true
  );
  assert.equal(
    verifyWooCommerceWebhookSignature(`${raw} `, signature, "webhook-secret"),
    false
  );
  assert.equal(parseWooCommerceWebhookResourceId(raw), "123");
  const first = buildWooCommerceWebhookDedupeKey({
    webhookKey: "key-a",
    topic: "order.updated",
    deliveryId: "delivery-1",
    rawBody: raw,
  });
  assert.equal(
    first,
    buildWooCommerceWebhookDedupeKey({
      webhookKey: "key-a",
      topic: "order.updated",
      deliveryId: "delivery-1",
      rawBody: "{}",
    })
  );
  assert.notEqual(
    first,
    buildWooCommerceWebhookDedupeKey({
      webhookKey: "key-b",
      topic: "order.updated",
      deliveryId: "delivery-1",
      rawBody: raw,
    })
  );
});

test("WooCommerce queda bloqueado en Trial y Standard y habilitado desde Profesional", () => {
  assert.equal(
    planHasFeature("PROFESSIONAL", "TRIALING", "woocommerce"),
    false
  );
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "woocommerce"), false);
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "woocommerce"), true);
  assert.equal(planHasFeature("ENTERPRISE", "ACTIVE", "woocommerce"), true);
});

test("el agente recibe tools WooCommerce solo con la capacidad correspondiente", () => {
  for (const tools of [
    toolsForCapabilities({ commerce: false }),
    openAiToolsForCapabilities({ commerce: false }),
  ]) {
    assert.equal(
      tools.some((tool) => tool.name === "search_woocommerce_products"),
      false
    );
    assert.equal(
      tools.some((tool) => tool.name === "get_woocommerce_order_status"),
      false
    );
  }
  for (const tools of [
    toolsForCapabilities({ woocommerce: true }),
    openAiToolsForCapabilities({ woocommerce: true }),
  ]) {
    assert.equal(
      tools.some((tool) => tool.name === "search_woocommerce_products"),
      true
    );
    assert.equal(
      tools.some((tool) => tool.name === "get_woocommerce_order_status"),
      true
    );
    assert.equal(tools.some((tool) => tool.name === "search_store_products"), false);
  }
});

test("un pedido WooCommerce solo se entrega al cliente coincidente", () => {
  assert.equal(
    sameWooCommerceCustomerIdentity({
      conversationEmail: "Cliente@Example.com ",
      conversationPhone: null,
      orderEmail: "cliente@example.com",
      orderPhone: null,
    }),
    true
  );
  assert.equal(
    sameWooCommerceCustomerIdentity({
      conversationEmail: null,
      conversationPhone: "+54 9 351 555-1234",
      orderEmail: null,
      orderPhone: "5493515551234",
    }),
    true
  );
  assert.equal(
    sameWooCommerceCustomerIdentity({
      conversationEmail: "otro@example.com",
      conversationPhone: "+54 9 351 555-9999",
      orderEmail: "cliente@example.com",
      orderPhone: "+54 9 351 555-1234",
    }),
    false
  );
});

test("la migración es aditiva y fuerza aislamiento multiempresa", () => {
  const sql = readFileSync(
    "prisma/migrations/20260725120000_woocommerce_integration/migration.sql",
    "utf8"
  );
  assert.match(sql, /woocommerce_connections_storeUrl_key/);
  assert.match(sql, /woocommerce_products_organizationId_externalId_key/);
  assert.match(
    sql,
    /woocommerce_sync_runs_organizationId_idempotencyKey_key/
  );
  assert.match(sql, /FOREIGN KEY \("organizationId", "productId"\)/);
  assert.doesNotMatch(sql, /^\s*(?:DROP|TRUNCATE|DELETE)\b/im);

  const connectRoute = readFileSync(
    "src/app/api/integrations/woocommerce/connect/route.ts",
    "utf8"
  );
  assert.match(
    connectRoute,
    /organizationId: authorization\.ctx\.organizationId/
  );
  assert.doesNotMatch(
    connectRoute,
    /organizationId:\s*z\.(?:string|uuid)/
  );
});
