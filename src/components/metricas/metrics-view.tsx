"use client";

import {
  ArrowUpRight,
  Bot,
  CircleCheckBig,
  Clock,
  Inbox,
  MessageSquare,
  Timer,
  TriangleAlert,
  UserPlus,
  Users,
} from "lucide-react";
import type { MetricsData } from "@/server/metrics/queries";
import { useTableFilters } from "@/components/dashboard/use-table-filters";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  ByHourChart,
  ChannelBarChart,
  ConversationsByDayChart,
  SharePieChart,
} from "@/components/metricas/metrics-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

type MetricsViewProps = {
  data: MetricsData;
  definitions: { term: string; definition: string }[];
  canViewAdvanced: boolean;
  filters: { period: string; channel: string; from: string; to: string };
};

const PERIOD_OPTIONS = [
  { value: "hoy", label: "Hoy" },
  { value: "7d", label: "Últimos 7 días" },
  { value: "30d", label: "Últimos 30 días" },
  { value: "mes", label: "Este mes" },
  { value: "custom", label: "Rango personalizado" },
];

function formatSeconds(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMin = minutes % 60;
  return restMin > 0 ? `${hours} h ${restMin} min` : `${hours} h`;
}

function ChartCard({
  title,
  subtitle,
  empty,
  children,
}: {
  title: string;
  subtitle?: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent>
        {empty ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            Sin datos en el período seleccionado.
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function UsageStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function MetricsView({
  data,
  definitions,
  canViewAdvanced,
  filters,
}: MetricsViewProps) {
  const { setParam } = useTableFilters();
  const { totals, aiUsage } = data;

  const messagesTotal =
    totals.customerMessages + totals.aiReplies + totals.humanReplies;

  return (
    <div className="space-y-6">
      {/* Selector de período y canal */}
      <div className="flex flex-wrap items-end gap-2">
        <Select
          value={filters.period || "7d"}
          onValueChange={(value) =>
            setParam("periodo", value === "7d" ? null : value)
          }
        >
          <SelectTrigger className="w-full sm:w-52" aria-label="Período">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.channel || "todos"}
          onValueChange={(value) =>
            setParam("canal", value === "todos" ? null : value)
          }
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Canal">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los canales</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="test">Chat de prueba</SelectItem>
          </SelectContent>
        </Select>

        {filters.period === "custom" && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="metrics-from" className="text-xs">
                Desde
              </Label>
              <Input
                id="metrics-from"
                type="date"
                className="w-40"
                value={filters.from}
                onChange={(event) => setParam("desde", event.target.value || null)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="metrics-to" className="text-xs">
                Hasta
              </Label>
              <Input
                id="metrics-to"
                type="date"
                className="w-40"
                value={filters.to}
                onChange={(event) => setParam("hasta", event.target.value || null)}
              />
            </div>
          </div>
        )}
      </div>

      {/* Conversaciones */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Conversaciones
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Inbox}
            label="Recibidas"
            value={formatNumber(totals.conversationsReceived)}
          />
          <StatCard
            icon={MessageSquare}
            label="Activas"
            value={formatNumber(totals.active)}
          />
          <StatCard
            icon={Clock}
            label="Pendientes"
            value={formatNumber(totals.pending)}
          />
          <StatCard
            icon={CircleCheckBig}
            label="Cerradas"
            value={formatNumber(totals.closed)}
          />
        </div>
      </section>

      {/* Mensajes y atención */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Mensajes y atención
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Users}
            label="Mensajes de clientes"
            value={formatNumber(totals.customerMessages)}
          />
          <StatCard
            icon={Bot}
            label="Respuestas de Claude"
            value={formatNumber(totals.aiReplies)}
            hint={`${totals.aiSharePct}% del total atendido`}
          />
          <StatCard
            icon={Users}
            label="Respuestas humanas"
            value={formatNumber(totals.humanReplies)}
            hint={`${totals.humanSharePct}% del total atendido`}
          />
          <StatCard
            icon={ArrowUpRight}
            label="Derivaciones a humano"
            value={formatNumber(totals.handoffs)}
          />
        </div>
      </section>

      {/* Experiencia */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground">
          Experiencia y clientes
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Timer}
            label="Primera respuesta (prom.)"
            value={formatSeconds(totals.avgFirstResponseSeconds)}
          />
          <StatCard
            icon={CircleCheckBig}
            label="Resolución (prom.)"
            value={formatSeconds(totals.avgResolutionSeconds)}
          />
          <StatCard
            icon={TriangleAlert}
            label="Sin respuesta"
            value={formatNumber(totals.unanswered)}
          />
          <StatCard
            icon={UserPlus}
            label="Clientes nuevos"
            value={formatNumber(totals.newCustomers)}
          />
        </div>
      </section>

      {/* Gráficos */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Conversaciones por día"
          empty={data.conversationsByDay.length === 0}
        >
          <ConversationsByDayChart data={data.conversationsByDay} />
        </ChartCard>
        <ChartCard
          title="Actividad por horario"
          subtitle="Mensajes por hora del día (zona horaria de Argentina)"
          empty={messagesTotal === 0}
        >
          <ByHourChart data={data.byHour} />
        </ChartCard>
        <ChartCard
          title="IA frente a atención humana"
          empty={totals.aiReplies + totals.humanReplies === 0}
        >
          <SharePieChart
            data={[
              { name: "Claude (IA)", value: totals.aiReplies, color: "#8eacff" },
              { name: "Humano", value: totals.humanReplies, color: "#34d399" },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Estados de conversaciones"
          empty={totals.conversationsReceived === 0}
        >
          <SharePieChart
            data={[
              { name: "Activas", value: totals.active, color: "#8eacff" },
              { name: "Pendientes", value: totals.pending, color: "#fbbf24" },
              { name: "Cerradas", value: totals.closed, color: "#34d399" },
            ]}
          />
        </ChartCard>
        <ChartCard
          title="Mensajes por canal"
          empty={data.messagesByChannel.length === 0}
        >
          <ChannelBarChart data={data.messagesByChannel} />
        </ChartCard>

        {/* Uso de Claude */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Uso de Claude</CardTitle>
            <p className="text-xs text-muted-foreground">
              Modelo activo:{" "}
              <span className="font-medium text-foreground">
                {aiUsage.activeModel}
              </span>
            </p>
          </CardHeader>
          <CardContent>
            {aiUsage.requests === 0 ? (
              <div className="flex h-[160px] items-center justify-center text-sm text-muted-foreground">
                Sin actividad del agente en el período.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <UsageStat label="Solicitudes" value={formatNumber(aiUsage.requests)} />
                <UsageStat label="Éxitos" value={formatNumber(aiUsage.successes)} />
                <UsageStat label="Errores" value={formatNumber(aiUsage.errors)} />
                <UsageStat
                  label="Latencia prom."
                  value={`${formatNumber(aiUsage.avgLatencyMs)} ms`}
                />
                <UsageStat
                  label="Tokens entrada"
                  value={formatNumber(aiUsage.inputTokens)}
                />
                <UsageStat
                  label="Tokens salida"
                  value={formatNumber(aiUsage.outputTokens)}
                />
                <UsageStat
                  label="Herramientas usadas"
                  value={formatNumber(aiUsage.toolCalls)}
                />
                <UsageStat
                  label="Búsquedas en documentos"
                  value={formatNumber(data.knowledgeSearches)}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Uso de herramientas */}
      <section className="grid gap-4 lg:grid-cols-3">
        <RankCard
          title="Herramientas más utilizadas"
          items={data.toolUsage.map((entry) => ({
            name: TOOL_LABELS[entry.tool] ?? entry.tool,
            count: entry.count,
          }))}
        />
        <RankCard title="Productos más consultados" items={data.topProducts} />
        <RankCard title="Servicios más consultados" items={data.topServices} />
      </section>

      {/* Rendimiento del equipo */}
      {canViewAdvanced && data.team.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">
            Rendimiento del equipo
          </h3>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Integrante</th>
                  <th className="px-4 py-3 text-right font-medium">Tomadas</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Mensajes humanos
                  </th>
                  <th className="px-4 py-3 text-right font-medium">Cerradas</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Respuesta prom.
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.team.map((member) => (
                  <tr
                    key={member.userId}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-3 font-medium">{member.name}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(member.taken)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(member.humanMessages)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatNumber(member.closed)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatSeconds(member.avgResponseSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Definiciones */}
      <details className="rounded-xl border border-border bg-card/60 p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
          Cómo se calcula cada métrica
        </summary>
        <dl className="mt-3 space-y-2.5">
          {definitions.map((entry) => (
            <div key={entry.term} className="text-sm">
              <dt className="font-medium text-foreground">{entry.term}</dt>
              <dd className="text-muted-foreground">{entry.definition}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

const TOOL_LABELS: Record<string, string> = {
  get_business_information: "Información del negocio",
  search_products: "Buscar productos",
  search_services: "Buscar servicios",
  search_faqs: "Buscar FAQs",
  search_knowledge: "Buscar en documentos",
  request_human_support: "Derivar a humano",
};

function RankCard({
  title,
  items,
}: {
  title: string;
  items: { name: string; count: number }[];
}) {
  const max = items.reduce((acc, item) => Math.max(acc, item.count), 0);
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Sin datos en el período.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {items.slice(0, 6).map((item) => (
              <li key={item.name} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatNumber(item.count)}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${max > 0 ? (item.count / max) * 100 : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
