import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, CircleCheckBig, MessageSquareText } from "lucide-react";
import { OnboardingWizardShell } from "@/components/onboarding/wizard-shell";
import { StepNavigation } from "@/components/onboarding/step-navigation";
import { Card, CardContent } from "@/components/ui/card";
import {
  redirectIfStepLocked,
  requireOnboardingContext,
} from "@/server/organizations/onboarding-context";
import { rememberLastStep } from "@/server/organizations/onboarding-state";
import { stepPath } from "@/server/organizations/onboarding-paths";

export const metadata: Metadata = {
  title: "Probar el agente",
  robots: { index: false, follow: false },
};

export default async function OnboardingAgentTestPage() {
  const { org, state } = await requireOnboardingContext();
  redirectIfStepLocked(state, "prueba");
  await rememberLastStep(org.id, "prueba");

  const tested = state.steps.find((step) => step.step === "prueba")?.status === "done";

  return (
    <OnboardingWizardShell state={state} current="prueba">
      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-4 p-5 sm:p-6">
            {tested ? (
              <div className="flex items-start gap-3">
                <CircleCheckBig
                  className="mt-0.5 size-5 shrink-0 text-primary"
                  aria-hidden
                />
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Ya probaste el agente</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Respondió al menos una vez con la información que cargaste.
                    Podés seguir ajustando su tono y sus respuestas cuando quieras.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <MessageSquareText
                  className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold">Todavía no lo probaste</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Escribile una consulta como te la haría un cliente real
                    (&ldquo;¿cuánto sale?&rdquo;, &ldquo;¿a qué hora abren?&rdquo;)
                    y mirá qué contesta con lo que cargaste.
                  </p>
                </div>
              </div>
            )}

            <Link
              href="/dashboard/agente"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Abrir el chat de prueba
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </CardContent>
        </Card>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Este paso se marca solo cuando el agente responde de verdad, no por
          haber abierto esta pantalla.
        </p>
      </div>

      <StepNavigation
        step="prueba"
        previousPath={stepPath("integraciones")}
        nextPath={stepPath("finalizar")}
        optional
        submitLabel="Continuar"
      />
    </OnboardingWizardShell>
  );
}
