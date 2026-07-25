"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  onboardingScheduleSchema,
  type OnboardingScheduleInput,
} from "@/lib/validations/business";
import { saveOnboardingSchedule } from "@/server/actions/onboarding";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { FormAlert } from "@/components/forms/form-alert";
import { StepNavigation } from "@/components/onboarding/step-navigation";
import { useUnsavedChangesGuard } from "@/components/onboarding/use-unsaved-changes-guard";

const FORM_ID = "onboarding-horarios";

/** Zonas horarias frecuentes en la región. La lista completa la valida el servidor. */
const COMMON_TIME_ZONES = [
  "America/Argentina/Buenos_Aires",
  "America/Argentina/Cordoba",
  "America/Argentina/Mendoza",
  "America/Montevideo",
  "America/Santiago",
  "America/Asuncion",
  "America/Sao_Paulo",
  "America/La_Paz",
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "Europe/Madrid",
] as const;

export function ScheduleForm({
  defaults,
  nextPath,
  previousPath,
}: {
  defaults: OnboardingScheduleInput;
  nextPath: string;
  previousPath: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<OnboardingScheduleInput>({
    resolver: zodResolver(onboardingScheduleSchema),
    defaultValues: defaults,
  });

  useUnsavedChangesGuard(isDirty && !isSubmitting);

  async function onSubmit(values: OnboardingScheduleInput) {
    setFormError(null);
    const result = await saveOnboardingSchedule(values);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    router.push(nextPath);
    router.refresh();
  }

  return (
    <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardContent className="space-y-5 p-5 sm:p-6">
          <FormAlert message={formError} />

          <div className="space-y-2">
            <Label htmlFor="timeZone">Zona horaria</Label>
            <select
              id="timeZone"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
              aria-invalid={Boolean(errors.timeZone)}
              {...register("timeZone")}
            >
              {COMMON_TIME_ZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ").replace("America/", "").replace("Europe/", "")}
                </option>
              ))}
            </select>
            <FieldError message={errors.timeZone?.message} />
            <p className="text-xs text-muted-foreground">
              Con esto el agente sabe si estás abierto cuando alguien escribe.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="openingHours">Horarios de atención</Label>
            <Textarea
              id="openingHours"
              rows={4}
              placeholder={"Lunes a viernes de 9 a 18 h\nSábados de 10 a 14 h\nDomingos cerrado"}
              aria-invalid={Boolean(errors.openingHours)}
              {...register("openingHours")}
            />
            <FieldError message={errors.openingHours?.message} />
            <p className="text-xs text-muted-foreground">
              Escribilo como se lo contarías a un cliente. Podés incluir feriados
              o excepciones.
            </p>
          </div>
        </CardContent>
      </Card>

      <StepNavigation
        step="horarios"
        formId={FORM_ID}
        previousPath={previousPath}
        nextPath={nextPath}
        submitting={isSubmitting}
        submitLabel={isSubmitting ? "Guardando…" : "Guardar y continuar"}
      />
    </form>
  );
}
