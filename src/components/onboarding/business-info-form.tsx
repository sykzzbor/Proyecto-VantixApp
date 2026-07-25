"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  onboardingBusinessInfoSchema,
  type OnboardingBusinessInfoInput,
} from "@/lib/validations/business";
import { saveOnboardingBusinessInfo } from "@/server/actions/onboarding";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { FormAlert } from "@/components/forms/form-alert";
import { StepNavigation } from "@/components/onboarding/step-navigation";
import { useUnsavedChangesGuard } from "@/components/onboarding/use-unsaved-changes-guard";

const FORM_ID = "onboarding-informacion";

export function BusinessInfoForm({
  defaults,
  nextPath,
  previousPath,
}: {
  defaults: OnboardingBusinessInfoInput;
  nextPath: string;
  previousPath: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<OnboardingBusinessInfoInput>({
    resolver: zodResolver(onboardingBusinessInfoSchema),
    defaultValues: defaults,
  });

  useUnsavedChangesGuard(isDirty && !isSubmitting);

  async function onSubmit(values: OnboardingBusinessInfoInput) {
    setFormError(null);
    const result = await saveOnboardingBusinessInfo(values);
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
            <Label htmlFor="description">¿A qué se dedica tu negocio?</Label>
            <Textarea
              id="description"
              rows={4}
              placeholder="Somos una estética en Palermo especializada en tratamientos faciales y depilación láser."
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
            <FieldError message={errors.description?.message} />
            <p className="text-xs text-muted-foreground">
              El agente usa esta descripción para responder. Cuanto más claro,
              mejor contesta.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="industry">Rubro</Label>
            <Input
              id="industry"
              placeholder="Estética y belleza"
              aria-invalid={Boolean(errors.industry)}
              {...register("industry")}
            />
            <FieldError message={errors.industry?.message} />
          </div>

          <fieldset className="space-y-4">
            <legend className="text-sm font-medium">
              ¿Cómo te contactan?{" "}
              <span className="font-normal text-muted-foreground">
                (completá al menos uno)
              </span>
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input
                  id="phone"
                  autoComplete="tel"
                  placeholder="+54 11 5555 5555"
                  aria-invalid={Boolean(errors.phone)}
                  {...register("phone")}
                />
                <FieldError message={errors.phone?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email de contacto</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="hola@tunegocio.com"
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
                <FieldError message={errors.email?.message} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Dirección</Label>
              <Input
                id="address"
                autoComplete="street-address"
                placeholder="Av. Santa Fe 1234"
                aria-invalid={Boolean(errors.address)}
                {...register("address")}
              />
              <FieldError message={errors.address?.message} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="city">Ciudad</Label>
                <Input
                  id="city"
                  placeholder="Buenos Aires"
                  aria-invalid={Boolean(errors.city)}
                  {...register("city")}
                />
                <FieldError message={errors.city?.message} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">País</Label>
                <Input
                  id="country"
                  placeholder="Argentina"
                  aria-invalid={Boolean(errors.country)}
                  {...register("country")}
                />
                <FieldError message={errors.country?.message} />
              </div>
            </div>
          </fieldset>
        </CardContent>
      </Card>

      <StepNavigation
        step="informacion"
        formId={FORM_ID}
        previousPath={previousPath}
        nextPath={nextPath}
        submitting={isSubmitting}
        submitLabel={isSubmitting ? "Guardando…" : "Guardar y continuar"}
      />
    </form>
  );
}
