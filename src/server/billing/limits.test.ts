import assert from "node:assert/strict";
import test from "node:test";
import {
  BILLING_PLANS,
  TRIAL_RULES,
  planHasFeature,
  resolvePlanRules,
  type PlanFeature,
} from "@/lib/billing/plans";
import { convertUsdToArs } from "@/lib/plans-pricing";
import {
  consumeUsage,
  getPlanRules,
  hasPlanFeature,
  usagePeriodKey,
  UsageLimitError,
  type UsageMetric,
  type UsageStore,
} from "@/server/billing/rules";
import {
  evaluateOrganizationEntitlement,
  type OrganizationEntitlement,
  type SubscriptionForEntitlement,
} from "@/server/billing/entitlement";
import { SubscriptionRequiredError } from "@/server/billing/entitlement";

const NOW = new Date("2026-07-20T12:00:00.000Z");

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

function entitlementFor(
  overrides: Partial<SubscriptionForEntitlement> = {}
): OrganizationEntitlement {
  return evaluateOrganizationEntitlement("org-1", subscription(overrides), NOW);
}

/** Store en memoria con la misma semántica atómica que la implementación real. */
function memoryStore(initial: Record<string, number> = {}) {
  const rows = new Map<string, { conversationsCount: number; aiResponsesCount: number }>();
  const key = (organizationId: string, periodKey: string) =>
    `${organizationId}:${periodKey}`;
  const column = (metric: UsageMetric) =>
    metric === "conversations" ? "conversationsCount" : "aiResponsesCount";

  const store: UsageStore = {
    async read(organizationId, periodKey) {
      return rows.get(key(organizationId, periodKey)) ?? null;
    },
    async incrementIfBelow({ organizationId, periodKey, metric, amount, limit }) {
      const id = key(organizationId, periodKey);
      const row =
        rows.get(id) ??
        ({
          conversationsCount: initial.conversationsCount ?? 0,
          aiResponsesCount: initial.aiResponsesCount ?? 0,
        } as const);
      const current = { ...row };
      const field = column(metric);
      if (current[field] > limit - amount) {
        rows.set(id, current);
        return 0;
      }
      current[field] += amount;
      rows.set(id, current);
      return 1;
    },
    async decrement({ organizationId, periodKey, metric, amount }) {
      const id = key(organizationId, periodKey);
      const row = rows.get(id);
      if (!row) return;
      const field = column(metric);
      row[field] = Math.max(0, row[field] - amount);
      rows.set(id, row);
    },
  };
  return { store, rows, key };
}

// ============================================================
// Planes: precios, límites y funciones
// ============================================================

test("los tres planes fijan los límites de la especificación", () => {
  assert.deepEqual(BILLING_PLANS.STANDARD.limits, {
    businesses: 1,
    users: 3,
    conversationsPerMonth: 1_000,
    aiResponsesPerMonth: 5_000,
  });
  assert.deepEqual(BILLING_PLANS.PROFESSIONAL.limits, {
    businesses: 3,
    users: 10,
    conversationsPerMonth: 5_000,
    aiResponsesPerMonth: 25_000,
  });
  assert.deepEqual(BILLING_PLANS.ENTERPRISE.limits, {
    businesses: 10,
    users: 30,
    conversationsPerMonth: 20_000,
    aiResponsesPerMonth: 100_000,
  });
});

test("Empresarial cuesta USD 349 y se convierte a pesos con la cotización", () => {
  assert.equal(BILLING_PLANS.ENTERPRISE.usdMonthly, 349);
  assert.equal(convertUsdToArs(349, 1_500), 524_000);
  assert.equal(convertUsdToArs(349, 1_237), 432_000);
});

test("cada plan habilita exactamente las funciones que corresponden", () => {
  // Standard: sin ecommerce ni avanzadas.
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "google_calendar"), true);
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "google_sheets"), true);
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "tiendanube"), false);
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "woocommerce"), false);
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "advanced_metrics"), false);

  // Profesional: suma ecommerce, avanzadas, métricas y auditoría.
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "tiendanube"), true);
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "woocommerce"), true);
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "advanced_automations"), true);
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "roles_audit"), true);
  // Pero no lo exclusivo de Empresarial.
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "multi_whatsapp"), false);
  assert.equal(planHasFeature("PROFESSIONAL", "ACTIVE", "custom_integrations"), false);

  // Empresarial: todo.
  for (const feature of BILLING_PLANS.ENTERPRISE.featureSet) {
    assert.equal(planHasFeature("ENTERPRISE", "ACTIVE", feature), true);
  }
  assert.equal(planHasFeature("ENTERPRISE", "ACTIVE", "priority_support"), true);
});

test("los planes son acumulativos: Profesional incluye todo Standard", () => {
  for (const feature of BILLING_PLANS.STANDARD.featureSet) {
    assert.equal(
      BILLING_PLANS.PROFESSIONAL.featureSet.has(feature),
      true,
      `Profesional debe incluir ${feature}`
    );
    assert.equal(BILLING_PLANS.ENTERPRISE.featureSet.has(feature), true);
  }
});

// ============================================================
// Prueba: reglas propias, más restrictivas que cualquier plan
// ============================================================

test("durante la prueba rigen los topes de la prueba, no los del plan", () => {
  const trial = entitlementFor({ status: "TRIALING" });
  assert.equal(trial.status, "TRIALING");
  const rules = getPlanRules(trial);
  assert.deepEqual(rules.limits, {
    businesses: 1,
    users: 1,
    conversationsPerMonth: 50,
    aiResponsesPerMonth: 300,
  });
  // Aunque el plan de la fila sea STANDARD, que sí incluye Calendar.
  assert.equal(BILLING_PLANS.STANDARD.featureSet.has("google_calendar"), true);
  assert.equal(hasPlanFeature(trial, "google_calendar"), false);
});

test("la prueba bloquea Calendar, Sheets, Tiendanube y WooCommerce", () => {
  const trial = entitlementFor({ status: "TRIALING" });
  const bloqueadas: PlanFeature[] = [
    "google_calendar",
    "google_sheets",
    "tiendanube",
    "woocommerce",
  ];
  for (const feature of bloqueadas) {
    assert.equal(hasPlanFeature(trial, feature), false, feature);
  }
  // Lo que sí incluye: WhatsApp y chat de prueba.
  assert.equal(hasPlanFeature(trial, "whatsapp"), true);
  assert.equal(hasPlanFeature(trial, "test_chat"), true);
});

test("al contratar un plan se recuperan las funciones del plan", () => {
  const active = entitlementFor({ status: "ACTIVE", plan: "PROFESSIONAL" });
  assert.equal(active.accessAllowed, true);
  assert.equal(hasPlanFeature(active, "google_calendar"), true);
  assert.equal(hasPlanFeature(active, "tiendanube"), true);
  assert.deepEqual(getPlanRules(active).limits, BILLING_PLANS.PROFESSIONAL.limits);
});

test("resolvePlanRules solo aplica reglas de prueba en TRIALING", () => {
  assert.deepEqual(resolvePlanRules("ENTERPRISE", "TRIALING"), TRIAL_RULES);
  assert.deepEqual(resolvePlanRules("ENTERPRISE", "ACTIVE").limits, {
    businesses: 10,
    users: 30,
    conversationsPerMonth: 20_000,
    aiResponsesPerMonth: 100_000,
  });
});

// ============================================================
// Vencimiento y bloqueo
// ============================================================

test("la prueba vencida bloquea el uso y conserva el plan informado", () => {
  const expired = evaluateOrganizationEntitlement(
    "org-1",
    subscription({ trialEndsAt: new Date("2026-07-19T12:00:00.000Z") }),
    NOW
  );
  assert.equal(expired.accessAllowed, false);
  assert.equal(expired.status, "EXPIRED");
  assert.equal(expired.reason, "TRIAL_EXPIRED");
  assert.equal(expired.remainingMs, 0);
});

test("PAST_DUE, EXPIRED e INCOMPLETE bloquean; ACTIVE permite", () => {
  for (const status of ["PAST_DUE", "EXPIRED", "INCOMPLETE"] as const) {
    assert.equal(entitlementFor({ status }).accessAllowed, false, status);
  }
  assert.equal(entitlementFor({ status: "ACTIVE" }).accessAllowed, true);
});

test("consumeUsage rechaza cuando la suscripción no está vigente", async () => {
  const { store } = memoryStore();
  await assert.rejects(
    consumeUsage(
      {
        organizationId: "org-1",
        metric: "aiResponses",
        entitlement: entitlementFor({ status: "EXPIRED" }),
        now: NOW,
      },
      store
    ),
    SubscriptionRequiredError
  );
});

// ============================================================
// Contadores mensuales
// ============================================================

test("el período se identifica por mes calendario UTC", () => {
  assert.equal(usagePeriodKey(new Date("2026-07-20T12:00:00.000Z")), "2026-07");
  assert.equal(usagePeriodKey(new Date("2026-01-01T00:00:00.000Z")), "2026-01");
  assert.equal(usagePeriodKey(new Date("2026-12-31T23:59:59.000Z")), "2026-12");
});

test("consumeUsage descuenta del cupo y corta exactamente en el límite", async () => {
  const { store } = memoryStore();
  const trial = entitlementFor({ status: "TRIALING" });
  const limit = TRIAL_RULES.limits.aiResponsesPerMonth;

  // Se consumen las 300 respuestas de la prueba.
  for (let i = 0; i < limit; i++) {
    const result = await consumeUsage(
      { organizationId: "org-1", metric: "aiResponses", entitlement: trial, now: NOW },
      store
    );
    assert.equal(result.allowed, true, `iteración ${i}`);
  }

  // La 301 ya no entra.
  const blocked = await consumeUsage(
    { organizationId: "org-1", metric: "aiResponses", entitlement: trial, now: NOW },
    store
  );
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.used, limit);
    assert.equal(blocked.limit, limit);
  }
});

test("con strict el límite lanza UsageLimitError con mensaje claro", async () => {
  const { store } = memoryStore({ aiResponsesCount: 300 });
  await assert.rejects(
    consumeUsage(
      {
        organizationId: "org-1",
        metric: "aiResponses",
        entitlement: entitlementFor({ status: "TRIALING" }),
        now: NOW,
        strict: true,
      },
      store
    ),
    (error: unknown) => {
      assert.ok(error instanceof UsageLimitError);
      assert.equal(error.metric, "aiResponses");
      assert.match(error.message, /respuestas de IA/i);
      // Nunca expone datos internos.
      assert.doesNotMatch(error.message, /org-1|sub-1/);
      return true;
    }
  );
});

test("los contadores se reinician por período sin borrar el mes anterior", async () => {
  const { store, rows, key } = memoryStore();
  const trial = entitlementFor({ status: "TRIALING" });
  const julio = new Date("2026-07-20T12:00:00.000Z");
  const agosto = new Date("2026-08-01T00:00:00.000Z");

  await consumeUsage(
    { organizationId: "org-1", metric: "conversations", entitlement: trial, now: julio },
    store
  );
  await consumeUsage(
    { organizationId: "org-1", metric: "conversations", entitlement: trial, now: agosto },
    store
  );

  // Dos filas distintas: agosto arranca en cero y julio queda intacto.
  assert.equal(rows.get(key("org-1", "2026-07"))?.conversationsCount, 1);
  assert.equal(rows.get(key("org-1", "2026-08"))?.conversationsCount, 1);
  assert.equal(rows.size, 2);
});

test("el cupo agotado de un mes no afecta al mes siguiente", async () => {
  const { store } = memoryStore();
  const trial = entitlementFor({ status: "TRIALING" });
  const julio = new Date("2026-07-20T12:00:00.000Z");
  const limit = TRIAL_RULES.limits.conversationsPerMonth;

  for (let i = 0; i < limit; i++) {
    await consumeUsage(
      { organizationId: "org-1", metric: "conversations", entitlement: trial, now: julio },
      store
    );
  }
  const blocked = await consumeUsage(
    { organizationId: "org-1", metric: "conversations", entitlement: trial, now: julio },
    store
  );
  assert.equal(blocked.allowed, false);

  const nextMonth = await consumeUsage(
    {
      organizationId: "org-1",
      metric: "conversations",
      entitlement: trial,
      now: new Date("2026-08-05T10:00:00.000Z"),
    },
    store
  );
  assert.equal(nextMonth.allowed, true);
});

test("cada organización tiene su propio cupo", async () => {
  const { store } = memoryStore();
  const trial = entitlementFor({ status: "TRIALING" });
  const limit = TRIAL_RULES.limits.conversationsPerMonth;

  for (let i = 0; i < limit; i++) {
    await consumeUsage(
      { organizationId: "org-1", metric: "conversations", entitlement: trial, now: NOW },
      store
    );
  }
  const otra = await consumeUsage(
    { organizationId: "org-2", metric: "conversations", entitlement: trial, now: NOW },
    store
  );
  assert.equal(otra.allowed, true);
});

test("un plan pago tiene mucho más cupo que la prueba", async () => {
  const { store } = memoryStore({ aiResponsesCount: 300 });
  // La prueba ya estaría agotada en 300, pero Standard admite 5.000.
  const result = await consumeUsage(
    {
      organizationId: "org-1",
      metric: "aiResponses",
      entitlement: entitlementFor({ status: "ACTIVE", plan: "STANDARD" }),
      now: NOW,
    },
    store
  );
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.limit, 5_000);
});
