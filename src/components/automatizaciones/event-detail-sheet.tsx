"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { automationEventTypeLabel } from "@/lib/automation-labels";

const CANCELLATION_LABELS: Record<string, string> = {
  customer_replied: "El cliente respondió",
  conversation_closed: "La conversación se cerró",
  conversation_deleted: "La conversación se eliminó",
  rule_disabled: "La regla se pausó",
  human_takeover: "Un agente tomó el control",
  human_handoff: "La conversación fue derivada",
  handoff_no_longer_active: "La derivación ya no estaba activa",
  no_valid_recipients: "No había destinatarios activos permitidos",
  outbound_replaced: "Un mensaje más reciente reemplazó la programación",
  integration_disabled: "La integración dejó de estar disponible",
  organization_disabled: "La organización quedó deshabilitada",
  rule_invalid: "La configuración dejó de ser válida",
  source_invalid: "El mensaje de origen dejó de ser válido",
  maximum_reached: "Se alcanzó el máximo configurado",
  channel_unavailable: "El canal dejó de estar disponible",
  manual_cancelled: "Cancelado manualmente",
};

const EVENT_DETAIL_POLL_MS = 5_000;

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
    const activeEventId = eventId;
    const controller = new AbortController();
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    async function loadEvent() {
      try {
        const response = await fetch(
          `/api/automation/events/${encodeURIComponent(activeEventId)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          }
        );
        const body = (await response.json()) as {
          event?: AutomationEventDetail;
          message?: string;
        };
        if (!response.ok || !body.event) {
          throw new Error(body.message ?? "No se pudo cargar el evento.");
        }
        setResult({ eventId: activeEventId, event: body.event, error: null });
        if (
          body.event.status === "PENDING" ||
          body.event.status === "PROCESSING"
        ) {
          pollTimer = setTimeout(loadEvent, EVENT_DETAIL_POLL_MS);
        }
      } catch (reason: unknown) {
        if (!controller.signal.aborted) {
          setResult({
            eventId: activeEventId,
            event: null,
            error:
              reason instanceof Error
                ? reason.message
                : "No se pudo cargar el evento.",
          });
        }
      }
    }

    void loadEvent();
    return () => {
      controller.abort();
      if (pollTimer) clearTimeout(pollTimer);
    };
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
                <h3 className="mt-1 font-semibold">{automationEventTypeLabel(event.type)}</h3>
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
                <DataRow label={event.type === "conversation.followup_due" ? "Fecha programada" : "Próximo intento"} value={formatDateTime(event.nextAttemptAt)} />
                <DataRow label="Procesado" value={formatDateTime(event.processedAt)} />
                {event.conversationId && (
                  <DataRow
                    label="Conversación"
                    value={
                      <Link
                        href={`/dashboard/conversaciones?conversacion=${encodeURIComponent(event.conversationId)}`}
                        className="text-[#8eacff] hover:underline"
                      >
                        Abrir conversación
                      </Link>
                    }
                  />
                )}
                {event.sourceMessageId && <DataRow label="Mensaje origen" value={<span className="font-mono text-xs">{event.sourceMessageId}</span>} />}
                {event.ruleType && <DataRow label="Regla" value={event.ruleType === "HANDOFF_ALERT" ? "Aviso de atención humana" : "Seguimiento automático"} />}
                {event.followUpNumber && <DataRow label="Seguimiento" value={`${event.followUpNumber} en la conversación`} />}
                {event.schedulingReason && <DataRow label="Programación" value={event.schedulingReason === "outbound_message_unanswered" ? "Esperando respuesta del cliente" : event.schedulingReason} />}
                {event.cancellationReason && <DataRow label="Cancelación" value={CANCELLATION_LABELS[event.cancellationReason] ?? event.cancellationReason} />}
                {event.actionDeliveryStatus && <DataRow label="Envío" value={event.actionDeliveryStatus.toLowerCase()} />}
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
