"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  APPOINTMENT_DAY_LABELS,
  APPOINTMENT_DURATION_OPTIONS,
  type AppointmentDaySchedule,
  type AppointmentSettingsInput,
} from "@/lib/validations/appointment-settings";
import type {
  AppointmentSettingsStatus,
  AppointmentSettingsView,
} from "@/server/appointments/settings";

type AvailabilitySlot = {
  startUtc: string;
  endUtc: string;
  startLocal: string;
  endLocal: string;
  timeZone: string;
};

type SettingsPayload = Partial<AppointmentSettingsView> & {
  ok?: boolean;
  message?: string;
};

const STATUS_LABELS: Record<AppointmentSettingsStatus, string> = {
  MISSING_GOOGLE: "Sin Google conectado",
  MISSING_CALENDAR: "Sin calendario elegido",
  INCOMPLETE: "Configuración incompleta",
  DISABLED: "Reservas desactivadas",
  READY: "Listo",
  ERROR: "Requiere revisión",
};

function settingsPayloadIsComplete(
  payload: SettingsPayload
): payload is AppointmentSettingsView & { ok?: boolean; message?: string } {
  return Boolean(payload.settings && payload.status && payload.prerequisites);
}

export function GoogleCalendarAppointmentSettings({
  canManage,
}: {
  canManage: boolean;
}) {
  const [view, setView] = useState<AppointmentSettingsView | null>(null);
  const [settings, setSettings] = useState<AppointmentSettingsInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slots, setSlots] = useState<AvailabilitySlot[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/appointments/settings", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as SettingsPayload;
        if (!response.ok || !settingsPayloadIsComplete(payload)) {
          throw new Error(payload.message ?? "No se pudo cargar la configuración.");
        }
        setView(payload);
        setSettings(payload.settings);
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : "No se pudo cargar la configuración."
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  function updateDay(dayNumber: number, update: (day: AppointmentDaySchedule) => AppointmentDaySchedule) {
    if (!settings) return;
    setSettings({
      ...settings,
      weeklySchedule: settings.weeklySchedule.map((day) =>
        day.day === dayNumber ? update(day) : day
      ),
    });
    setSlots(null);
  }

  async function save() {
    if (!settings) return;
    setBusy("save");
    setError(null);
    try {
      const response = await fetch("/api/appointments/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = (await response.json().catch(() => ({}))) as SettingsPayload;
      if (!response.ok || !settingsPayloadIsComplete(payload)) {
        setError(payload.message ?? "No se pudo guardar la configuración.");
        return;
      }
      setView(payload);
      setSettings(payload.settings);
      setSlots(null);
      toast.success("Configuración de turnos guardada.");
    } catch {
      setError("No se pudo guardar la configuración.");
    } finally {
      setBusy(null);
    }
  }

  async function testAvailability() {
    if (!settings) return;
    setBusy("test");
    setError(null);
    setSlots(null);
    try {
      const from = new Date();
      const days = Math.min(7, settings.maxAdvanceDays);
      const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
      const response = await fetch("/api/appointments/availability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: from.toISOString(), to: to.toISOString() }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        message?: string;
        availability?: { slots?: AvailabilitySlot[] };
      };
      if (!response.ok || !payload.availability?.slots) {
        setError(payload.message ?? "No se pudo probar la disponibilidad.");
        return;
      }
      setSlots(payload.availability.slots);
      toast.success("Disponibilidad consultada correctamente.");
    } catch {
      setError("No se pudo probar la disponibilidad.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border/70 p-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Cargando configuración de turnos…
      </div>
    );
  }

  if (!settings || !view) {
    return (
      <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
        {error ?? "No se pudo cargar la configuración de turnos."}
      </div>
    );
  }

  const prerequisitesReady =
    view.prerequisites.googleConnected && view.prerequisites.calendarSelected;
  const disabled = !canManage || busy !== null;

  return (
    <section className="space-y-4 rounded-xl border border-border/70 bg-background/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-primary" aria-hidden />
            Configuración de turnos
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Definí cuándo puede ofrecerse disponibilidad y cómo se preparan las reservas.
          </p>
        </div>
        <Badge variant="outline">{STATUS_LABELS[view.status]}</Badge>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 p-3">
        <div>
          <Label htmlFor="appointments-enabled">Activar reservas</Label>
          <p className="text-xs text-muted-foreground">
            Requiere Google conectado, calendario elegido y horarios completos.
          </p>
        </div>
        <Switch
          id="appointments-enabled"
          checked={settings.enabled}
          disabled={disabled || (!settings.enabled && !prerequisitesReady)}
          onCheckedChange={(enabled) => {
            setSettings({ ...settings, enabled });
            setSlots(null);
          }}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="appointments-timezone">Zona horaria IANA</Label>
          <Input
            id="appointments-timezone"
            list="appointment-timezones"
            value={settings.timeZone}
            readOnly={!canManage}
            disabled={busy !== null}
            onChange={(event) => setSettings({ ...settings, timeZone: event.target.value })}
          />
          <datalist id="appointment-timezones">
            <option value="UTC" />
            <option value="America/Argentina/Cordoba" />
            <option value="America/Argentina/Buenos_Aires" />
            <option value="America/Santiago" />
            <option value="America/Mexico_City" />
            <option value="America/Bogota" />
            <option value="Europe/Madrid" />
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appointments-duration">Duración predeterminada</Label>
          <Select
            value={String(settings.defaultDurationMinutes)}
            disabled={disabled}
            onValueChange={(value) =>
              setSettings({ ...settings, defaultDurationMinutes: Number(value) })
            }
          >
            <SelectTrigger id="appointments-duration" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APPOINTMENT_DURATION_OPTIONS.map((minutes) => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {minutes} minutos
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appointments-buffer">Descanso entre turnos</Label>
          <Input
            id="appointments-buffer"
            type="number"
            min={0}
            max={120}
            step={5}
            value={settings.bufferMinutes}
            readOnly={!canManage}
            disabled={busy !== null}
            onChange={(event) =>
              setSettings({ ...settings, bufferMinutes: Number(event.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appointments-notice">Anticipación mínima (minutos)</Label>
          <Input
            id="appointments-notice"
            type="number"
            min={0}
            max={43200}
            value={settings.minimumNoticeMinutes}
            readOnly={!canManage}
            disabled={busy !== null}
            onChange={(event) =>
              setSettings({ ...settings, minimumNoticeMinutes: Number(event.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="appointments-advance">Máximo de días futuros</Label>
          <Input
            id="appointments-advance"
            type="number"
            min={1}
            max={365}
            value={settings.maxAdvanceDays}
            readOnly={!canManage}
            disabled={busy !== null}
            onChange={(event) =>
              setSettings({ ...settings, maxAdvanceDays: Number(event.target.value) })
            }
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2 xl:col-span-1">
          <Label htmlFor="appointments-location">Ubicación o modalidad</Label>
          <Input
            id="appointments-location"
            maxLength={200}
            value={settings.location}
            readOnly={!canManage}
            disabled={busy !== null}
            placeholder="Presencial, videollamada…"
            onChange={(event) => setSettings({ ...settings, location: event.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="appointments-title">Título predeterminado del evento</Label>
          <Input
            id="appointments-title"
            maxLength={120}
            value={settings.defaultEventTitle}
            readOnly={!canManage}
            disabled={busy !== null}
            onChange={(event) =>
              setSettings({ ...settings, defaultEventTitle: event.target.value })
            }
          />
        </div>
      </div>

      <Separator />

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Días y horarios</p>
          <p className="text-xs text-muted-foreground">Hasta cuatro rangos sin superposición por día.</p>
        </div>
        {settings.weeklySchedule.map((day) => (
          <div key={day.day} className="grid min-w-0 gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <div className="flex items-center justify-between gap-2 sm:justify-start">
              <Switch
                id={`appointment-day-${day.day}`}
                checked={day.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) =>
                  updateDay(day.day, (current) => ({ ...current, enabled }))
                }
              />
              <Label htmlFor={`appointment-day-${day.day}`}>
                {APPOINTMENT_DAY_LABELS[day.day - 1]}
              </Label>
            </div>
            <div className="min-w-0 space-y-2">
              {day.ranges.map((range, rangeIndex) => (
                <div key={`${day.day}-${rangeIndex}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.5rem] gap-2">
                  <Input
                    type="time"
                    step={300}
                    aria-label={`Inicio ${APPOINTMENT_DAY_LABELS[day.day - 1]}`}
                    value={range.start}
                    readOnly={!canManage}
                    disabled={busy !== null || !day.enabled}
                    onChange={(event) =>
                      updateDay(day.day, (current) => ({
                        ...current,
                        ranges: current.ranges.map((item, index) =>
                          index === rangeIndex ? { ...item, start: event.target.value } : item
                        ),
                      }))
                    }
                  />
                  <Input
                    type="time"
                    step={300}
                    aria-label={`Fin ${APPOINTMENT_DAY_LABELS[day.day - 1]}`}
                    value={range.end}
                    readOnly={!canManage}
                    disabled={busy !== null || !day.enabled}
                    onChange={(event) =>
                      updateDay(day.day, (current) => ({
                        ...current,
                        ranges: current.ranges.map((item, index) =>
                          index === rangeIndex ? { ...item, end: event.target.value } : item
                        ),
                      }))
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar rango de ${APPOINTMENT_DAY_LABELS[day.day - 1]}`}
                    disabled={disabled}
                    onClick={() =>
                      updateDay(day.day, (current) => ({
                        ...current,
                        ranges: current.ranges.filter((_, index) => index !== rangeIndex),
                      }))
                    }
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {day.ranges.length === 0 && (
                <p className="text-xs text-muted-foreground">Sin horarios configurados.</p>
              )}
              {canManage && day.enabled && day.ranges.length < 4 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    updateDay(day.day, (current) => ({
                      ...current,
                      ranges: [...current.ranges, { start: "09:00", end: "18:00" }],
                    }))
                  }
                >
                  <Plus className="size-4" aria-hidden />
                  Agregar rango
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
          <Label htmlFor="appointments-reschedule">Permitir reprogramación futura</Label>
          <Switch
            id="appointments-reschedule"
            checked={settings.allowRescheduling}
            disabled={disabled}
            onCheckedChange={(allowRescheduling) =>
              setSettings({ ...settings, allowRescheduling })
            }
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border/60 p-3">
          <Label htmlFor="appointments-cancellation">Permitir cancelación futura</Label>
          <Switch
            id="appointments-cancellation"
            checked={settings.allowCancellation}
            disabled={disabled}
            onCheckedChange={(allowCancellation) =>
              setSettings({ ...settings, allowCancellation })
            }
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {slots && (
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <p className="text-sm font-medium">
            {slots.length > 0
              ? `${slots.length} horarios disponibles en la prueba`
              : "No hay horarios disponibles en el rango probado"}
          </p>
          {slots.length > 0 && (
            <ul className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {slots.slice(0, 8).map((slot) => (
                <li key={slot.startUtc} className="truncate">
                  {slot.startLocal.replace("T", " ").slice(0, 16)} ({slot.timeZone})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {canManage && (
          <Button type="button" disabled={busy !== null} onClick={() => void save()}>
            {busy === "save" && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Guardar configuración
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy !== null || view.status !== "READY"}
          onClick={() => void testAvailability()}
        >
          {busy === "test" && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Probar disponibilidad
        </Button>
        {!canManage && (
          <p className="self-center text-xs text-muted-foreground">
            Vista de solo lectura.
          </p>
        )}
      </div>
    </section>
  );
}
