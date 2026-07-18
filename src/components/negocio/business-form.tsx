"use client";

import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Clock3, ContactRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  businessProfileSchema,
  type BusinessProfileInput,
} from "@/lib/validations/business";
import { saveBusinessProfile } from "@/server/actions/business";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";
import { FormSection } from "@/components/dashboard/form-section";
import { ReadOnlyNotice } from "@/components/dashboard/read-only-notice";

type BusinessFormProps = {
  defaults: BusinessProfileInput;
  canEdit: boolean;
};

export function BusinessForm({ defaults, canEdit }: BusinessFormProps) {
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<BusinessProfileInput>({
    resolver: zodResolver(businessProfileSchema),
    defaultValues: defaults,
  });

  async function onSubmit(values: BusinessProfileInput) {
    const result = await saveBusinessProfile(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Datos del negocio guardados.");
    reset(values);
  }

  const disabled = !canEdit;
  const values = useWatch({ control });
  const totalFields = Object.keys(values).length;
  const completedFields = Object.values(values).filter(
    (value) => typeof value === "string" && value.trim().length > 0
  ).length;
  const completion = Math.round((completedFields / totalFields) * 100);

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      {!canEdit && <ReadOnlyNotice />}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="space-y-4">
          <FormSection
            icon={Building2}
            title="Identidad del negocio"
            description="La información principal con la que el agente presenta tu empresa."
          >
            <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input
              id="business-name"
              disabled={disabled}
              aria-invalid={Boolean(errors.name)}
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="business-industry">Rubro</Label>
            <Input
              id="business-industry"
              disabled={disabled}
              placeholder="Belleza y cuidado personal"
              aria-invalid={Boolean(errors.industry)}
              {...register("industry")}
            />
            <FieldError message={errors.industry?.message} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-description">Descripción pública</Label>
            <Textarea
              id="business-description"
              rows={4}
              disabled={disabled}
              placeholder="Qué hace tu negocio, qué lo distingue y a quién atiende."
              aria-invalid={Boolean(errors.description)}
              {...register("description")}
            />
            <FieldError message={errors.description?.message} />
          </div>
            </div>
          </FormSection>

          <FormSection
            icon={ContactRound}
            title="Contacto y ubicación"
            description="Datos públicos para que tus clientes puedan comunicarse o encontrarte."
          >
            <div className="grid gap-4 sm:grid-cols-2">

          <div className="space-y-2">
            <Label htmlFor="business-phone">Teléfono</Label>
            <Input
              id="business-phone"
              type="tel"
              disabled={disabled}
              placeholder="+54 9 11 5555-0000"
              aria-invalid={Boolean(errors.phone)}
              {...register("phone")}
            />
            <FieldError message={errors.phone?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-email">Email de contacto</Label>
            <Input
              id="business-email"
              type="email"
              disabled={disabled}
              placeholder="hola@tunegocio.com"
              aria-invalid={Boolean(errors.email)}
              {...register("email")}
            />
            <FieldError message={errors.email?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-website">Sitio web</Label>
            <Input
              id="business-website"
              type="url"
              disabled={disabled}
              placeholder="https://tunegocio.com"
              aria-invalid={Boolean(errors.website)}
              {...register("website")}
            />
            <FieldError message={errors.website?.message} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-address">Dirección</Label>
            <Input
              id="business-address"
              disabled={disabled}
              placeholder="Av. Santa Fe 2450"
              aria-invalid={Boolean(errors.address)}
              {...register("address")}
            />
            <FieldError message={errors.address?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-city">Ciudad</Label>
            <Input
              id="business-city"
              disabled={disabled}
              placeholder="Buenos Aires"
              aria-invalid={Boolean(errors.city)}
              {...register("city")}
            />
            <FieldError message={errors.city?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-country">País</Label>
            <Input
              id="business-country"
              disabled={disabled}
              placeholder="Argentina"
              aria-invalid={Boolean(errors.country)}
              {...register("country")}
            />
            <FieldError message={errors.country?.message} />
          </div>

            </div>
          </FormSection>

          <FormSection
            icon={Clock3}
            title="Información para responder"
            description="Horarios, pagos y entregas que el agente puede comunicar con precisión."
          >
            <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="business-hours">Horario de atención</Label>
            <Input
              id="business-hours"
              disabled={disabled}
              placeholder="Lunes a viernes de 9 a 18 h"
              aria-invalid={Boolean(errors.openingHours)}
              {...register("openingHours")}
            />
            <FieldError message={errors.openingHours?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-payments">Métodos de pago</Label>
            <Input
              id="business-payments"
              disabled={disabled}
              placeholder="Efectivo, débito, crédito hasta 3 cuotas, transferencia"
              aria-invalid={Boolean(errors.paymentMethods)}
              {...register("paymentMethods")}
            />
            <FieldError message={errors.paymentMethods?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-shipping">Envíos</Label>
            <Textarea
              id="business-shipping"
              rows={2}
              disabled={disabled}
              placeholder="Zonas, costos y plazos de envío, o si solo hay retiro en el local."
              aria-invalid={Boolean(errors.shippingInfo)}
              {...register("shippingInfo")}
            />
            <FieldError message={errors.shippingInfo?.message} />
          </div>
            </div>
          </FormSection>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Perfil del negocio</CardTitle>
              <CardDescription>
                Cuanto más completo esté, mejores respuestas puede dar el agente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted-foreground">Información completa</span>
                  <span className="font-semibold tabular-nums">{completion}%</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${completion}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {completedFields} de {totalFields} campos con información.
                </p>
              </div>
              <div className="flex items-start gap-2.5 rounded-lg border border-primary/15 bg-primary/[0.06] p-3 text-xs leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                Estos datos son los que el agente puede usar al responder consultas del negocio.
              </div>
            </CardContent>
            {canEdit && (
              <CardFooter>
                <SubmitButton loading={isSubmitting} disabled={!isDirty} className="w-full">
                  Guardar cambios
                </SubmitButton>
              </CardFooter>
            )}
          </Card>
        </aside>
      </div>
    </form>
  );
}
