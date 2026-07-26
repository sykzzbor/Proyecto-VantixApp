import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBillingHistory,
  classifyBillingEvent,
  describeBillingEvent,
} from "./history";

// ============================================================
// Clasificación de estados
// ============================================================

test("un cobro aprobado se muestra como aprobado", () => {
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_authorized_payment:approved",
      nextStatus: "ACTIVE",
    }),
    "approved"
  );
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_authorized_payment:accredited",
      nextStatus: "ACTIVE",
    }),
    "approved"
  );
});

test("un cobro pendiente se muestra como pendiente", () => {
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_authorized_payment:pending",
      nextStatus: "INCOMPLETE",
    }),
    "pending"
  );
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_authorized_payment:in_process",
      nextStatus: "ACTIVE",
    }),
    "pending"
  );
});

test("un cobro rechazado se muestra como rechazado", () => {
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_authorized_payment:rejected",
      nextStatus: "PAST_DUE",
    }),
    "rejected"
  );
});

test("una cancelación se muestra como cancelada", () => {
  assert.equal(
    classifyBillingEvent({ eventType: "manual.cancel", nextStatus: "CANCELED" }),
    "canceled"
  );
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_preapproval:cancelled",
      nextStatus: "CANCELED",
    }),
    "canceled"
  );
});

test("el estado del cobro puntual manda sobre el de la suscripción", () => {
  // La suscripción sigue ACTIVE porque el período pago no venció, pero este
  // cobro concreto fue rechazado: el historial tiene que decir "rechazado".
  assert.equal(
    classifyBillingEvent({
      eventType: "subscription_authorized_payment:rejected",
      nextStatus: "ACTIVE",
    }),
    "rejected"
  );
});

test("sin pistas en el tipo, se usa el estado resultante", () => {
  assert.equal(
    classifyBillingEvent({ eventType: "subscription_preapproval:updated", nextStatus: "ACTIVE" }),
    "approved"
  );
  assert.equal(
    classifyBillingEvent({ eventType: "trial.started", nextStatus: "TRIALING" }),
    "other"
  );
});

test("cada movimiento tiene una descripción legible", () => {
  assert.equal(
    describeBillingEvent({
      eventType: "subscription_authorized_payment:approved",
      outcome: "approved",
    }),
    "Cobro de la suscripción"
  );
  assert.equal(
    describeBillingEvent({ eventType: "trial.started", outcome: "other" }),
    "Inicio de la prueba gratuita"
  );
});

// ============================================================
// Armado del historial
// ============================================================

const snapshot = {
  plan: "STANDARD" as const,
  arsAmount: 30000,
  providerAmountArs: null,
  externalSubscriptionId: "mp-1",
  createdAt: new Date("2026-07-01T10:00:00Z"),
};

test("el importe sale del checkout vigente al momento del cobro", () => {
  const historial = buildBillingHistory({
    events: [
      {
        id: "e1",
        eventType: "subscription_authorized_payment:approved",
        nextStatus: "ACTIVE",
        status: "PROCESSED",
        occurredAt: new Date("2026-07-02T10:00:00Z"),
        createdAt: new Date("2026-07-02T10:00:01Z"),
      },
    ],
    snapshots: [snapshot],
  });

  assert.equal(historial.length, 1);
  assert.equal(historial[0]!.amountArs, 30000);
  assert.equal(historial[0]!.currency, "ARS");
  assert.equal(historial[0]!.plan, "STANDARD");
  assert.equal(historial[0]!.outcomeLabel, "Aprobado");
});

test("se usa el importe real cobrado cuando difiere del de lista", () => {
  // En las pruebas técnicas Mercado Pago cobra un importe reducido: el
  // historial tiene que mostrar lo que se cobró, no el precio de lista.
  const historial = buildBillingHistory({
    events: [
      {
        id: "e1",
        eventType: "subscription_authorized_payment:approved",
        nextStatus: "ACTIVE",
        status: "PROCESSED",
        occurredAt: new Date("2026-07-02T10:00:00Z"),
        createdAt: new Date("2026-07-02T10:00:00Z"),
      },
    ],
    snapshots: [{ ...snapshot, providerAmountArs: 100 }],
  });
  assert.equal(historial[0]!.amountArs, 100);
});

test("un movimiento que no es un cobro no inventa importe", () => {
  const historial = buildBillingHistory({
    events: [
      {
        id: "e1",
        eventType: "manual.cancel",
        nextStatus: "CANCELED",
        status: "PROCESSED",
        occurredAt: new Date("2026-07-05T10:00:00Z"),
        createdAt: new Date("2026-07-05T10:00:00Z"),
      },
    ],
    snapshots: [snapshot],
  });
  assert.equal(historial[0]!.amountArs, null);
  assert.equal(historial[0]!.currency, null);
  assert.equal(historial[0]!.outcome, "canceled");
});

test("sin checkout previo el importe queda vacío en vez de estimarse", () => {
  const historial = buildBillingHistory({
    events: [
      {
        id: "e1",
        eventType: "subscription_authorized_payment:approved",
        nextStatus: "ACTIVE",
        status: "PROCESSED",
        occurredAt: new Date("2026-06-01T10:00:00Z"),
        createdAt: new Date("2026-06-01T10:00:00Z"),
      },
    ],
    snapshots: [snapshot], // posterior al evento
  });
  assert.equal(historial[0]!.amountArs, null);
});

test("los movimientos se ordenan del más reciente al más viejo", () => {
  const historial = buildBillingHistory({
    events: [
      {
        id: "viejo",
        eventType: "subscription_authorized_payment:approved",
        nextStatus: "ACTIVE",
        status: "PROCESSED",
        occurredAt: new Date("2026-07-02T10:00:00Z"),
        createdAt: new Date("2026-07-02T10:00:00Z"),
      },
      {
        id: "nuevo",
        eventType: "subscription_authorized_payment:approved",
        nextStatus: "ACTIVE",
        status: "PROCESSED",
        occurredAt: new Date("2026-08-02T10:00:00Z"),
        createdAt: new Date("2026-08-02T10:00:00Z"),
      },
    ],
    snapshots: [snapshot],
  });
  assert.deepEqual(
    historial.map((h) => h.id),
    ["nuevo", "viejo"]
  );
});

test("los eventos descartados quedan marcados", () => {
  const historial = buildBillingHistory({
    events: [
      {
        id: "e1",
        eventType: "subscription_preapproval:updated",
        nextStatus: "ACTIVE",
        status: "IGNORED",
        occurredAt: null,
        createdAt: new Date("2026-07-02T10:00:00Z"),
      },
    ],
    snapshots: [],
  });
  assert.equal(historial[0]!.ignored, true);
});

test("sin fecha del proveedor se usa la de registro", () => {
  const historial = buildBillingHistory({
    events: [
      {
        id: "e1",
        eventType: "subscription_preapproval:updated",
        nextStatus: "ACTIVE",
        status: "PROCESSED",
        occurredAt: null,
        createdAt: new Date("2026-07-09T08:30:00Z"),
      },
    ],
    snapshots: [],
  });
  assert.equal(historial[0]!.occurredAt, "2026-07-09T08:30:00.000Z");
});
