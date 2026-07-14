"use client";

import { useEffect, useState } from "react";
import { Ban, LoaderCircle, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { AutomationStatusBadge } from "@/components/automatizaciones/automation-status-badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { AutomationEventDetail } from "@/server/automation/dashboard";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
    </div>
  );
}

export function EventDetailSheet({
  eventId,
  organizationName,
  canManage,
  onOpenChange,
  onChanged,
}: {
  eventId: string | null;
  organizationName: string;
  canManage: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [result, setResult] = useState<{
    eventId: string;
    event: AutomationEventDetail | null;
    error: string | null;
  } | null>(null);
  const [action, setAction] = useState<"retry" | "cancel" | null>(null);

  useEffect(() => {
    if (!eventId) return;
    const controller = new AbortController();
    fetch(`/api/automation/events/${encodeURIComponent(eventId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          event?: AutomationEventDetail;
          message?: string;
        };
        if (!response.ok || !body.event) {
          throw new Error(body.message ?? "No se pudo cargar el evento.");
        }
        setResult({ eventId, event: body.event, error: null });
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            eventId,
            event: null,
            error:
              reason instanceof Error
                ? reason.message
                : "No se pudo cargar el evento.",
          });
        }
      });
    return () => controller.abort();
  }, [eventId]);

  const currentResult = result?.eventId === eventId ? result : null;
  const event = currentResult?.event ?? null;
  const error = currentResult?.error ?? null;
  const loading = Boolean(eventId && !currentResult);

  async function runAction(kind: "retry" | "cancel") {
    if (!eventId || !event) return;
    const prompt =
      kind === "retry"
        ? "¿Reintentar este evento desde el primer intento?"
        : "¿Cancelar este evento pendiente?";
    if (!window.confirm(prompt)) return;
    setAction(kind);
    try {
      const response = await fetch(
        `/api/automation/events/${encodeURIComponent(eventId)}/${kind}`,
        { method: "POST" }
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "No se pudo actualizar el evento.");
      toast.success(kind === "retry" ? "Evento programado nuevamente" : "Evento cancelado");
      onChanged();
      onOpenChange(false);
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "No se pudo actualizar el evento.");
    } finally {
      setAction(null);
    }
  }

  return (
    <Sheet open={Boolean(eventId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(96vw,42rem)]! overflow-y-auto sm:max-w-none">
        <SheetHeader className="border-b">
          <SheetTitle>Detalle del evento</SheetTitle>
          <SheetDescription>
            Metadatos operativos y ejecuciones registradas.
          </SheetDescription>
        </SheetHeader>
        {loading ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-44 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : error ? (
          <div className="m-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <ShieldAlert className="mb-2 size-5" />
            {error}
          </div>
        ) : event ? (
          <div className="space-y-5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{event.shortId}</p>
                <h3 className="mt-1 font-semibold">{event.type}</h3>
              </div>
              <AutomationStatusBadge status={event.status} />
            </div>

            {canManage && (event.status === "FAILED" || event.status === "DEAD_LETTER" || event.status === "PENDING") && (
              <div className="flex flex-wrap gap-2 rounded-lg border bg-muted/30 p-3">
                {(event.status === "FAILED" || event.status === "DEAD_LETTER") && (
                  <Button size="sm" onClick={() => runAction("retry")} disabled={Boolean(action)}>
                    {action === "retry" ? <LoaderCircle className="animate-spin" /> : <RefreshCcw />}
                    Reintentar
                  </Button>
                )}
                {event.status === "PENDING" && (
                  <Button size="sm" variant="destructive" onClick={() => runAction("cancel")} disabled={Boolean(action)}>
                    {action === "cancel" ? <LoaderCircle className="animate-spin" /> : <Ban />}
                    Cancelar pendiente
                  </Button>
                )}
              </div>
            )}

            <section>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Información</h4>
              <dl className="rounded-lg border bg-card/50 px-3 py-2">
                <DataRow label="ID" value={<span className="font-mono text-xs">{event.shortId}</span>} />
                <DataRow label="Organización" value={organizationName} />
                <DataRow label="Idempotencia" value={<span className="font-mono text-xs">{event.idempotencyKey}</span>} />
                <DataRow label="Esquema" value={`v${event.schemaVersion}`} />
                <DataRow label="Intentos" value={`${event.attempts} de ${event.maxAttempts}`} />
                <DataRow label="Creado" value={formatDateTime(event.createdAt)} />
                <DataRow label="Actualizado" value={formatDateTime(event.updatedAt)} />
                <DataRow label="Próximo intento" value={formatDateTime(event.nextAttemptAt)} />
                <DataRow label="Procesado" value={formatDateTime(event.processedAt)} />
              </dl>
              {event.lastError && (
                <p className="mt-3 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-red-200">
                  {event.lastError}
                </p>
              )}
            </section>

            {Object.prototype.hasOwnProperty.call(event, "payload") && (
              <section>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Payload sanitizado</h4>
                <pre className="max-h-64 overflow-auto rounded-lg border bg-[#0b0e13] p-3 font-mono text-xs leading-relaxed text-slate-300">
                  {JSON.stringify(event.payload, null, 2)}
                </pre>
              </section>
            )}

            <Separator />
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ejecuciones</h4>
                <span className="text-xs text-muted-foreground">{event.runs.length}</span>
              </div>
              {event.runs.length === 0 ? (
                <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Todavía no hay ejecuciones.</p>
              ) : (
                <div className="space-y-2">
                  {event.runs.map((run) => (
                    <div key={run.id} className="rounded-lg border bg-card/50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">Intento {run.attempt} · {run.provider}</span>
                        <AutomationStatusBadge status={run.status} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{formatDateTime(run.startedAt)}</span>
                        <span>{formatDuration(run.durationMs)}</span>
                        {run.externalExecutionId && <span>Externo: {run.externalExecutionId}</span>}
                      </div>
                      {(run.errorCode || run.errorMessage) && (
                        <p className="mt-2 text-xs text-red-300">{run.errorCode ? `${run.errorCode}: ` : ""}{run.errorMessage}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
