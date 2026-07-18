"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, UserRound } from "lucide-react";
import { toast } from "sonner";
import {
  customerFormSchema,
  type CustomerFormInput,
} from "@/lib/validations/conversation";
import { saveConversationCustomer } from "@/server/actions/customers";
import type { ConversationDetail } from "@/server/inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  canRespond = false,
  canManage = false,
  members = [],
  isPending = false,
  onTake,
  onReturnToAI,
  onStatusChange,
  onAssign,
  instanceId = "panel",
}: {
  detail: ConversationDetail;
  canEdit: boolean;
  canRespond?: boolean;
  canManage?: boolean;
  members?: { id: string; userId: string; name: string }[];
  isPending?: boolean;
  onTake?: () => void;
  onReturnToAI?: () => void;
  onStatusChange?: (status: "OPEN" | "PENDING" | "CLOSED") => void;
  onAssign?: (membershipId: string | null) => void;
  instanceId?: string;
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

  const assignedMembershipId =
    members.find((member) => member.userId === detail.assigned?.userId)?.id ??
    "unassigned";
  const fieldId = (name: string) => `${name}-${instanceId}-${detail.id}`;

  return (
    <div className="space-y-4 p-4">
      {/* Datos de la conversación */}
      <section className="space-y-3 rounded-xl border border-border/75 bg-card/70 p-3.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Contexto
          </p>
          <h3 className="mt-1 text-sm font-semibold tracking-tight">Conversación</h3>
        </div>
        <dl className="space-y-2 text-xs">
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
            <dd className="font-medium text-foreground">{STATUS_LABEL[detail.status]}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Atención</dt>
            <dd className="font-medium text-foreground">
              {detail.handlingMode === "ai" ? "IA activa" : "Humana"}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Primera conversación</dt>
            <dd className="text-right text-foreground">{detail.createdAtLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Última actividad</dt>
            <dd className="text-right text-foreground">{detail.lastActivityLabel ?? "—"}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Responsable</dt>
            <dd className="max-w-32 truncate text-right text-foreground" title={detail.assigned?.name ?? "Sin asignar"}>
              {detail.assigned?.name ?? "Sin asignar"}
            </dd>
          </div>
        </dl>
      </section>

      {(canRespond || canManage) && (
        <section className="space-y-3 rounded-xl border border-border/75 bg-card/70 p-3.5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Gestión
            </p>
            <h3 className="mt-1 text-sm font-semibold tracking-tight">
              Acciones de la conversación
            </h3>
          </div>

          {canRespond && detail.status !== "closed" && (
            detail.handlingMode === "human" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full justify-start"
                disabled={isPending}
                onClick={onReturnToAI}
              >
                <Bot className="size-4" aria-hidden />
                Devolver a la IA
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="w-full justify-start"
                disabled={isPending}
                onClick={onTake}
              >
                <UserRound className="size-4" aria-hidden />
                Tomar conversación
              </Button>
            )
          )}

          {canManage && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={fieldId("conversation-status")}>Estado</Label>
                <Select
                  value={detail.status.toUpperCase()}
                  disabled={isPending}
                  onValueChange={(value) =>
                    onStatusChange?.(value as "OPEN" | "PENDING" | "CLOSED")
                  }
                >
                  <SelectTrigger id={fieldId("conversation-status")} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Abierta</SelectItem>
                    <SelectItem value="PENDING">Pendiente</SelectItem>
                    <SelectItem value="CLOSED">Cerrada</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={fieldId("conversation-owner")}>Responsable</Label>
                <Select
                  value={assignedMembershipId}
                  disabled={isPending}
                  onValueChange={(value) =>
                    onAssign?.(value === "unassigned" ? null : value)
                  }
                >
                  <SelectTrigger id={fieldId("conversation-owner")} className="w-full">
                    <SelectValue placeholder="Sin responsable" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Sin responsable</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Turnos vinculados a la conversación o al cliente */}
      <section className="space-y-3 rounded-xl border border-border/75 bg-card/70 p-3.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Agenda
          </p>
          <h3 className="mt-1 text-sm font-semibold tracking-tight">Turnos</h3>
        </div>
        {detail.appointments.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Este cliente no tiene turnos registrados.
          </p>
        ) : (
          <ul className="space-y-2">
            {detail.appointments.map((appointment, index) => (
              <li
                key={`${appointment.whenLabel}-${index}`}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span
                  className={
                    appointment.upcoming
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {appointment.whenLabel}
                </span>
                <Badge
                  variant="outline"
                  className={
                    appointment.statusLabel === "Cancelado"
                      ? "bg-muted/50 font-normal text-muted-foreground"
                      : appointment.statusLabel === "Con error"
                        ? "border-destructive/25 bg-destructive/10 font-normal text-destructive"
                      : appointment.upcoming
                        ? "border-emerald-500/20 bg-emerald-500/10 font-normal text-emerald-700 dark:text-emerald-300"
                        : "font-normal text-muted-foreground"
                  }
                >
                  {appointment.statusLabel}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Datos del cliente */}
      <section className="space-y-3 rounded-xl border border-border/75 bg-card/70 p-3.5">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Perfil
          </p>
          <h3 className="mt-1 text-sm font-semibold tracking-tight">Datos del cliente</h3>
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
              <Label htmlFor={fieldId("customer-name")}>Nombre</Label>
              <Input
                id={fieldId("customer-name")}
                placeholder="Cliente de prueba"
                {...register("name")}
              />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-phone")}>Teléfono</Label>
              <Input
                id={fieldId("customer-phone")}
                type="tel"
                placeholder="+54 9 11 5555-0000"
                {...register("phone")}
              />
              <FieldError message={errors.phone?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-email")}>Email</Label>
              <Input
                id={fieldId("customer-email")}
                type="email"
                placeholder="cliente@email.com"
                {...register("email")}
              />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-notes")}>Notas internas</Label>
              <Textarea
                id={fieldId("customer-notes")}
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
              <dd className="max-w-36 truncate text-right">{detail.customer?.name ?? "Cliente de prueba"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Teléfono</dt>
              <dd className="max-w-36 break-all text-right">{detail.customer?.phone ?? "—"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="max-w-36 truncate text-right" title={detail.customer?.email ?? undefined}>{detail.customer?.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Notas</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">
                {detail.customer?.notes ?? "—"}
              </dd>
            </div>
          </dl>
        )}
      </section>
    </div>
  );
}
