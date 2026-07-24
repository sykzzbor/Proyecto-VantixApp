import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAlerts,
  meter,
  nextPeriodReset,
  type IntegrationStatus,
} from "./overview";
import type { OrganizationEntitlement } from "@/server/billing/entitlement";

function entitlement(
  overrides: Partial<OrganizationEntitlement> = {}
): OrganizationEntitlement {
  return {
    plan: "STANDARD",
    planName: "Standard",
    status: "ACTIVE",
    accessAllowed: true,
    reason: "SUBSCRIPTION_ACTIVE",
    trialStartedAt: null,
    trialEndsAt: null,
    currentPeriodEndsAt: null,
    nextBillingAt: null,
    remainingMs: 0,
    remainingDays: 30,
    remainingHours: 720,
    basePlan: "STANDARD",
    basePlanName: "Standard",
    internalPlanTest: false,
    internalPlanTestStartedAt: null,
    internalPlanTestEndsAt: null,
    ...overrides,
  } as OrganizationEntitlement;
}

const noIntegrations: IntegrationStatus[] = [];

test("el medidor de uso no se pasa del límite ni devuelve restos negativos", () => {
  assert.deepEqual(meter(250, 1_000), {
    used: 250,
    limit: 1_000,
    remaining: 750,
    percent: 25,
  });

  // Consumo por encima del tope (puede ocurrir si el plan bajó de categoría):
  // el restante nunca es negativo y el porcentaje queda tope en 100.
  assert.deepEqual(meter(1_400, 1_000), {
    used: 1_400,
    limit: 1_000,
    remaining: 0,
    percent: 100,
  });

  // Sin límite configurado no se divide por cero.
  assert.deepEqual(meter(10, 0), {
    used: 10,
    limit: 0,
    remaining: 0,
    percent: 0,
  });
});

test("el reinicio de cupo cae el día 1 del mes siguiente, incluso en diciembre", () => {
  assert.equal(
    nextPeriodReset(new Date("2026-07-24T18:00:00Z")).toISOString(),
    "2026-08-01T00:00:00.000Z"
  );
  assert.equal(
    nextPeriodReset(new Date("2026-12-31T23:59:59Z")).toISOString(),
    "2027-01-01T00:00:00.000Z"
  );
});

test("sin suscripción activa la alerta es de bloqueo", () => {
  const alerts = buildAlerts({
    entitlement: entitlement({ accessAllowed: false, status: "EXPIRED" }),
    integrations: noIntegrations,
    conversationsMeter: meter(0, 1_000),
    aiResponsesMeter: meter(0, 5_000),
    pending: 0,
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, "suscripcion");
  assert.equal(alerts[0].severity, "danger");
});

test("la prueba avisa recién en los últimos dos días", () => {
  const lejos = buildAlerts({
    entitlement: entitlement({ status: "TRIALING", remainingDays: 4 }),
    integrations: noIntegrations,
    conversationsMeter: meter(0, 1_000),
    aiResponsesMeter: meter(0, 5_000),
    pending: 0,
  });
  assert.equal(lejos.length, 0);

  const cerca = buildAlerts({
    entitlement: entitlement({ status: "TRIALING", remainingDays: 1 }),
    integrations: noIntegrations,
    conversationsMeter: meter(0, 1_000),
    aiResponsesMeter: meter(0, 5_000),
    pending: 0,
  });
  assert.equal(cerca.length, 1);
  assert.equal(cerca[0].title, "La prueba termina en 1 día");
});

test("el uso del plan alerta al 80% y escala a bloqueo al agotarse", () => {
  const aviso = buildAlerts({
    entitlement: entitlement(),
    integrations: noIntegrations,
    conversationsMeter: meter(800, 1_000),
    aiResponsesMeter: meter(0, 5_000),
    pending: 0,
  });
  assert.equal(aviso.length, 1);
  assert.equal(aviso[0].severity, "warning");
  assert.match(aviso[0].title, /80%/);

  const agotado = buildAlerts({
    entitlement: entitlement(),
    integrations: noIntegrations,
    conversationsMeter: meter(1_000, 1_000),
    aiResponsesMeter: meter(0, 5_000),
    pending: 0,
  });
  assert.equal(agotado.length, 1);
  assert.equal(agotado[0].severity, "danger");

  // Por debajo del umbral no molesta.
  const tranquilo = buildAlerts({
    entitlement: entitlement(),
    integrations: noIntegrations,
    conversationsMeter: meter(500, 1_000),
    aiResponsesMeter: meter(100, 5_000),
    pending: 0,
  });
  assert.equal(tranquilo.length, 0);
});

test("solo las integraciones en error generan alerta, y con el mensaje ya saneado", () => {
  const alerts = buildAlerts({
    entitlement: entitlement(),
    integrations: [
      {
        key: "tiendanube",
        label: "Tiendanube",
        health: "error",
        detail: "El token venció",
        href: "/dashboard/integraciones/tiendanube",
      },
      {
        key: "whatsapp",
        label: "WhatsApp",
        health: "connected",
        detail: "+54 9 11 5555-5555",
        href: "/dashboard/integraciones/whatsapp",
      },
      {
        key: "google-sheets",
        label: "Google Sheets",
        health: "disconnected",
        detail: "Sin conectar",
        href: "/dashboard/integraciones/google-sheets",
      },
    ],
    conversationsMeter: meter(0, 1_000),
    aiResponsesMeter: meter(0, 5_000),
    pending: 0,
  });

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].key, "integracion-tiendanube");
  assert.equal(alerts[0].description, "El token venció");
});
