"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Activity,
  Ban,
  BellRing,
  CheckCircle2,
  Clock3,
  Gauge,
  Inbox,
  ListChecks,
  PlayCircle,
  PlugZap,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  Timer,
  TriangleAlert,
  Workflow,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { AutomationStatusBadge } from "@/components/automatizaciones/automation-status-badge";
import { AutomationRulesPanel } from "@/components/automatizaciones/automation-rules-panel";
import { EventDetailSheet } from "@/components/automatizaciones/event-detail-sheet";
import { TestEventDialog } from "@/components/automatizaciones/test-event-dialog";
import { EmptyState } from "@/components/dashboard/empty-state";
import { StatCard } from "@/components/dashboard/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumber } from "@/lib/format";
import { automationEventTypeLabel } from "@/lib/automation-labels";
import type {
  AutomationEventRow,
  AutomationInfrastructureStatus,
  AutomationOverview,
  AutomationRunRow,
  Paginated,
} from "@/server/automation/dashboard";
import type { AutomationRuleView } from "@/server/automation/rules";

type DashboardFilters = {
  period: "24h" | "7d" | "30d";
  tab: "events" | "runs" | "rules";
  eventStatus: string;
  eventType: string;
  eventSearch: string;
  eventOrder: "asc" | "desc";
  runStatus: string;
  runProvider: string;
  runType: string;
  runOrder: "asc" | "desc";
};

const EVENT_STATUS_OPTIONS = [
  ["PENDING", "Pendiente"],
  ["PROCESSING", "Procesando"],
  ["SUCCEEDED", "Exitosa"],
  ["FAILED", "Fallida"],
  ["DEAD_LETTER", "Sin reintentos"],
  ["CANCELLED", "Cancelada"],
] as const;

const RUN_STATUS_OPTIONS = [
  ["STARTED", "Iniciada"],
  ["SUCCEEDED", "Exitosa"],
  ["FAILED", "Fallida"],
] as const;

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) return "—";
  if (value < 1000) return `${value} ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)} s`;
  return `${(value / 60_000).toFixed(1)} min`;
}

function Pagination({
  data,
  onPage,
}: {
  data: Paginated<unknown>;
  onPage: (page: number) => void;
}) {
  if (data.total === 0) return null;
  const first = (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.page * data.pageSize, data.total);
  return (
    <div className="flex flex-col gap-3 border-t px-4 py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>{first}–{last} de {data.total}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>Anterior</Button>
        <span>Página {data.page} de {data.totalPages}</span>
        <Button variant="outline" size="xs" disabled={data.page >= data.totalPages} onClick={() => onPage(data.page + 1)}>Siguiente</Button>
      </div>
    </div>
  );
}

export function AutomationDashboard({
  overview,
  infrastructure,
  events,
  runs,
  eventTypes,
  providers,
  rules,
  filters,
  canManage,
  organizationName,
}: {
  overview: AutomationOverview;
  infrastructure: AutomationInfrastructureStatus;
  events: Paginated<AutomationEventRow>;
  runs: Paginated<AutomationRunRow>;
  eventTypes: string[];
  providers: string[];
  rules: AutomationRuleView[];
  filters: DashboardFilters;
  canManage: boolean;
  organizationName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function updateParams(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function refresh() {
    startRefresh(() => router.refresh());
  }

  useEffect(() => {
    const active = events.items.some((event) => event.status === "PENDING" || event.status === "PROCESSING");
    if (!active) return;
    const timer = window.setInterval(() => router.refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [events.items, router]);

  function onSearch(value: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => updateParams({ q: value.trim() || null, pagina: null }),
      300
    );
  }

  function clearEventFilters() {
    updateParams({ estado: null, tipo: null, q: null, orden: null, pagina: null });
  }

  async function testConnection() {
    setTestingConnection(true);
    try {
      const response = await fetch("/api/automation/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = (await response.json()) as {
        eventId?: string;
        message?: string;
      };
      if (!response.ok || !body.eventId) {
        throw new Error(body.message ?? "No se pudo probar la conexión.");
      }
      toast.success("Prueba enviada. El éxito se confirma cuando llega el callback.");
      setSelectedEventId(body.eventId);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo probar la conexión.");
    } finally {
      setTestingConnection(false);
    }
  }

  const stateMeta =
    infrastructure.state === "operational"
      ? { label: infrastructure.mockMode ? "Modo de prueba: Listo" : "Configurado", className: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: ShieldCheck }
      : infrastructure.state === "error"
        ? { label: "Con error", className: "border-destructive/25 bg-destructive/10 text-destructive", icon: XCircle }
        : { label: "Configuración incompleta", className: "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: TriangleAlert };
  const StateIcon = stateMeta.icon;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={filters.period} onValueChange={(value) => updateParams({ periodo: value === "7d" ? null : value, pagina: null, run_pagina: null })}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Período de automatizaciones">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="24h">Últimas 24 horas</SelectItem>
            <SelectItem value="7d">Últimos 7 días</SelectItem>
            <SelectItem value="30d">Últimos 30 días</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCcw className={refreshing ? "animate-spin" : undefined} />
            Actualizar
          </Button>
          {canManage && (
            <Button
              variant="outline"
              size="sm"
              onClick={testConnection}
              disabled={
                testingConnection ||
                !infrastructure.providerConfigured
              }
              title={
                !infrastructure.providerConfigured
                  ? "Las automatizaciones todavía no están listas para una prueba real"
                  : undefined
              }
            >
              <PlugZap className={testingConnection ? "animate-pulse" : undefined} />
              Probar conexión
            </Button>
          )}
          {canManage && infrastructure.mockMode && <TestEventDialog onCreated={(id) => { setSelectedEventId(id); refresh(); }} />}
        </div>
      </div>

      <Card className={infrastructure.mockMode ? "border-blue-400/25" : undefined}>
        <CardHeader className="border-b sm:grid-cols-[1fr_auto]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2"><Workflow className="size-4 text-primary" />Estado de automatizaciones</CardTitle>
              <Badge variant="outline" className={stateMeta.className}><StateIcon />{stateMeta.label}</Badge>
              {infrastructure.mockMode && <Badge>Modo de prueba</Badge>}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {infrastructure.mockMode
                ? "Modo de prueba activo: los eventos se simulan sin ejecutar acciones externas."
                : "Los flujos automáticos están conectados y listos para operar."}
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Resumen para negocio: qué falta, sin vocabulario técnico arriba. */}
          {infrastructure.readinessMissingCategories.length > 0 ? (
            <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
              Los flujos automáticos todavía no están listos:{" "}
              {infrastructure.readinessMissingCategories.length}{" "}
              {infrastructure.readinessMissingCategories.length === 1
                ? "paso pendiente"
                : "pasos pendientes"}
              . VantixApp mantiene esta preparación de forma interna.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              La preparación técnica está completa.
            </p>
          )}
          {infrastructure.lastError && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
              Último error: {infrastructure.lastError}
            </p>
          )}

          <div className="grid gap-3 rounded-lg border border-border/70 bg-background/40 p-3 sm:grid-cols-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Último evento</p>
              <p className="mt-1 text-xs font-medium">{formatDateTime(infrastructure.mockMode ? infrastructure.lastProcessedAt : infrastructure.lastEventSentAt)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Última confirmación</p>
              <p className="mt-1 text-xs font-medium">{formatDateTime(infrastructure.lastCallbackAt)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Última ejecución exitosa</p>
              <p className="mt-1 text-xs font-medium">{formatDateTime(infrastructure.lastSuccessfulRunAt)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3" aria-labelledby="automation-summary">
        <div className="flex items-center justify-between">
          <h3 id="automation-summary" className="text-sm font-semibold text-muted-foreground">Actividad del período</h3>
          <span className="text-xs text-muted-foreground">Datos reales de la organización</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Workflow} label="Eventos" value={formatNumber(overview.total)} />
          <StatCard icon={Gauge} label="Tasa de éxito" value={`${overview.successRate}%`} hint="Sobre eventos finalizados" />
          <StatCard icon={CheckCircle2} label="Exitosos" value={formatNumber(overview.succeeded)} />
          <StatCard icon={XCircle} label="Fallidos" value={formatNumber(overview.failed)} />
          <StatCard icon={Clock3} label="Pendientes" value={formatNumber(overview.pending)} />
          <StatCard icon={Activity} label="Procesando" value={formatNumber(overview.processing)} />
          <StatCard icon={TriangleAlert} label="Dead letter" value={formatNumber(overview.deadLetter)} hint="Sin reintentos disponibles" />
          <StatCard icon={Timer} label="Duración promedio" value={formatDuration(overview.averageDurationMs)} />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="automation-rule-metrics">
        <div className="flex items-center justify-between gap-3">
          <h3 id="automation-rule-metrics" className="text-sm font-semibold text-muted-foreground">Reglas operativas del período</h3>
          <span className="text-xs text-muted-foreground">Sin estimaciones históricas</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard icon={BellRing} label="Derivaciones solicitadas" value={formatNumber(overview.handoffRequested)} />
          <StatCard icon={Clock3} label="Seguimientos programados" value={formatNumber(overview.followUpsScheduled)} />
          <StatCard icon={Send} label="Seguimientos enviados" value={formatNumber(overview.followUpsSent)} />
          <StatCard icon={Ban} label="Seguimientos cancelados" value={formatNumber(overview.followUpsCancelled)} />
          <StatCard icon={XCircle} label="Seguimientos fallidos" value={formatNumber(overview.followUpsFailed)} />
        </div>
      </section>

      <Tabs value={filters.tab} onValueChange={(value) => updateParams({ tab: value === "events" ? null : value })}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="events"><ListChecks />Eventos <Badge variant="secondary">{events.total}</Badge></TabsTrigger>
          <TabsTrigger value="runs"><PlayCircle />Ejecuciones <Badge variant="secondary">{runs.total}</Badge></TabsTrigger>
          <TabsTrigger value="rules"><SlidersHorizontal />Reglas</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_12rem_14rem_10rem_auto]">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground" />
              <Input key={filters.eventSearch} defaultValue={filters.eventSearch} onChange={(event) => onSearch(event.target.value)} placeholder="Buscar por ID…" className="pl-9" aria-label="Buscar evento por ID" />
            </div>
            <Select value={filters.eventStatus || "all"} onValueChange={(value) => updateParams({ estado: value === "all" ? null : value, pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Estado del evento"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{EVENT_STATUS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.eventType || "all"} onValueChange={(value) => updateParams({ tipo: value === "all" ? null : value, pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Tipo del evento"><SelectValue placeholder="Todos los tipos" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{eventTypes.map((type) => <SelectItem key={type} value={type}>{automationEventTypeLabel(type)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.eventOrder} onValueChange={(value) => updateParams({ orden: value === "desc" ? null : value, pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Orden de eventos"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="desc">Más recientes</SelectItem><SelectItem value="asc">Más antiguos</SelectItem></SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={clearEventFilters}><RotateCcw />Limpiar</Button>
          </div>

          {events.items.length === 0 ? (
            <EmptyState icon={Inbox} title="No hay eventos para mostrar" description="Ajustá los filtros o generá un evento de prueba con el proveedor mock.">
              {canManage && infrastructure.mockMode && <TestEventDialog onCreated={(id) => { setSelectedEventId(id); refresh(); }} />}
            </EmptyState>
          ) : (
            <Card className="gap-0 py-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Evento</TableHead><TableHead>Estado</TableHead><TableHead>Intentos</TableHead><TableHead>Última ejecución</TableHead><TableHead>Fechas</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {events.items.map((event) => (
                      <TableRow key={event.id}>
                        <TableCell><div className="font-medium">{automationEventTypeLabel(event.type)}</div><div className="font-mono text-xs text-muted-foreground">{event.shortId}</div></TableCell>
                        <TableCell><AutomationStatusBadge status={event.status} /></TableCell>
                        <TableCell>{event.attempts} / {event.maxAttempts}</TableCell>
                        <TableCell>{event.latestRun ? <div><span className="font-medium">{event.latestRun.provider}</span><div className="text-xs text-muted-foreground">{formatDuration(event.latestRun.durationMs)}</div></div> : "—"}</TableCell>
                        <TableCell><div className="text-xs">Creado: {formatDateTime(event.createdAt)}</div><div className="text-xs text-muted-foreground">Actualizado: {formatDateTime(event.updatedAt)}</div>{event.nextAttemptAt && <div className="text-xs text-amber-700 dark:text-amber-300">Próximo: {formatDateTime(event.nextAttemptAt)}</div>}</TableCell>
                        <TableCell className="text-right"><Button variant="ghost" size="xs" onClick={() => setSelectedEventId(event.id)}>Ver detalle</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {events.items.map((event) => (
                  <button key={event.id} type="button" onClick={() => setSelectedEventId(event.id)} className="w-full p-4 text-left transition-colors hover:bg-accent/50">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{automationEventTypeLabel(event.type)}</p><p className="font-mono text-xs text-muted-foreground">{event.shortId}</p></div><AutomationStatusBadge status={event.status} /></div>
                    <div className="mt-3 grid gap-1 text-xs text-muted-foreground"><div className="flex items-center justify-between"><span>{event.attempts} / {event.maxAttempts} intentos</span><span>{formatDateTime(event.createdAt)}</span></div><span>Actualizado: {formatDateTime(event.updatedAt)}</span>{event.nextAttemptAt && <span className="text-amber-700 dark:text-amber-300">Próximo intento: {formatDateTime(event.nextAttemptAt)}</span>}</div>
                  </button>
                ))}
              </div>
              <Pagination data={events} onPage={(page) => updateParams({ pagina: page === 1 ? null : String(page) })} />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="runs" className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[12rem_14rem_14rem_10rem_auto]">
            <Select value={filters.runStatus || "all"} onValueChange={(value) => updateParams({ run_estado: value === "all" ? null : value, run_pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Estado de ejecución"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los estados</SelectItem>{RUN_STATUS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.runProvider || "all"} onValueChange={(value) => updateParams({ proveedor: value === "all" ? null : value, run_pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Proveedor de ejecución"><SelectValue placeholder="Todos los proveedores" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los proveedores</SelectItem>{providers.map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.runType || "all"} onValueChange={(value) => updateParams({ run_tipo: value === "all" ? null : value, run_pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Tipo de ejecución"><SelectValue placeholder="Todos los tipos" /></SelectTrigger>
              <SelectContent><SelectItem value="all">Todos los tipos</SelectItem>{eventTypes.map((type) => <SelectItem key={type} value={type}>{automationEventTypeLabel(type)}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={filters.runOrder} onValueChange={(value) => updateParams({ run_orden: value === "desc" ? null : value, run_pagina: null })}>
              <SelectTrigger className="w-full" aria-label="Orden de ejecuciones"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="desc">Más recientes</SelectItem><SelectItem value="asc">Más antiguas</SelectItem></SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => updateParams({ run_estado: null, proveedor: null, run_tipo: null, run_orden: null, run_pagina: null })}><RotateCcw />Limpiar</Button>
          </div>

          {runs.items.length === 0 ? (
            <EmptyState icon={PlayCircle} title="No hay ejecuciones para mostrar" description="Las ejecuciones aparecerán cuando el dispatcher procese eventos del período seleccionado." />
          ) : (
            <Card className="gap-0 py-0">
              <div className="hidden md:block">
                <Table>
                  <TableHeader><TableRow><TableHead>Evento</TableHead><TableHead>Proveedor</TableHead><TableHead>Estado</TableHead><TableHead>Intento</TableHead><TableHead>Duración</TableHead><TableHead>Inicio / fin</TableHead><TableHead>Resultado</TableHead><TableHead className="text-right">Acción</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {runs.items.map((run) => (
                      <TableRow key={run.id}>
                        <TableCell><div className="font-medium">{automationEventTypeLabel(run.eventType)}</div><div className="font-mono text-xs text-muted-foreground">{run.eventShortId}</div></TableCell>
                        <TableCell>{run.provider}</TableCell>
                        <TableCell><AutomationStatusBadge status={run.status} /></TableCell>
                        <TableCell>{run.attempt}</TableCell>
                        <TableCell>{formatDuration(run.durationMs)}</TableCell>
                        <TableCell><div>{formatDateTime(run.startedAt)}</div><div className="text-xs text-muted-foreground">{formatDateTime(run.finishedAt)}</div></TableCell>
                        <TableCell className="max-w-52 whitespace-normal"><span className="text-xs text-muted-foreground">{run.errorCode || run.errorMessage ? `${run.errorCode ? `${run.errorCode}: ` : ""}${run.errorMessage ?? "Error"}` : "Sin error"}</span></TableCell>
                        <TableCell className="text-right"><Button variant="ghost" size="xs" onClick={() => setSelectedEventId(run.eventId)}>Ver evento</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {runs.items.map((run) => (
                  <button key={run.id} type="button" onClick={() => setSelectedEventId(run.eventId)} className="w-full p-4 text-left transition-colors hover:bg-accent/50">
                    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{automationEventTypeLabel(run.eventType)}</p><p className="text-xs text-muted-foreground">{run.provider} · intento {run.attempt}</p></div><AutomationStatusBadge status={run.status} /></div>
                    <div className="mt-3 grid gap-1 text-xs text-muted-foreground"><div className="flex items-center justify-between"><span>{formatDuration(run.durationMs)}</span><span>{formatDateTime(run.startedAt)}</span></div><span>Finalizó: {formatDateTime(run.finishedAt)}</span>{(run.errorCode || run.errorMessage) && <span className="text-destructive">{run.errorCode ? `${run.errorCode}: ` : ""}{run.errorMessage}</span>}</div>
                  </button>
                ))}
              </div>
              <Pagination data={runs} onPage={(page) => updateParams({ run_pagina: page === 1 ? null : String(page) })} />
            </Card>
          )}
        </TabsContent>

        <TabsContent value="rules" className="space-y-3">
          <AutomationRulesPanel
            rules={rules}
            canManage={canManage}
            organizationName={organizationName}
          />
        </TabsContent>
      </Tabs>

      <EventDetailSheet eventId={selectedEventId} organizationName={organizationName} canManage={canManage} onOpenChange={(open) => { if (!open) setSelectedEventId(null); }} onChanged={refresh} />
    </div>
  );
}
