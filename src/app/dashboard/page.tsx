import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Briefcase,
  MessageCircleQuestion,
  Package,
  Store,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { ActiveBadge } from "@/components/dashboard/active-badge";
import { Badge } from "@/components/ui/badge";
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
import { getDashboardSummary } from "@/server/queries";

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
};

export default async function DashboardPage() {
  const { user, org } = await requireOrgContext();
  const summary = await getDashboardSummary(org.id);

  return (
    <div className="space-y-8">
      <PageHeader
        title={`Hola, ${user.name.split(" ")[0]}`}
        description={`Este es el estado actual de ${org.name}.`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Package}
          label="Productos"
          value={String(summary.productsTotal)}
          hint={`${summary.productsActive} activos`}
        />
        <StatCard
          icon={Briefcase}
          label="Servicios"
          value={String(summary.servicesTotal)}
          hint={`${summary.servicesActive} activos`}
        />
        <StatCard
          icon={MessageCircleQuestion}
          label="Preguntas frecuentes"
          value={String(summary.faqsTotal)}
          hint={`${summary.faqsActive} activas`}
        />
        <StatCard
          icon={Users}
          label="Equipo"
          value={String(summary.membersCount)}
          hint={summary.membersCount === 1 ? "miembro" : "miembros"}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-[#8eacff]" />
              Agente IA
            </CardTitle>
            <CardDescription>
              Configuración del asistente de tu negocio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.agent ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Estado</span>
                  <ActiveBadge
                    active={summary.agent.enabled}
                    activeLabel="Activado"
                    inactiveLabel="Desactivado"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Nombre</span>
                  <span className="text-sm font-medium">
                    {summary.agent.assistantName}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Tono</span>
                  <Badge variant="secondary" className="font-normal">
                    {AGENT_TONE_LABELS[summary.agent.tone]}
                  </Badge>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                El agente todavía no fue configurado.
              </p>
            )}
            <Button asChild variant="outline" size="sm" className="w-full">
              <Link href="/dashboard/agente">
                Configurar agente
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>

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

      {!summary.businessComplete && (
        <Card className="border-primary/25 bg-primary/[0.045]">
          <CardContent className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                <Store className="size-4.5 text-[#8eacff]" />
              </div>
              <div>
                <p className="text-sm font-medium">
                  Completá el perfil de tu negocio
                </p>
                <p className="text-sm text-muted-foreground">
                  La descripción, el teléfono y la dirección ayudan al agente a
                  responder mejor.
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/negocio">
                Completar datos
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
