import type { Metadata } from "next";
import { Check, SkipForward } from "lucide-react";
import { OnboardingWizardShell } from "@/components/onboarding/wizard-shell";
import { FinishOnboarding } from "@/components/onboarding/finish-onboarding";
import { Card, CardContent } from "@/components/ui/card";
import {
  redirectIfStepLocked,
  requireOnboardingContext,
} from "@/server/organizations/onboarding-context";
import { rememberLastStep } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Listo para operar",
  robots: { index: false, follow: false },
};

export default async function OnboardingFinishPage() {
  const { org, state } = await requireOnboardingContext();
  redirectIfStepLocked(state, "finalizar");

  // Doble control: si falta algo obligatorio, no se llega al resumen.
  if (!state.canFinish && !state.isComplete) {
    const next = state.steps.find((step) => step.step === state.nextStep);
    redirect(next?.path ?? "/onboarding");
  }

  await rememberLastStep(org.id, "finalizar");

  const summary = state.steps.filter((step) => step.step !== "finalizar");

  return (
    <OnboardingWizardShell state={state} current="finalizar">
      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-1 p-5 sm:p-6">
            <h2 className="text-sm font-semibold">Resumen de tu configuración</h2>
            <ul className="mt-3 divide-y divide-border">
              {summary.map((step) => (
                <li
                  key={step.step}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{step.title}</span>
                  </span>
                  {step.status === "done" ? (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary">
                      <Check className="size-3.5" aria-hidden />
                      Listo
                    </span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <SkipForward className="size-3.5" aria-hidden />
                      Pendiente
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Lo que quedó pendiente no te frena: podés completarlo cuando quieras
          desde el dashboard, y el agente irá respondiendo mejor a medida que
          sumes información.
        </p>
      </div>

      <FinishOnboarding
        previousPath={stepPath("prueba")}
        alreadyComplete={state.isComplete}
      />
    </OnboardingWizardShell>
  );
}
