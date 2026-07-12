"use client";

import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { serviceSchema, type ServiceInput } from "@/lib/validations/service";
import { createService, updateService } from "@/server/actions/services";
import type { ServiceRow } from "@/server/queries";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";

type ServiceFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: ServiceRow | null;
};

function toDefaults(service: ServiceRow | null): ServiceInput {
  return {
    name: service?.name ?? "",
    description: service?.description ?? "",
    price: service?.price ?? 0,
    durationMinutes: service?.durationMinutes ?? 30,
    active: service?.active ?? true,
  };
}

export function ServiceFormDialog({
  open,
  onOpenChange,
  service,
}: ServiceFormDialogProps) {
  const isEditing = service !== null;
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: toDefaults(service),
  });

  useEffect(() => {
    if (open) reset(toDefaults(service));
  }, [open, service, reset]);

  async function onSubmit(values: ServiceInput) {
    const result = isEditing
      ? await updateService(service.id, values)
      : await createService(values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(isEditing ? "Servicio actualizado." : "Servicio creado.");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar servicio" : "Nuevo servicio"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Actualizá la información del servicio."
              : "Completá los datos del servicio que ofrece tu negocio."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="service-name">Nombre</Label>
            <Input
              id="service-name"
              placeholder="Corte y peinado"
              {...register("name")}
            />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="service-description">
              Descripción{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Textarea
              id="service-description"
              rows={3}
              placeholder="Qué incluye el servicio."
              {...register("description")}
            />
            <FieldError message={errors.description?.message} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="service-price">Precio</Label>
              <Input
                id="service-price"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                {...register("price", { valueAsNumber: true })}
              />
              <FieldError message={errors.price?.message} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="service-duration">Duración (minutos)</Label>
              <Input
                id="service-duration"
                type="number"
                min="5"
                step="5"
                inputMode="numeric"
                {...register("durationMinutes", { valueAsNumber: true })}
              />
              <FieldError message={errors.durationMinutes?.message} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div>
              <Label htmlFor="service-active">Servicio activo</Label>
              <p className="text-xs text-muted-foreground">
                Los servicios inactivos no se muestran al agente.
              </p>
            </div>
            <Controller
              control={control}
              name="active"
              render={({ field }) => (
                <Switch
                  id="service-active"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              )}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <SubmitButton loading={isSubmitting}>
              {isEditing ? "Guardar cambios" : "Crear servicio"}
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
