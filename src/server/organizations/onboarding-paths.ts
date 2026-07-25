import {
  ONBOARDING_STEP_DEFINITIONS,
  type OnboardingStep,
} from "@/server/organizations/onboarding-progress";

/** Ruta de un paso, tomada de la definición para no repetir literales. */
export function stepPath(step: OnboardingStep): string {
  const definition = ONBOARDING_STEP_DEFINITIONS.find(
    (item) => item.step === step
  );
  return definition?.path ?? "/onboarding";
}
