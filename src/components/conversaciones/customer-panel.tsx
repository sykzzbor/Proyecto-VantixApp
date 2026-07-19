"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Bot,
  CalendarDays,
  ChevronDown,
  History,
  NotebookText,
  Pencil,
  UserRound,
} from "lucide-react";
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

function PanelSection({
  title,
  icon: Icon,
  children,
  open = false,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="group border-b border-border/70 last:border-0" open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3.5 text-sm font-semibold marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/35">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="flex-1">{title}</span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
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
  const [editing, setEditing] = useState(false);
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
  }, [detail, reset]);

  async function onSubmit(values: CustomerFormInput) {
    const result = await saveConversationCustomer(detail.id, values);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(detail.customer ? "Cliente actualizado." : "Cliente creado y vinculado.");
    reset(values);
    setEditing(false);
  }

  const assignedMembershipId =
    members.find((member) => member.userId === detail.assigned?.userId)?.id ??
    "unassigned";
  const fieldId = (name: string) => `${name}-${instanceId}-${detail.id}`;
  const channelLabel =
    detail.channel === "test"
      ? "Prueba"
      : detail.channel === "whatsapp"
        ? "WhatsApp"
        : detail.channel;

  return (
    <div className="bg-card/35">
      <PanelSection title="Cliente" icon={UserRound} open>
        {editing ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-name")}>Nombre</Label>
              <Input id={fieldId("customer-name")} placeholder="Nombre del cliente" {...register("name")} />
              <FieldError message={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-phone")}>Teléfono</Label>
              <Input id={fieldId("customer-phone")} type="tel" placeholder="+54 9 11 5555-0000" {...register("phone")} />
              <FieldError message={errors.phone?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-email")}>Email</Label>
              <Input id={fieldId("customer-email")} type="email" placeholder="cliente@email.com" {...register("email")} />
              <FieldError message={errors.email?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={fieldId("customer-notes")}>Notas internas</Label>
              <Textarea id={fieldId("customer-notes")} rows={3} placeholder="Preferencias y contexto útil." {...register("notes")} />
              <FieldError message={errors.notes?.message} />
            </div>
            <div className="flex gap-2">
              <SubmitButton loading={isSubmitting} disabled={!isDirty} size="sm" className="flex-1">
                Guardar
              </SubmitButton>
              <Button type="button" size="sm" variant="outline" disabled={isSubmitting} onClick={() => { reset(toDefaults(detail)); setEditing(false); }}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <dl className="space-y-2 text-xs">
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Nombre</dt>
                <dd className="max-w-40 truncate text-right font-medium">{detail.customer?.name ?? "Cliente sin registrar"}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Teléfono</dt>
                <dd className="max-w-40 break-all text-right">{detail.customer?.phone ?? "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="max-w-40 truncate text-right" title={detail.customer?.email ?? undefined}>{detail.customer?.email ?? "—"}</dd>
              </div>
            </dl>
            {canEdit && (
              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" aria-hidden />
                Editar datos
              </Button>
            )}
          </div>
        )}
      </PanelSection>

      <PanelSection title="Gestión" icon={Bot} open>
        <div className="space-y-3">
          <dl className="space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Canal</dt>
              <dd>
                <Badge variant="secondary" className="gap-1 font-normal">
                  {detail.channel === "whatsapp" && <WhatsappIcon className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />}
                  {channelLabel}
                </Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Estado</dt>
              <dd className="font-medium">{STATUS_LABEL[detail.status]}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Atención</dt>
              <dd className="font-medium">{detail.handlingMode === "ai" ? "IA activa" : "Humana"}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">Responsable</dt>
              <dd className="max-w-36 truncate text-right font-medium">{detail.assigned?.name ?? "Sin asignar"}</dd>
            </div>
          </dl>

          {canRespond && detail.status !== "closed" && (
            detail.handlingMode === "human" ? (
              <Button type="button" variant="outline" size="sm" className="w-full justify-start" disabled={isPending} onClick={onReturnToAI}>
                <Bot className="size-4" aria-hidden />
                Devolver a la IA
              </Button>
            ) : (
              <Button type="button" size="sm" className="w-full justify-start" disabled={isPending} onClick={onTake}>
                <UserRound className="size-4" aria-hidden />
                Tomar conversación
              </Button>
            )
          )}

          {canManage && (
            <div className="grid gap-3 border-t border-border/70 pt-3">
              <div className="space-y-1.5">
                <Label htmlFor={fieldId("conversation-status")}>Estado</Label>
                <Select value={detail.status.toUpperCase()} disabled={isPending} onValueChange={(value) => onStatusChange?.(value as "OPEN" | "PENDING" | "CLOSED")}>
                  <SelectTrigger id={fieldId("conversation-status")} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="OPEN">Abierta</SelectItem>
                    <SelectItem value="PENDING">Pendiente</SelectItem>
                    <SelectItem value="CLOSED">Cerrada</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={fieldId("conversation-owner")}>Responsable</Label>
                <Select value={assignedMembershipId} disabled={isPending} onValueChange={(value) => onAssign?.(value === "unassigned" ? null : value)}>
                  <SelectTrigger id={fieldId("conversation-owner")} className="w-full"><SelectValue placeholder="Sin responsable" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Sin responsable</SelectItem>
                    {members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      </PanelSection>

      <PanelSection title="Google Calendar" icon={CalendarDays}>
        {detail.appointments.length === 0 ? (
          <p className="text-xs text-muted-foreground">Este cliente no tiene turnos registrados.</p>
        ) : (
          <ul className="space-y-2">
            {detail.appointments.map((appointment, index) => (
              <li key={`${appointment.whenLabel}-${index}`} className="rounded-lg border border-border/70 bg-background/45 p-2.5 text-xs">
                <p className={appointment.upcoming ? "font-medium" : "text-muted-foreground"}>{appointment.whenLabel}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{appointment.statusLabel}</p>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      <PanelSection title="Notas" icon={NotebookText}>
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
          {detail.customer?.notes ?? "Sin notas internas."}
        </p>
      </PanelSection>

      <PanelSection title="Historial" icon={History}>
        <dl className="space-y-2 text-xs">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Primera conversación</dt>
            <dd className="text-right">{detail.createdAtLabel}</dd>
          </div>
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Última actividad</dt>
            <dd className="text-right">{detail.lastActivityLabel ?? "—"}</dd>
          </div>
          {detail.humanTakeoverAtLabel && (
            <div className="flex items-start justify-between gap-3">
              <dt className="text-muted-foreground">Último control humano</dt>
              <dd className="text-right">{detail.humanTakeoverAtLabel}</dd>
            </div>
          )}
        </dl>
      </PanelSection>
    </div>
  );
}
