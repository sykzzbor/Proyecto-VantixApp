"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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

type BusinessFormProps = {
  defaults: BusinessProfileInput;
  canEdit: boolean;
};

export function BusinessForm({ defaults, canEdit }: BusinessFormProps) {
  const {
    register,
    handleSubmit,
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos del negocio</CardTitle>
          <CardDescription>
            {canEdit
              ? "Todos los campos, salvo el nombre, son opcionales — pero cuanto más completos, mejor responde el agente."
              : "Tu rol solo permite ver esta información."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-name">Nombre del negocio</Label>
            <Input
              id="business-name"
              disabled={disabled}
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-description">Descripción</Label>
            <Textarea
              id="business-description"
              rows={3}
              disabled={disabled}
              placeholder="Qué hace tu negocio, qué lo distingue, a quién atiende."
              {...register("description")}
            />
            <FieldError message={errors.description?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-industry">Rubro</Label>
            <Input
              id="business-industry"
              disabled={disabled}
              placeholder="Belleza y cuidado personal"
              {...register("industry")}
            />
            <FieldError message={errors.industry?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business-phone">Teléfono</Label>
            <Input
              id="business-phone"
              type="tel"
              disabled={disabled}
              placeholder="+54 9 11 5555-0000"
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
              {...register("country")}
            />
            <FieldError message={errors.country?.message} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-hours">Horario de atención</Label>
            <Input
              id="business-hours"
              disabled={disabled}
              placeholder="Lunes a viernes de 9 a 18 h"
              {...register("openingHours")}
            />
            <FieldError message={errors.openingHours?.message} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-payments">Métodos de pago</Label>
            <Input
              id="business-payments"
              disabled={disabled}
              placeholder="Efectivo, débito, crédito hasta 3 cuotas, transferencia"
              {...register("paymentMethods")}
            />
            <FieldError message={errors.paymentMethods?.message} />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="business-shipping">Envíos</Label>
            <Textarea
              id="business-shipping"
              rows={2}
              disabled={disabled}
              placeholder="Zonas, costos y plazos de envío, o si solo hay retiro en el local."
              {...register("shippingInfo")}
            />
            <FieldError message={errors.shippingInfo?.message} />
          </div>
        </CardContent>
        {canEdit && (
          <CardFooter className="justify-end pt-6">
            <SubmitButton loading={isSubmitting} disabled={!isDirty}>
              Guardar cambios
            </SubmitButton>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
