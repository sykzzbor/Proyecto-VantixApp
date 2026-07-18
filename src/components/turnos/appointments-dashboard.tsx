"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarClock, CalendarPlus, Filter, Loader2, RefreshCcw, RotateCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatLocalMinute, localMinuteToUtc } from "@/lib/time-zone";
import type {
  AppointmentReadiness,
  AppointmentView,
} from "@/server/appointments/service";

type EditorMode = { type: "create" } | { type: "reschedule"; appointment: AppointmentView };

const STATUS_LABELS: Record<AppointmentView["status"], string> = {
  PENDING: "Procesando",
  CONFIRMED: "Confirmado",
  RESCHEDULED: "Reprogramado",
  CANCELLED: "Cancelado",
  FAILED: "Con error",
};

const STATUS_STYLES: Record<AppointmentView["status"], string> = {
  PENDING: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  CONFIRMED: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  RESCHEDULED: "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  CANCELLED: "border-border bg-muted text-muted-foreground",
  FAILED: "border-destructive/25 bg-destructive/10 text-destructive",
};

function newKey() {
  return crypto.randomUUID();
}

async function safePayload(response: Response) {
  return (await response.json().catch(() => ({}))) as {
    message?: string;
    appointment?: AppointmentView;
    appointments?: AppointmentView[];
  };
}

function localDate(appointment: AppointmentView) {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: appointment.timezone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(appointment.startAt));
}

function localDateKey(appointment: AppointmentView) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: appointment.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(appointment.startAt));
}

export function AppointmentsDashboard({
  initialAppointments,
  readiness,
  canManage,
}: {
  initialAppointments: AppointmentView[];
  readiness: AppointmentReadiness;
  canManage: boolean;
}) {
  const [appointments, setAppointments] = useState(initialAppointments);
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [cancelTarget, setCancelTarget] = useState<AppointmentView | null>(null);
  const [busy, setBusy] = useState<"refresh" | "save" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operationKey, setOperationKey] = useState(newKey);
  const [startLocal, setStartLocal] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dateFilter, setDateFilter] = useState("");

  const timeZone = readiness.timeZone ?? "UTC";
  const filteredAppointments = appointments.filter((appointment) => {
    if (statusFilter !== "ALL" && appointment.status !== statusFilter) return false;
    if (dateFilter && localDateKey(appointment) !== dateFilter) return false;
    return true;
  });
  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      const response = await fetch("/api/appointments?limit=100", { cache: "no-store" });
      const payload = await safePayload(response);
      if (!response.ok || !payload.appointments) {
        setError(payload.message ?? "No se pudieron actualizar los turnos.");
        return;
      }
      setAppointments(payload.appointments);
    } catch {
      setError("No se pudieron actualizar los turnos.");
    } finally {
      setBusy(null);
    }
  }

  function openCreate() {
    const nextHour = new Date(Date.now() + 60 * 60 * 1000);
    nextHour.setUTCMinutes(0, 0, 0);
    setOperationKey(newKey());
    setStartLocal(formatLocalMinute(nextHour, timeZone));
    setCustomerName("");
    setCustomerPhone("");
    setTitle("");
    setNotes("");
    setEditor({ type: "create" });
  }

  function openReschedule(appointment: AppointmentView) {
    setOperationKey(newKey());
    setStartLocal(formatLocalMinute(new Date(appointment.startAt), timeZone));
    setEditor({ type: "reschedule", appointment });
  }

  async function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!editor) return;
    let startAt: string;
    try {
      startAt = localMinuteToUtc(startLocal, timeZone).toISOString();
    } catch {
      toast.error("La fecha local es inválida o ambigua para la zona horaria elegida.");
      return;
    }
    setBusy("save");
    try {
      const isCreate = editor.type === "create";
      const response = await fetch(
        isCreate ? "/api/appointments" : `/api/appointments/${editor.appointment.id}`,
        {
          method: isCreate ? "POST" : "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            isCreate
              ? {
                  startAt,
                  customerName,
                  customerPhone,
                  title: title || undefined,
                  notes,
                  idempotencyKey: operationKey,
                }
              : { startAt, idempotencyKey: operationKey }
          ),
        }
      );
      const payload = await safePayload(response);
      if (!response.ok || !payload.appointment) {
        toast.error(payload.message ?? "No se pudo guardar el turno.");
        if (payload.appointment) await refresh();
        return;
      }
      toast.success(isCreate ? "Turno creado en Google Calendar." : "Turno reprogramado.");
      setEditor(null);
      await refresh();
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setBusy(null);
    }
  }

  function openCancel(appointment: AppointmentView) {
    setOperationKey(newKey());
    setCancelReason("");
    setCancelTarget(appointment);
  }

  async function confirmCancel(event: React.FormEvent) {
    event.preventDefault();
    if (!cancelTarget) return;
    setBusy("cancel");
    try {
      const response = await fetch(`/api/appointments/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: cancelReason, idempotencyKey: operationKey }),
      });
      const payload = await safePayload(response);
      if (!response.ok || !payload.appointment) {
        toast.error(payload.message ?? "No se pudo cancelar el turno.");
        if (payload.appointment) await refresh();
        return;
      }
      toast.success("Turno cancelado.");
      setCancelTarget(null);
      await refresh();
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{readiness.message}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {readiness.ready
              ? `${readiness.durationMinutes} minutos · ${readiness.timeZone}`
              : "La gestión permanece bloqueada hasta completar este paso."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {!readiness.ready && (
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/integraciones">Abrir Integraciones</Link>
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            disabled={!canManage || !readiness.ready || busy !== null}
            onClick={openCreate}
          >
            <CalendarPlus className="size-4" aria-hidden />
            Crear turno
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Agenda de turnos</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {appointments.length} turno{appointments.length === 1 ? "" : "s"} en el período disponible
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Filter className="size-3.5" aria-hidden />
                Filtros
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Filtrar por estado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los estados</SelectItem>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                value={dateFilter}
                onChange={(event) => setDateFilter(event.target.value)}
                className="w-full sm:w-40"
                aria-label="Filtrar por fecha"
              />
              {(statusFilter !== "ALL" || dateFilter) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStatusFilter("ALL");
                    setDateFilter("");
                  }}
                >
                  Limpiar
                </Button>
              )}
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={busy !== null}
              aria-label="Actualizar turnos"
              onClick={() => void refresh()}
            >
              {busy === "refresh" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCcw className="size-4" aria-hidden />
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredAppointments.length === 0 ? (
            <div className="flex flex-col items-center px-4 py-14 text-center">
              <CalendarClock className="size-8 text-muted-foreground/60" aria-hidden />
              <p className="mt-3 text-sm font-medium">
                {appointments.length === 0 ? "Todavía no hay turnos próximos" : "No hay turnos con estos filtros"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                {appointments.length === 0
                  ? "Cuando crees un turno aparecerá aquí sin exponer datos privados de Google."
                  : "Cambiá el estado o la fecha para volver a ver la agenda."}
              </p>
            </div>
          ) : (
            <>
            <ul className="divide-y divide-border/70 md:hidden">
              {filteredAppointments.map((appointment) => {
                const mutable = !["CANCELLED", "PENDING"].includes(appointment.status);
                return (
                  <li key={appointment.id} className="p-4">
                    <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-medium">{appointment.customerName}</p>
                          <Badge variant="outline" className={STATUS_STYLES[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
                          <Badge variant="secondary">
                            {appointment.source === "AI" ? "IA" : "Manual"}
                          </Badge>
                        </div>
                        <p className="mt-1 truncate text-sm text-muted-foreground">
                          {appointment.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {localDate(appointment)} · {appointment.timezone}
                        </p>
                        {appointment.lastError && (
                          <p className="mt-2 text-xs text-destructive">{appointment.lastError}</p>
                        )}
                      </div>
                      {canManage && (
                        <div className="flex flex-col gap-2 min-[390px]:flex-row md:shrink-0">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!readiness.ready || !readiness.allowRescheduling || !mutable || busy !== null}
                            onClick={() => openReschedule(appointment)}
                          >
                            <RotateCw className="size-4" aria-hidden />
                            Reprogramar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={!readiness.ready || !readiness.allowCancellation || !mutable || busy !== null}
                            onClick={() => openCancel(appointment)}
                          >
                            <XCircle className="size-4" aria-hidden />
                            Cancelar
                          </Button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Fecha y hora local</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Origen</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAppointments.map((appointment) => {
                    const mutable = !["CANCELLED", "PENDING"].includes(appointment.status);
                    return (
                      <TableRow key={appointment.id}>
                        <TableCell>
                          <div className="max-w-64">
                            <p className="truncate font-medium">{appointment.customerName}</p>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">{appointment.title}</p>
                            {appointment.lastError && <p className="mt-1 line-clamp-1 text-xs text-destructive">{appointment.lastError}</p>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="whitespace-nowrap text-sm">{localDate(appointment)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{appointment.timezone}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_STYLES[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{appointment.source === "AI" ? "IA" : "Manual"}</Badge>
                        </TableCell>
                        <TableCell>
                          {canManage ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                disabled={!readiness.ready || !readiness.allowRescheduling || !mutable || busy !== null}
                                onClick={() => openReschedule(appointment)}
                              >
                                <RotateCw className="size-4" aria-hidden />
                                Reprogramar
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={!readiness.ready || !readiness.allowCancellation || !mutable || busy !== null}
                                onClick={() => openCancel(appointment)}
                              >
                                <XCircle className="size-4" aria-hidden />
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <span className="block text-right text-xs text-muted-foreground">Solo lectura</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={editor !== null} onOpenChange={(open) => !open && setEditor(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editor?.type === "create" ? "Crear turno" : "Reprogramar turno"}</DialogTitle>
            <DialogDescription>
              El horario se interpreta en {timeZone} y se vuelve a validar antes de escribir en Google.
            </DialogDescription>
          </DialogHeader>
          <form id="appointment-editor" className="space-y-4" onSubmit={saveEditor}>
            {editor?.type === "create" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="appointment-customer">Cliente</Label>
                  <Input id="appointment-customer" maxLength={120} required value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="appointment-phone">Teléfono E.164 (opcional)</Label>
                    <Input id="appointment-phone" inputMode="tel" maxLength={30} placeholder="+5493511234567" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="appointment-title">Título (opcional)</Label>
                    <Input id="appointment-title" maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} />
                  </div>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="appointment-start">Fecha y hora local</Label>
              <Input id="appointment-start" type="datetime-local" required value={startLocal} onChange={(event) => setStartLocal(event.target.value)} />
            </div>
            {editor?.type === "create" && (
              <div className="space-y-2">
                <Label htmlFor="appointment-notes">Notas (opcional)</Label>
                <Textarea id="appointment-notes" maxLength={1000} rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
            )}
          </form>
          <DialogFooter showCloseButton>
            <Button type="submit" form="appointment-editor" disabled={busy !== null}>
              {busy === "save" && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar turno</DialogTitle>
            <DialogDescription>
              Se eliminará el evento de Google Calendar, pero el historial local se conservará.
            </DialogDescription>
          </DialogHeader>
          <form id="appointment-cancel" className="space-y-2" onSubmit={confirmCancel}>
            <Label htmlFor="appointment-cancel-reason">Motivo (opcional)</Label>
            <Textarea id="appointment-cancel-reason" maxLength={240} rows={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </form>
          <DialogFooter showCloseButton>
            <Button type="submit" form="appointment-cancel" variant="destructive" disabled={busy !== null}>
              {busy === "cancel" && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Confirmar cancelación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
