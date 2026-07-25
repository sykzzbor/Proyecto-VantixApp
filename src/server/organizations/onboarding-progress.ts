/**
 * Progreso del onboarding guiado.
 *
 * Un paso se considera hecho porque **existen los datos que produce**, no
 * porque alguien haya abierto la pantalla. Así el progreso sobrevive a que la
 * persona cierre el navegador, cambie de dispositivo o borre el localStorage,
 * y no se puede falsear desde el cliente.
 *
 * Este módulo es puro: recibe las señales ya leídas y devuelve el estado.
 * Las consultas viven en `onboarding-state.ts`.
 */

export const ONBOARDING_STEPS = [
  "negocio",
  "informacion",
  "horarios",
  "catalogo",
  "integraciones",
  "prueba",
  "finalizar",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStep(value: string): value is OnboardingStep {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

type StepDefinition = {
  step: OnboardingStep;
  title: string;
  description: string;
  /** Un paso opcional se puede omitir y no frena la finalización. */
  optional: boolean;
  path: string;
};

export const ONBOARDING_STEP_DEFINITIONS: readonly StepDefinition[] = [
  {
    step: "negocio",
    title: "Crear tu negocio",
    description: "El espacio de trabajo donde vive todo lo demás.",
    optional: false,
    path: "/onboarding",
  },
  {
    step: "informacion",
    title: "Información del negocio",
    description: "Qué hacés y cómo te contactan. El agente lo usa para responder.",
    optional: false,
    path: "/onboarding/informacion",
  },
  {
    step: "horarios",
    title: "Horarios y zona horaria",
    description: "Cuándo atendés, para que el agente no prometa horarios cerrados.",
    optional: false,
    path: "/onboarding/horarios",
  },
  {
    step: "catalogo",
    title: "Productos, servicios y preguntas",
    description: "Lo que vendés y las dudas que más te repiten.",
    optional: false,
    path: "/onboarding/catalogo",
  },
  {
    step: "integraciones",
    title: "Integraciones",
    description: "Conectá WhatsApp y el resto de tus herramientas. Podés hacerlo después.",
    optional: true,
    path: "/onboarding/integraciones",
  },
  {
    step: "prueba",
    title: "Probar el agente",
    description: "Escribile una consulta real y mirá cómo responde.",
    optional: true,
    path: "/onboarding/prueba",
  },
  {
    step: "finalizar",
    title: "Listo para operar",
    description: "Revisá el resumen y entrá al dashboard.",
    optional: false,
    path: "/onboarding/finalizar",
  },
] as const;

/**
 * Señales leídas de la base. Son hechos verificables del lado del servidor,
 * nunca banderas que mande el navegador.
 */
export type OnboardingSignals = {
  /** La organización existe (paso 1 hecho por definición). */
  organizationExists: boolean;
  profile: {
    hasDescription: boolean;
    /** Al menos una vía de contacto: teléfono, correo o dirección. */
    hasContact: boolean;
    hasOpeningHours: boolean;
    hasTimeZone: boolean;
  };
  counts: {
    products: number;
    services: number;
    faqs: number;
    knowledgeDocuments: number;
  };
  /** Alguna integración realmente conectada (no solo iniciada). */
  hasConnectedIntegration: boolean;
  /** Se probó el agente de verdad: hubo respuesta del modelo. */
  agentTested: boolean;
  completedAt: Date | null;
  skippedSteps: readonly string[];
};

export type StepStatus = "done" | "skipped" | "pending";

export type OnboardingStepState = StepDefinition & {
  status: StepStatus;
  /** Un paso queda bloqueado hasta que se completen los obligatorios previos. */
  locked: boolean;
};

export type OnboardingState = {
  steps: OnboardingStepState[];
  /** Paso al que conviene mandar a la persona cuando retoma. */
  nextStep: OnboardingStep;
  completedCount: number;
  totalCount: number;
  percent: number;
  /** `true` cuando todos los pasos obligatorios están hechos. */
  canFinish: boolean;
  isComplete: boolean;
};

/** Evalúa si un paso está satisfecho por los datos, ignorando omisiones. */
function isSatisfiedByData(
  step: OnboardingStep,
  signals: OnboardingSignals
): boolean {
  switch (step) {
    case "negocio":
      return signals.organizationExists;
    case "informacion":
      return signals.profile.hasDescription && signals.profile.hasContact;
    case "horarios":
      return signals.profile.hasOpeningHours && signals.profile.hasTimeZone;
    case "catalogo":
      return (
        signals.counts.products +
          signals.counts.services +
          signals.counts.faqs +
          signals.counts.knowledgeDocuments >
        0
      );
    case "integraciones":
      return signals.hasConnectedIntegration;
    case "prueba":
      return signals.agentTested;
    case "finalizar":
      return signals.completedAt !== null;
  }
}

export function buildOnboardingState(
  signals: OnboardingSignals
): OnboardingState {
  const skipped = new Set(signals.skippedSteps);

  const steps: OnboardingStepState[] = ONBOARDING_STEP_DEFINITIONS.map(
    (definition) => {
      const done = isSatisfiedByData(definition.step, signals);
      // Omitir solo cuenta en pasos opcionales: marcar "omitido" un paso
      // obligatorio lo dejaría pendiente igual, así que no se acepta.
      const wasSkipped =
        !done && definition.optional && skipped.has(definition.step);
      return {
        ...definition,
        status: done ? "done" : wasSkipped ? "skipped" : "pending",
        locked: false,
      };
    }
  );

  // Un paso se bloquea si algún paso obligatorio ANTERIOR sigue pendiente.
  // Esto es lo que impide entrar por URL directa saltándose lo obligatorio.
  let blocked = false;
  for (const step of steps) {
    step.locked = blocked;
    if (!step.optional && step.status === "pending") blocked = true;
  }

  const required = steps.filter((step) => !step.optional);
  const canFinish = required
    .filter((step) => step.step !== "finalizar")
    .every((step) => step.status === "done");

  const resolved = steps.filter(
    (step) => step.status === "done" || step.status === "skipped"
  ).length;

  const isComplete = signals.completedAt !== null;

  const nextStep =
    steps.find((step) => step.status === "pending" && !step.locked)?.step ??
    "finalizar";

  return {
    steps,
    nextStep: isComplete ? "finalizar" : nextStep,
    completedCount: resolved,
    totalCount: steps.length,
    percent: Math.round((resolved / steps.length) * 100),
    canFinish,
    isComplete,
  };
}

/**
 * Decide a qué paso mandar a alguien que pide `requested`.
 *
 * Devuelve el paso pedido solo si es alcanzable; si está bloqueado por un
 * obligatorio anterior, devuelve el que corresponde. La navegación por URL
 * pasa por acá, así que escribir `/onboarding/finalizar` a mano no saltea nada.
 */
export function resolveAccessibleStep(
  state: OnboardingState,
  requested: OnboardingStep
): OnboardingStep {
  const target = state.steps.find((step) => step.step === requested);
  if (!target || target.locked) return state.nextStep;
  if (requested === "finalizar" && !state.canFinish && !state.isComplete) {
    return state.nextStep;
  }
  return requested;
}
