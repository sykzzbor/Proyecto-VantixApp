import assert from "node:assert/strict";
import test from "node:test";
import {
  daysUntilTrialEnd,
  milestoneFor,
  trialReminderKey,
} from "./trial-reminders";

const ahora = new Date("2026-07-01T12:00:00Z");
const enDias = (d: number) =>
  new Date(ahora.getTime() + d * 24 * 60 * 60 * 1000);

test("los días restantes se redondean hacia arriba", () => {
  assert.equal(daysUntilTrialEnd(enDias(3), ahora), 3);
  // Faltan 2 días y medio: todavía cuenta como 3.
  assert.equal(daysUntilTrialEnd(enDias(2.5), ahora), 3);
  assert.equal(daysUntilTrialEnd(enDias(0.1), ahora), 1);
});

test("una prueba vencida da cero", () => {
  assert.equal(daysUntilTrialEnd(enDias(-1), ahora), 0);
  assert.equal(daysUntilTrialEnd(ahora, ahora), 0);
});

test("se avisa a 3 días, a 1 día y al vencer", () => {
  assert.equal(milestoneFor(enDias(3), ahora), 3);
  assert.equal(milestoneFor(enDias(1), ahora), 1);
  assert.equal(milestoneFor(enDias(-0.5), ahora), 0);
});

test("a 2 y a 4 días no se avisa", () => {
  // El hito de 3 ya salió y el de 1 sale mañana: avisar todos los días sería
  // ruido y el pedido era 3, 2, 1 y 0 como hitos, no un correo diario.
  assert.equal(milestoneFor(enDias(2), ahora), null);
  assert.equal(milestoneFor(enDias(4), ahora), null);
  assert.equal(milestoneFor(enDias(5), ahora), null);
});

test("la clave de deduplicación es estable por organización y por hito", () => {
  assert.equal(trialReminderKey("org1", 3), trialReminderKey("org1", 3));
  assert.notEqual(trialReminderKey("org1", 3), trialReminderKey("org1", 1));
  assert.notEqual(trialReminderKey("org1", 3), trialReminderKey("org2", 3));
});

test("la clave no expone el id de la organización", () => {
  const key = trialReminderKey("org-secreta", 0);
  assert.equal(key.includes("org-secreta"), false);
  assert.match(key, /^[a-f0-9]{64}$/);
});
