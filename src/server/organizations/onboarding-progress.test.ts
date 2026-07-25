import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOnboardingState,
  isOnboardingStep,
  ONBOARDING_STEPS,
  resolveAccessibleStep,
  type OnboardingSignals,
} from "./onboarding-progress";

/** Señales de una organización recién creada: solo existe el negocio. */
function freshSignals(overrides?: Partial<OnboardingSignals>): OnboardingSignals {
  return {
    organizationExists: true,
    profile: {
      hasDescription: false,
      hasContact: false,
      hasOpeningHours: false,
      hasTimeZone: false,
    },
    counts: { products: 0, services: 0, faqs: 0, knowledgeDocuments: 0 },
    hasConnectedIntegration: false,
    agentTested: false,
    completedAt: null,
    skippedSteps: [],
    ...overrides,
  };
}

/** Señales de una organización con todo lo obligatorio cargado. */
function readySignals(overrides?: Partial<OnboardingSignals>): OnboardingSignals {
  return freshSignals({
    profile: {
      hasDescription: true,
      hasContact: true,
      hasOpeningHours: true,
      hasTimeZone: true,
    },
    counts: { products: 2, services: 0, faqs: 1, knowledgeDocuments: 0 },
    ...overrides,
  });
}

test("recién creado el negocio, solo el primer paso está hecho", () => {
  const state = buildOnboardingState(freshSignals());

  assert.equal(state.steps[0]?.status, "done");
  assert.equal(state.steps[1]?.status, "pending");
  assert.equal(state.nextStep, "informacion");
  assert.equal(state.canFinish, false);
  assert.equal(state.isComplete, false);
});

test("el progreso sale de los datos, no de haber visitado la pantalla", () => {
  // Sin datos cargados el paso sigue pendiente aunque sea el "último visitado".
  const pending = buildOnboardingState(freshSignals());
  assert.equal(
    pending.steps.find((step) => step.step === "informacion")?.status,
    "pending"
  );

  // Con descripción y contacto cargados pasa a hecho sin tocar nada más.
  const done = buildOnboardingState(
    freshSignals({
      profile: {
        hasDescription: true,
        hasContact: true,
        hasOpeningHours: false,
        hasTimeZone: false,
      },
    })
  );
  assert.equal(
    done.steps.find((step) => step.step === "informacion")?.status,
    "done"
  );
});

test("el catálogo se completa con productos, servicios, FAQs o documentos", () => {
  for (const key of ["products", "services", "faqs", "knowledgeDocuments"] as const) {
    const state = buildOnboardingState(
      readySignals({
        counts: { products: 0, services: 0, faqs: 0, knowledgeDocuments: 0, [key]: 1 },
      })
    );
    assert.equal(
      state.steps.find((step) => step.step === "catalogo")?.status,
      "done",
      `${key} debería completar el paso de catálogo`
    );
  }
});

test("horarios exige zona horaria además del horario de atención", () => {
  const soloHorario = buildOnboardingState(
    freshSignals({
      profile: {
        hasDescription: true,
        hasContact: true,
        hasOpeningHours: true,
        hasTimeZone: false,
      },
    })
  );
  assert.equal(
    soloHorario.steps.find((step) => step.step === "horarios")?.status,
    "pending"
  );
});

test("los pasos posteriores a un obligatorio pendiente quedan bloqueados", () => {
  const state = buildOnboardingState(freshSignals());

  const catalogo = state.steps.find((step) => step.step === "catalogo");
  const finalizar = state.steps.find((step) => step.step === "finalizar");
  assert.equal(catalogo?.locked, true);
  assert.equal(finalizar?.locked, true);
});

test("escribir la URL de un paso bloqueado devuelve al paso que corresponde", () => {
  const state = buildOnboardingState(freshSignals());

  // Intento de saltar directo al final sin cargar nada.
  assert.equal(resolveAccessibleStep(state, "finalizar"), "informacion");
  assert.equal(resolveAccessibleStep(state, "catalogo"), "informacion");
  // El paso alcanzable sí se respeta.
  assert.equal(resolveAccessibleStep(state, "informacion"), "informacion");
});

test("no se puede finalizar hasta completar todos los obligatorios", () => {
  const incompleto = buildOnboardingState(freshSignals());
  assert.equal(incompleto.canFinish, false);
  assert.equal(resolveAccessibleStep(incompleto, "finalizar"), "informacion");

  const completo = buildOnboardingState(readySignals());
  assert.equal(completo.canFinish, true);
  assert.equal(resolveAccessibleStep(completo, "finalizar"), "finalizar");
});

test("los pasos opcionales no frenan la finalización", () => {
  const state = buildOnboardingState(readySignals());

  const integraciones = state.steps.find((step) => step.step === "integraciones");
  const prueba = state.steps.find((step) => step.step === "prueba");
  assert.equal(integraciones?.status, "pending");
  assert.equal(prueba?.status, "pending");
  // Aun pendientes, no bloquean lo que viene después.
  assert.equal(state.steps.find((step) => step.step === "finalizar")?.locked, false);
  assert.equal(state.canFinish, true);
});

test("omitir solo aplica a pasos opcionales", () => {
  const state = buildOnboardingState(
    freshSignals({ skippedSteps: ["integraciones", "informacion"] })
  );

  assert.equal(
    state.steps.find((step) => step.step === "integraciones")?.status,
    "skipped"
  );
  // Un obligatorio marcado como omitido sigue pendiente.
  assert.equal(
    state.steps.find((step) => step.step === "informacion")?.status,
    "pending"
  );
});

test("un paso con datos cargados cuenta como hecho aunque figure omitido", () => {
  const state = buildOnboardingState(
    readySignals({
      hasConnectedIntegration: true,
      skippedSteps: ["integraciones"],
    })
  );

  assert.equal(
    state.steps.find((step) => step.step === "integraciones")?.status,
    "done"
  );
});

test("el porcentaje refleja pasos resueltos sobre el total", () => {
  const fresh = buildOnboardingState(freshSignals());
  assert.equal(fresh.totalCount, ONBOARDING_STEPS.length);
  assert.equal(fresh.completedCount, 1);
  assert.equal(fresh.percent, Math.round((1 / ONBOARDING_STEPS.length) * 100));

  const finished = buildOnboardingState(
    readySignals({
      hasConnectedIntegration: true,
      agentTested: true,
      completedAt: new Date("2026-07-24T12:00:00.000Z"),
    })
  );
  assert.equal(finished.percent, 100);
  assert.equal(finished.isComplete, true);
});

test("una organización finalizada retoma en el último paso", () => {
  const state = buildOnboardingState(
    readySignals({ completedAt: new Date("2026-07-24T12:00:00.000Z") })
  );

  assert.equal(state.nextStep, "finalizar");
  assert.equal(state.isComplete, true);
});

test("retomar lleva al primer paso pendiente alcanzable", () => {
  // Información y horarios listos; el catálogo es lo que falta.
  const state = buildOnboardingState(
    freshSignals({
      profile: {
        hasDescription: true,
        hasContact: true,
        hasOpeningHours: true,
        hasTimeZone: true,
      },
    })
  );

  assert.equal(state.nextStep, "catalogo");
});

test("isOnboardingStep rechaza cualquier valor que no sea un paso", () => {
  assert.equal(isOnboardingStep("catalogo"), true);
  assert.equal(isOnboardingStep("../../dashboard"), false);
  assert.equal(isOnboardingStep(""), false);
});
