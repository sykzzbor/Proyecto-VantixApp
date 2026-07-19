import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { convertUsdToArs } from "@/lib/plans-pricing";
import { isSubscriptionSafeDashboardPath } from "@/lib/billing/entitlement";
import {
  evaluateOrganizationEntitlement,
  assertActiveOrganizationEntitlement,
  type SubscriptionForEntitlement,
} from "@/server/billing/entitlement";
import {
  buildBillingWebhookIdempotencyKey,
  resolveMercadoPagoStatus,
} from "@/server/billing/state";
import {
  MercadoPagoBillingProvider,
  verifyMercadoPagoWebhookSignature,
} from "@/server/billing/mercado-pago";
import { BillingProviderError, type BillingProviderSubscription } from "@/server/billing/provider";

const NOW = new Date("2026-07-19T12:00:00.000Z");

function subscription(
  overrides: Partial<SubscriptionForEntitlement> = {}
): SubscriptionForEntitlement {
  return {
    id: "sub-1",
    organizationId: "org-1",
    plan: "STANDARD",
    status: "TRIALING",
    trialStartedAt: new Date("2026-07-18T12:00:00.000Z"),
    trialEndsAt: new Date("2026-07-23T12:00:00.000Z"),
    subscriptionStartedAt: null,
    currentPeriodEndsAt: null,
    nextBillingAt: null,
    canceledAt: null,
    endedAt: null,
    ...overrides,
  };
}

function remote(
  overrides: Partial<BillingProviderSubscription> = {}
): BillingProviderSubscription {
  return {
    id: "preapproval-1",
    status: "pending",
    externalReference: "vantix:snapshot-1",
    payerId: "payer-1",
    amountArs: 135_000,
    currency: "ARS",
    nextPaymentAt: new Date("2026-08-19T12:00:00.000Z"),
    startedAt: NOW,
    lastModifiedAt: NOW,
    ...overrides,
  };
}

test("los planes definitivos usan IDs estables, nombres y precios únicos", () => {
  assert.deepEqual(
    Object.values(BILLING_PLANS).map(({ id, name, usdMonthly }) => ({
      id,
      name,
      usdMonthly,
    })),
    [
      { id: "STANDARD", name: "Standard", usdMonthly: 90 },
      { id: "PROFESSIONAL", name: "Profesional", usdMonthly: 179 },
      { id: "ENTERPRISE", name: "Empresarial", usdMonthly: 350 },
    ]
  );
  assert.equal(BILLING_PLANS.PROFESSIONAL.recommended, true);
});

test("convierte y redondea comercialmente los tres planes a ARS", () => {
  assert.equal(convertUsdToArs(90, 1_500), 135_000);
  assert.equal(convertUsdToArs(179, 1_500), 269_000);
  assert.equal(convertUsdToArs(350, 1_500), 525_000);
});

test("la prueba vigente calcula días y horas desde tiempo de servidor", () => {
  const entitlement = evaluateOrganizationEntitlement(
    "org-1",
    subscription(),
    NOW
  );
  assert.equal(entitlement.accessAllowed, true);
  assert.equal(entitlement.status, "TRIALING");
  assert.equal(entitlement.remainingDays, 4);
  assert.equal(entitlement.remainingHours, 96);
});

test("una prueba vencida bloquea sin mutar ni eliminar información", () => {
  const stored = subscription({
    trialEndsAt: new Date("2026-07-19T11:59:59.000Z"),
  });
  const entitlement = evaluateOrganizationEntitlement("org-1", stored, NOW);
  assert.equal(entitlement.accessAllowed, false);
  assert.equal(entitlement.status, "EXPIRED");
  assert.equal(stored.plan, "STANDARD");
  assert.equal(stored.organizationId, "org-1");
  assert.throws(
    () => assertActiveOrganizationEntitlement(entitlement),
    /Elegí un plan/
  );
});

test("ACTIVE permite y PAST_DUE, EXPIRED e INCOMPLETE bloquean", () => {
  assert.equal(
    evaluateOrganizationEntitlement(
      "org-1",
      subscription({ status: "ACTIVE" }),
      NOW
    ).accessAllowed,
    true
  );
  for (const status of ["PAST_DUE", "EXPIRED", "INCOMPLETE"] as const) {
    assert.equal(
      evaluateOrganizationEntitlement(
        "org-1",
        subscription({ status }),
        NOW
      ).accessAllowed,
      false
    );
  }
});

test("CANCELED conserva acceso hasta el final pagado y luego bloquea", () => {
  assert.equal(
    evaluateOrganizationEntitlement(
      "org-1",
      subscription({
        status: "CANCELED",
        currentPeriodEndsAt: new Date("2026-07-20T12:00:00.000Z"),
      }),
      NOW
    ).accessAllowed,
    true
  );
  assert.equal(
    evaluateOrganizationEntitlement(
      "org-1",
      subscription({
        status: "CANCELED",
        currentPeriodEndsAt: new Date("2026-07-18T12:00:00.000Z"),
      }),
      NOW
    ).accessAllowed,
    false
  );
});

test("Planes, facturación/configuración y soporte permanecen accesibles", () => {
  assert.equal(isSubscriptionSafeDashboardPath("/dashboard/planes"), true);
  assert.equal(isSubscriptionSafeDashboardPath("/dashboard/configuracion"), true);
  assert.equal(isSubscriptionSafeDashboardPath("/dashboard/perfil"), true);
  assert.equal(isSubscriptionSafeDashboardPath("/dashboard/ayuda"), true);
  assert.equal(isSubscriptionSafeDashboardPath("/dashboard/conversaciones"), false);
});

test("Mercado Pago aprobado activa y un pago rechazado pasa a PAST_DUE", () => {
  assert.equal(
    resolveMercadoPagoStatus({
      remote: remote({ status: "authorized" }),
      currentStatus: "INCOMPLETE",
      trialEndsAt: NOW,
      now: NOW,
    }),
    "ACTIVE"
  );
  assert.equal(
    resolveMercadoPagoStatus({
      remote: remote({ status: "authorized" }),
      currentStatus: "ACTIVE",
      trialEndsAt: NOW,
      now: NOW,
      eventType: "subscription_authorized_payment:rejected",
    }),
    "PAST_DUE"
  );
});

test("un checkout pendiente no corta una prueba todavía vigente", () => {
  assert.equal(
    resolveMercadoPagoStatus({
      remote: remote({ status: "pending" }),
      currentStatus: "TRIALING",
      trialEndsAt: new Date("2026-07-20T12:00:00.000Z"),
      now: NOW,
    }),
    "TRIALING"
  );
});

test("la clave idempotente repite el mismo webhook y cambia con su versión", () => {
  const first = buildBillingWebhookIdempotencyKey({
    provider: "MERCADO_PAGO",
    eventType: "subscription_preapproval:updated",
    remote: remote(),
  });
  const duplicate = buildBillingWebhookIdempotencyKey({
    provider: "MERCADO_PAGO",
    eventType: "subscription_preapproval:updated",
    remote: remote(),
  });
  const changed = buildBillingWebhookIdempotencyKey({
    provider: "MERCADO_PAGO",
    eventType: "subscription_preapproval:updated",
    remote: remote({ lastModifiedAt: new Date("2026-07-19T13:00:00.000Z") }),
  });
  assert.equal(first, duplicate);
  assert.notEqual(first, changed);
  const nextInvoice = buildBillingWebhookIdempotencyKey({
    provider: "MERCADO_PAGO",
    eventType: "subscription_authorized_payment:approved",
    externalEventId: "invoice-2",
    remote: remote(),
  });
  const previousInvoice = buildBillingWebhookIdempotencyKey({
    provider: "MERCADO_PAGO",
    eventType: "subscription_authorized_payment:approved",
    externalEventId: "invoice-1",
    remote: remote(),
  });
  assert.notEqual(nextInvoice, previousInvoice);
});

test("valida la firma y la antigüedad del webhook de Mercado Pago", () => {
  const ts = String(NOW.getTime());
  const manifest = `id:preapproval-1;request-id:req-1;ts:${ts};`;
  const secret = "webhook-secret-for-tests";
  const signature = createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");
  assert.equal(
    verifyMercadoPagoWebhookSignature({
      signatureHeader: `ts=${ts},v1=${signature}`,
      requestId: "req-1",
      dataId: "preapproval-1",
      secret,
      now: NOW.getTime(),
    }),
    true
  );
  assert.equal(
    verifyMercadoPagoWebhookSignature({
      signatureHeader: `ts=${ts},v1=${signature}`,
      requestId: "req-alterado",
      dataId: "preapproval-1",
      secret,
      now: NOW.getTime(),
    }),
    false
  );
  assert.equal(
    verifyMercadoPagoWebhookSignature({
      signatureHeader: `ts=${ts},v1=${signature}`,
      requestId: "req-1",
      dataId: "preapproval-1",
      secret,
      now: NOW.getTime() + 10 * 60 * 1_000,
    }),
    false
  );
});

function providerEnv() {
  return {
    MERCADO_PAGO_ACCESS_TOKEN: "private-test-token",
    MERCADO_PAGO_STANDARD_PLAN_ID: "standard-plan",
    MERCADO_PAGO_PROFESSIONAL_PLAN_ID: "professional-plan",
    MERCADO_PAGO_ENTERPRISE_PLAN_ID: "enterprise-plan",
  };
}

test("el proveedor crea checkout solo si el importe ARS coincide", async () => {
  let authorization = "";
  const provider = new MercadoPagoBillingProvider({
    env: providerEnv(),
    fetchImpl: (async (_url, init) => {
      authorization = String((init?.headers as Record<string, string>).Authorization);
      return new Response(
        JSON.stringify({
          ...remote(),
          id: "preapproval-1",
          status: "pending",
          external_reference: "vantix:snapshot-1",
          init_point: "https://www.mercadopago.com.ar/subscriptions/checkout",
          auto_recurring: {
            transaction_amount: 135_000,
            currency_id: "ARS",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch,
  });
  const result = await provider.createSubscription({
    plan: "STANDARD",
    payerEmail: "owner@example.test",
    externalReference: "vantix:snapshot-1",
    amountArs: 135_000,
    returnUrl: "https://app.example.test/api/billing/return",
  });
  assert.equal(result.checkoutUrl.startsWith("https://"), true);
  assert.equal(authorization, "Bearer private-test-token");
});

test("el proveedor falla cerrado ante diferencia de importe", async () => {
  const provider = new MercadoPagoBillingProvider({
    env: providerEnv(),
    fetchImpl: (async () =>
      new Response(
        JSON.stringify({
          id: "preapproval-1",
          status: "pending",
          external_reference: "vantix:snapshot-1",
          init_point: "https://www.mercadopago.com.ar/subscriptions/checkout",
          auto_recurring: {
            transaction_amount: 120_000,
            currency_id: "ARS",
          },
        }),
        { status: 201 }
      )) as typeof fetch,
  });
  await assert.rejects(
    provider.createSubscription({
      plan: "STANDARD",
      payerEmail: "owner@example.test",
      externalReference: "vantix:snapshot-1",
      amountArs: 135_000,
      returnUrl: "https://app.example.test/api/billing/return",
    }),
    (error: unknown) =>
      error instanceof BillingProviderError && error.code === "amount_mismatch"
  );
});

test("timeout y rechazo del proveedor devuelven errores sanitizados", async () => {
  const timeoutProvider = new MercadoPagoBillingProvider({
    env: providerEnv(),
    timeoutMs: 1,
    fetchImpl: ((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("secret timeout details")));
      })) as typeof fetch,
  });
  await assert.rejects(
    timeoutProvider.getSubscription("preapproval-1"),
    (error: unknown) =>
      error instanceof BillingProviderError &&
      error.code === "provider_unavailable" &&
      !error.message.includes("secret")
  );

  const rejected = new MercadoPagoBillingProvider({
    env: providerEnv(),
    fetchImpl: (async () =>
      new Response('{"message":"access_token=private-test-token"}', {
        status: 401,
      })) as typeof fetch,
  });
  await assert.rejects(
    rejected.getSubscription("preapproval-1"),
    (error: unknown) =>
      error instanceof BillingProviderError &&
      !error.message.includes("private-test-token") &&
      !error.message.includes("access_token")
  );
});
