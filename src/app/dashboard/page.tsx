import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bot,
  Briefcase,
  CircleAlert,
  Inbox,
  MessageCircleQuestion,
  Package,
  ShoppingBag,
  Timer,
  UserPlus,
  UserRound,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { PeriodFilter, PERIOD_OPTIONS } from "@/components/dashboard/period-filter";
import { UsageMeterBar } from "@/components/dashboard/usage-meter";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/format";
import { requireOrgContext } from "@/server/context";
import { getDashboardSummary, type DashboardSummary } from "@/server/queries";
import {
  getDashboardOverview,
  type DashboardOverview,
  type IntegrationHealth,
} from "@/server/dashboard/overview";
import { resolveMetricsRange } from "@/server/metrics/range";

export const metadata: Metadata = {
  title: "Resumen",
};

const ACTION_LABELS: Record<string, string> = {
  "organizacion.creada": "creó la organización",
  "organizacion.renombrada": "renombró la organización",
  "negocio.actualizado": "actualizó los datos del negocio",
  "producto.creado": "creó el producto",
  "producto.actualizado": "actualizó el producto",
  "producto.activado": "activó el producto",
  "producto.desactivado": "desactivó el producto",
  "producto.eliminado": "eliminó el producto",
  "servicio.creado": "creó el servicio",
  "servicio.actualizado": "actualizó el servicio",
  "servicio.activado": "activó el servicio",
  "servicio.desactivado": "desactivó el servicio",
  "servicio.eliminado": "eliminó el servicio",
  "pregunta.creada": "creó la pregunta",
  "pregunta.actualizada": "actualizó la pregunta",
  "pregunta.activada": "activó la pregunta",
  "pregunta.desactivada": "desactivó la pregunta",
  "pregunta.eliminada": "eliminó la pregunta",
  "agente.configurado_activo": "configuró el agente (activado)",
  "agente.configurado_inactivo": "configuró el agente (desactivado)",
  "agente.mensaje_recibido": "envió un mensaje de prueba al agente",
  "agente.derivacion_solicitada": "derivación a humano pedida por el agente",
  "agente.error": "el agente tuvo un error al responder",
  "agente.conversacion_reiniciada": "reinició la conversación de prueba",
  "conversacion.tomada": "tomó una conversación",
  "conversacion.devuelta_ia": "devolvió una conversación a la IA",
  "conversacion.respuesta_humana": "respondió una conversación",
  "conversacion.cerrada": "cerró una conversación",
  "conversacion.reabierta": "reabrió una conversación",
  "conversacion.estado_cambiado": "cambió el estado de una conversación",
  "conversacion.asignada": "asignó una conversación a",
  "conversacion.desasignada": "quitó el responsable de una conversación",
  "cliente.creado": "creó el cliente",
  "cliente.actualizado": "actualizó el cliente",
  "equipo.invitacion_enviada": "invitó a",
  "equipo.invitacion_revocada": "revocó la invitación de",
  "equipo.rol_actualizado": "cambió el rol de",
  "equipo.miembro_eliminado": "quitó del equipo a",
  "equipo.miembro_agregado": "se unió al equipo",
  "whatsapp.mensaje_enviado": "envió un mensaje por WhatsApp",
  "whatsapp.envio_fallido": "tuvo un fallo de envío por WhatsApp",
  "whatsapp.ycloud_connected": "conectó WhatsApp mediante YCloud",
  "knowledge.document_uploaded": "subió un documento de conocimiento",
  "knowledge.document_deleted": "eliminó un documento de conocimiento",
  "automation.test_emitted": "generó un evento de prueba de automatización",
};

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

/**
 * Avisos de configuración pendiente, calculados solo con datos reales. Los
 * fallos en caliente (plan, integraciones caídas) los aporta el overview.
 */
function buildSetupNotices(summary: DashboardSummary): DashboardOverview["alerts"] {
  const notices: DashboardOverview["alerts"] = [];
  if (!summary.agent || !summary.agent.enabled) {
    notices.push({
      key: "agente",
      title: summary.agent
        ? "El agente está desactivado"
        : "El agente todavía no fue configurado",
      description:
        "Mientras esté apagado, nadie responde automáticamente las consultas.",
      href: "/dashboard/agente",
      cta: "Activar agente",
      severity: "warning",
    });
  }
  if (!summary.whatsapp) {
    notices.push({
      key: "whatsapp",
      title: "WhatsApp no está conectado",
      description:
        "Conectá tu número para recibir y responder consultas reales.",
      href: "/dashboard/integraciones",
      cta: "Conectar WhatsApp",
      severity: "warning",
    });
  }
  if (!summary.businessComplete) {
    notices.push({
      key: "negocio",
      title: "Completá el perfil de tu negocio",
      description:
        "La descripción, el teléfono y la dirección ayudan al agente a responder mejor.",
      href: "/dashboard/negocio",
      cta: "Completar datos",
      severity: "warning",
    });
  }
  if (
    summary.productsActive + summary.servicesActive + summary.faqsActive ===
      0 &&
    summary.knowledgeReady === 0
  ) {
    notices.push({
      key: "catalogo",
      title: "El agente todavía no tiene información para responder",
      description:
        "Cargá productos, servicios, preguntas frecuentes o documentos.",
      href: "/dashboard/productos",
      cta: "Cargar catálogo",
      severity: "warning",
    });
  }
  return notices;
}

const HEALTH_DOT: Record<IntegrationHealth, string> = {
  connected: "bg-emerald-500",
  error: "bg-destructive",
  disconnected: "bg-muted-foreground/40",
};

function CatalogLink({
  href,
  icon: Icon,
  label,
  value,
  hint,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>
    </Link>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default async function DashboardPage(
  props: PageProps<"/dashboard">
) {
  const { user, org } = await requireOrgContext();
  const searchParams = await props.searchParams;
  const periodParam =
    typeof searchParams.periodo === "string" ? searchParams.periodo : undefined;
  const fromParam =
    typeof searchParams.desde === "string" ? searchParams.desde : undefined;
  const toParam =
    typeof searchParams.hasta === "string" ? searchParams.hasta : undefined;

  const range = resolveMetricsRange({
    period: periodParam,
    from: fromParam,
    to: toParam,
  });
  // El selector conserva lo que pidió el usuario: al elegir "custom" todavía no
  // hay fechas, y `resolveMetricsRange` cae a 7d. Si mostráramos `range.period`
  // los campos de fecha nunca aparecerían y el rango sería imposible de cargar.
  const uiPeriod =
    periodParam && PERIOD_OPTIONS.some((option) => option.value === periodParam)
      ? periodParam
      : "7d";

  const [summary, overview] = await Promise.all([
    getDashboardSummary(org.id),
    getDashboardOverview(org.id, range),
  ]);

  const alerts = [...overview.alerts, ...buildSetupNotices(summary)];
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;
  const { conversations, plan } = overview;

  return (
    <div className="space-y-7">
      <PageHeader
        title={`Hola, ${firstName}`}
        description={`Estado de ${org.name} · ${overview.rangeLabel.toLowerCase()}.`}
      >
        <Button asChild size="sm">
          <Link href="/dashboard/conversaciones">
            Ir a conversaciones
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Vista del período</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Los indicadores de abajo se recalculan con el rango elegido.
          </p>
        </div>
        <PeriodFilter
          period={uiPeriod}
          from={fromParam ?? ""}
          to={toParam ?? ""}
          idPrefix="dashboard"
        />
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2" aria-label="Alertas">
          {alerts.map((alert) => (
            <div
              key={alert.key}
              className={cn(
                "flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                alert.severity === "danger"
                  ? "border-destructive/25 bg-destructive/[0.06]"
                  : "border-amber-500/20 bg-amber-500/[0.06]"
              )}
            >
              <div className="flex min-w-0 items-start gap-3">
                <CircleAlert
                  className={cn(
                    "mt-0.5 size-4 shrink-0",
                    alert.severity === "danger"
                      ? "text-destructive"
                      : "text-amber-700 dark:text-amber-300"
                  )}
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {alert.description}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0 sm:ml-4">
                <Link href={alert.href}>
                  {alert.cta}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Indicadores del período */}
      <section aria-label="Indicadores del período" className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Inbox}
            label="Conversaciones"
            value={formatNumber(conversations.total)}
            hint={
              summary.unreadTotal > 0
                ? `${formatNumber(summary.unreadTotal)} sin leer`
                : "Al día"
            }
          />
          <StatCard
            icon={Bot}
            label="Respuestas de la IA"
            value={formatNumber(overview.aiReplies)}
            hint={`${formatNumber(overview.humanReplies)} respuestas humanas`}
          />
          <StatCard
            icon={Timer}
            label="Respuesta media"
            value={formatSeconds(overview.avgFirstResponseSeconds)}
            hint="Hasta la primera respuesta"
          />
          <StatCard
            icon={UserPlus}
            label="Clientes nuevos"
            value={formatNumber(overview.newCustomers)}
            hint="Altas en el período"
          />
        </div>

        <Card>
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <MiniStat label="Abiertas" value={formatNumber(conversations.open)} />
            <MiniStat label="Pendientes" value={formatNumber(conversations.pending)} />
            <MiniStat label="Cerradas" value={formatNumber(conversations.closed)} />
            <MiniStat
              label="Derivadas a humano"
              value={formatNumber(overview.handoffs)}
              hint={
                conversations.total > 0
                  ? `${overview.handoffRatePct}% del total`
                  : undefined
              }
            />
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Uso del plan */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Uso del plan</CardTitle>
            <CardDescription>
              Plan {plan.name} · se reinicia el {plan.resetsAt}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeterBar
              label="Conversaciones"
              used={plan.conversations.used}
              limit={plan.conversations.limit}
              remaining={plan.conversations.remaining}
              percent={plan.conversations.percent}
            />
            <UsageMeterBar
              label="Respuestas de IA"
              used={plan.aiResponses.used}
              limit={plan.aiResponses.limit}
              remaining={plan.aiResponses.remaining}
              percent={plan.aiResponses.percent}
            />
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/dashboard/planes">Ver planes</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Integraciones */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Integraciones</CardTitle>
            <CardDescription>Estado real de cada conexión.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {overview.integrations.map((integration) => (
              <Link
                key={integration.key}
                href={integration.href}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    HEALTH_DOT[integration.health]
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {integration.label}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {integration.detail}
                  </span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Próximos turnos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Próximos turnos</CardTitle>
            <CardDescription>Los siguientes de la agenda.</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.upcomingAppointments.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No hay turnos próximos.{" "}
                <Link
                  href="/dashboard/turnos"
                  className="text-primary underline-offset-2 hover:underline"
                >
                  Ver agenda
                </Link>
              </p>
            ) : (
              <ul className="space-y-2.5">
                {overview.upcomingAppointments.map((appointment) => (
                  <li key={appointment.id} className="min-w-0 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {appointment.customerName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {appointment.whenLabel}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {appointment.title}
                      {appointment.rescheduled && " · reprogramado"}
                    </p>
                  </li>
                ))}
                <li className="pt-1">
                  <Link
                    href="/dashboard/turnos"
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    Ver toda la agenda →
                  </Link>
                </li>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Pedidos recientes */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Pedidos recientes</CardTitle>
            <CardDescription>
              Sincronizados desde tu tienda conectada.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {overview.recentOrders.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <ShoppingBag className="size-5 text-muted-foreground/60" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  Todavía no hay pedidos sincronizados.
                </p>
                <Link
                  href="/dashboard/integraciones"
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  Conectar una tienda
                </Link>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {overview.recentOrders.map((order) => (
                  <li
                    key={order.id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{order.reference}</span>
                      {order.customerName && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {order.customerName}
                        </span>
                      )}
                      <span className="block truncate text-xs text-muted-foreground">
                        {order.source} · {order.status} · {order.whenLabel}
                      </span>
                    </span>
                    {order.total && (
                      <span className="shrink-0 tabular-nums">{order.total}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Actividad reciente */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Actividad reciente</CardTitle>
            <CardDescription>
              Últimas acciones registradas en la organización.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Todavía no hay actividad registrada.
              </p>
            ) : (
              <ul className="space-y-3">
                {summary.recentActivity.slice(0, 6).map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-col gap-1 border-b border-border/70 pb-3 text-sm last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">
                        {entry.userName ?? "Sistema"}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      {entry.details && (
                        <span className="text-muted-foreground">
                          {" "}
                          “{entry.details}”
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {entry.dateLabel}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accesos rápidos */}
      <section aria-label="Accesos rápidos" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { href: "/dashboard/conversaciones", label: "Conversaciones", icon: Inbox },
          { href: "/dashboard/agente", label: "Probar el agente", icon: Bot },
          { href: "/dashboard/clientes", label: "Clientes", icon: UserRound },
          { href: "/dashboard/metricas", label: "Métricas", icon: ArrowUpRight },
        ].map(({ href, label, icon: Icon }) => (
          <Button key={href} asChild variant="outline" className="justify-start">
            <Link href={href}>
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          </Button>
        ))}
      </section>

      {/* Resumen del negocio */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Tu negocio</CardTitle>
          <CardDescription>
            La información con la que responde el agente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 sm:grid-cols-2 xl:grid-cols-5">
          <CatalogLink
            href="/dashboard/productos"
            icon={Package}
            label="Productos"
            value={summary.productsTotal}
            hint={`${summary.productsActive} activos`}
          />
          <CatalogLink
            href="/dashboard/servicios"
            icon={Briefcase}
            label="Servicios"
            value={summary.servicesTotal}
            hint={`${summary.servicesActive} activos`}
          />
          <CatalogLink
            href="/dashboard/preguntas"
            icon={MessageCircleQuestion}
            label="Preguntas"
            value={summary.faqsTotal}
            hint={`${summary.faqsActive} activas`}
          />
          <CatalogLink
            href="/dashboard/conocimiento"
            icon={BookOpen}
            label="Documentos"
            value={summary.knowledgeReady}
            hint="listos para la IA"
          />
          <CatalogLink
            href="/dashboard/equipo"
            icon={Users}
            label="Equipo"
            value={summary.membersCount}
            hint={summary.membersCount === 1 ? "miembro" : "miembros"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
