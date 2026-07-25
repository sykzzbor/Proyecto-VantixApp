"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/forms/submit-button";
import { skipOnboardingStep } from "@/server/actions/onboarding";
import type { OnboardingStep } from "@/server/organizations/onboarding-progress";

/**
 * Botonera común de los pasos: Anterior, Omitir (solo opcionales) y Continuar.
 *
 * "Omitir" pasa por el servidor, que rechaza el intento si el paso no es
 * opcional: la lista de pasos que se puede saltear no la decide el navegador.
 */
export function StepNavigation({
  step,
  previousPath,
  nextPath,
  optional = false,
  submitting = false,
  submitLabel = "Continuar",
  /**
   * Cuando se pasa, el botón principal envía ese formulario. Sin `formId` el
   * paso no guarda nada y el botón simplemente avanza.
   */
  formId,
  disabled = false,
}: {
  step: OnboardingStep;
  previousPath?: string;
  nextPath: string;
  optional?: boolean;
  submitting?: boolean;
  submitLabel?: string;
  formId?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [skipping, startSkip] = useTransition();
  const [advancing, startAdvance] = useTransition();

  function handleSkip() {
    startSkip(async () => {
      const result = await skipOnboardingStep(step);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.push(nextPath);
      router.refresh();
    });
  }

  return (
    <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center">
      {previousPath && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(previousPath)}
          disabled={submitting || skipping}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Anterior
        </Button>
      )}

      <div className="flex flex-col gap-3 sm:ml-auto sm:flex-row sm:items-center">
        {optional && (
          <Button
            type="button"
            variant="outline"
            onClick={handleSkip}
            disabled={submitting || skipping}
          >
            {skipping ? "Omitiendo…" : "Omitir por ahora"}
          </Button>
        )}
        <SubmitButton
          {...(formId
            ? { form: formId }
            : {
                type: "button" as const,
                onClick: () =>
                  startAdvance(() => {
                    router.push(nextPath);
                  }),
              })}
          loading={submitting || advancing}
          disabled={disabled}
          className="sm:min-w-40"
        >
          {submitLabel}
          <ArrowRight className="size-4" aria-hidden />
        </SubmitButton>
      </div>
    </div>
  );
}
