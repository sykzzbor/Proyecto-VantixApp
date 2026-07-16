import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  CircleAlert,
  Inbox,
  MessageCircleQuestion,
  MessagesSquare,
  Package,
  UserRound,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { AGENT_TONE_LABELS } from "@/lib/validations/agent";
import { requireOrgContext } from "@/server/context";
import { getDashboardSummary, type DashboardSummary } from "@/server/queries";

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

type SetupNotice = {
  key: string;
  title: string;
  description: string;
  href: string;
  cta: string;
};

/** Avisos de configuración pendiente, calculados solo con datos reales. */
function buildSetupNotices(summary: DashboardSummary): SetupNotice[] {
  const notices: SetupNotice[] = [];
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
    });
  } else if (summary.whatsapp.status === "ERROR") {
    notices.push({
      key: "whatsapp-error",
      title: "La conexión de WhatsApp requiere atención",
      description: "Revisá la integración para restablecer el canal.",
      href: "/dashboard/integraciones",
      cta: "Revisar integración",
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
    });
  }
  return notices;
}

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
      <Icon className="size-4 shrink-0 text-muted-foreground group-hover:text-[#8eacff]" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground group-hover:text-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>
    </Link>
  );
}

export default async function DashboardPage() {
  const { user, org } = await requireOrgContext();
  const summary = await getDashboardSummary(org.id);
  const notices = buildSetupNotices(summary);
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  return (
    <div className="space-y-7">
      <PageHeader
        title={`Hola, ${firstName}`}
        description={`Este es el estado actual de ${org.name}.`}
      >
        <Button asChild size="sm">
          <Link href="/dashboard/conversaciones">
            Ir a conversaciones
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </PageHeader>

      {/* Avisos reales de configuración pendiente */}
      {notices.length > 0 && (
        <div className="space-y-2" aria-label="Configuración pendiente">
          {notices.map((notice) => (
            <div
              key={notice.key}
              className="flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{notice.title}</p>
                  <p className="text-sm text-muted-foreground">
                    {notice.description}
                  </p>
                </div>
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0 sm:ml-4">
                <Link href={notice.href}>
                  {notice.cta}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Indicadores operativos principales */}
      <section aria-label="Estado de la operación" className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Operación
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={Inbox}
            label="Conversaciones abiertas"
            value={String(summary.conversationsOpen)}
            hint={
              summary.unreadTotal > 0
                ? `${summary.unreadTotal} sin leer`
                : "Al día"
            }
          />
          <StatCard
            icon={MessagesSquare}
            label="Pendientes"
            value={String(summary.conversationsPending)}
            hint="Esperan una respuesta"
          />
          <StatCard
            icon={UserRound}
            label="En atención humana"
            value={String(summary.conversationsHuman)}
            hint="Derivadas del agente"
          />
          <StatCard
            icon={Bot}
            label="Agente"
            value={summary.agent?.enabled ? "Activo" : "Apagado"}
            hint={summary.agent?.assistantName ?? "Sin configurar"}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Canales y agente */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Canales</CardTitle>
            <CardDescription>Cómo entran las consultas hoy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <WhatsappIcon className="size-4 shrink-0 text-emerald-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">WhatsApp</p>
                  {summary.whatsapp ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {summary.whatsapp.displayPhoneNumber} ·{" "}
                      {summary.whatsapp.providerLabel}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sin conectar
                    </p>
                  )}
                </div>
              </div>
              <ActiveBadge
                active={summary.whatsapp?.status === "CONNECTED"}
                activeLabel="Conectado"
                inactiveLabel={
                  summary.whatsapp?.status === "ERROR" ? "Con error" : "Inactivo"
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/40 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Bot className="size-4 shrink-0 text-[#8eacff]" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {summary.agent?.assistantName ?? "Agente IA"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {summary.agent
                      ? `Tono ${AGENT_TONE_LABELS[summary.agent.tone].toLowerCase()}`
                      : "Sin configurar"}
                  </p>
                </div>
              </div>
              <ActiveBadge
                active={Boolean(summary.agent?.enabled)}
                activeLabel="Activado"
                inactiveLabel="Desactivado"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/agente">Probar agente</Link>
              </Button>
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/integraciones">Integraciones</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Actividad reciente */}
        <Card className="lg:col-span-2">
          <CardHeader>
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
                {summary.recentActivity.map((entry) => (
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

      {/* Resumen del negocio (secundario, compacto) */}
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
