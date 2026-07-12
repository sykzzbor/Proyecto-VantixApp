"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  customerFormSchema,
  type CustomerFormInput,
} from "@/lib/validations/conversation";
import { saveConversationCustomer } from "@/server/actions/customers";
import type { ConversationDetail } from "@/server/inbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { FieldError } from "@/components/forms/field-error";
import { SubmitButton } from "@/components/forms/submit-button";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";

const STATUS_LABEL: Record<string, string> = {
  open: "Abierta",
  pending: "Pendiente",
  closed: "Cerrada",
};

function toDefaults(detail: ConversationDetail): CustomerFormInput {
  return {
    name: detail.customer?.name ?? "",
    phone: detail.customer?.phone ?? "",
    email: detail.customer?.email ?? "",
    notes: detail.customer?.notes ?? "",
  };
}

export function CustomerPanel({
  detail,
  canEdit,
}: {
  detail: ConversationDetail;
  canEdit: boolean;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CustomerFormInput>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: toDefaults(detail),
  });

  useEffect(() => {
    reset(toDefaults(detail));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id, detail.customer?.id]);

  async function onSubmit(values: CustomerFormInput) {
    const result = await saveConversationCustomer(detail.id, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(
      detail.customer ? "Cliente actualizado." : "Cliente creado y vinculado."
    );
    reset(values);
  }

  return (
    <div className="space-y-4 p-4">
      {/* Datos de la conversación */}
      <div className="space-y-2.5">
        <h3 className="text-sm font-semibold">Conversación</h3>
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Canal</dt>
            <dd>
              <Badge variant="secondary" className="gap-1 font-normal">
                {detail.channel === "whatsapp" && (
                  <WhatsappIcon
                    className="size-3.5 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                )}
                {detail.channel === "test"
                  ? "Prueba"
                  : detail.channel === "whatsapp"
                    ? "WhatsApp"
                    : detail.channel}
              </Badge>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Estado</dt>
            <dd>{STATUS_LABEL[detail.status]}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Primera conversación</dt>
            <dd>{detail.createdAtLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Última actividad</dt>
            <dd className="text-right">{detail.lastActivityLabel ?? "—"}</dd>
          </div>
          {detail.assigned && (
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Responsable</dt>
              <dd>{detail.assigned.name}</dd>
            </div>
          )}
        </dl>
      </div>

      <Separator />

      {/* Datos del cliente */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Cliente</h3>
          {!detail.customer && (
            <p className="mt-1 text-xs text-muted-foreground">
              {canEdit
                ? "Esta conversación no tiene un cliente cargado. Completá los datos para crearlo."
                : "Esta conversación no tiene un cliente cargado."}
            </p>
          )}
        </div>

        {canEdit ? (
          <form
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-3"
            noValidate
          >
            <div className="space-y-1.5">
              <Label htmlFor="customer-name">Nombre</Label>
              <Input
                id="customer-name"
                placeholder="Cliente de prueba"
                {...register("name")}
              />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-phone">Teléfono</Label>
              <Input
                id="customer-phone"
                type="tel"
                placeholder="+54 9 11 5555-0000"
                {...register("phone")}
              />
              <FieldError message={errors.phone?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-email">Email</Label>
              <Input
                id="customer-email"
                type="email"
                placeholder="cliente@email.com"
                {...register("email")}
              />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="customer-notes">Notas internas</Label>
              <Textarea
                id="customer-notes"
                rows={3}
                placeholder="Preferencias, historial, datos útiles para el equipo."
                {...register("notes")}
              />
              <FieldError message={errors.notes?.message} />
            </div>
            <SubmitButton
              loading={isSubmitting}
              disabled={!isDirty}
              variant="outline"
              className="w-full"
            >
              {detail.customer ? "Guardar cliente" : "Crear cliente"}
            </SubmitButton>
          </form>
        ) : (
          <dl className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Nombre</dt>
              <dd>{detail.customer?.name ?? "Cliente de prueba"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd>{detail.customer?.phone ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate">{detail.customer?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="mt-1 whitespace-pre-wrap">
                {detail.customer?.notes ?? "—"}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
