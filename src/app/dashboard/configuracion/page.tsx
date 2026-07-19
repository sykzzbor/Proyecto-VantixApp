import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, KeyRound, Palette, Plug, ScrollText, Store, Users } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { ChangePasswordForm } from "@/components/configuracion/account-forms";
import { OrganizationSettings } from "@/components/configuracion/organization-settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeSettings } from "@/components/theme/theme-switcher";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getAuditLogs } from "@/server/queries";

export const metadata: Metadata = {
  title: "Configuración",
};

export default async function ConfiguracionPage() {
  const { org, role } = await requireOrgContext();
  const canUpdateOrg = can(role, "org.update");
  const canDeleteOrg = can(role, "org.delete");
  const canReadAudit = can(role, "audit.read");

  const auditLogs = canReadAudit ? await getAuditLogs(org.id, 25) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración"
        description="Administrá tu cuenta, el espacio de trabajo y la actividad de la organización."
      />

      <Tabs defaultValue="organizacion" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="organizacion">Organización</TabsTrigger>
          <TabsTrigger value="apariencia">Apariencia</TabsTrigger>
          <TabsTrigger value="accesos">Accesos</TabsTrigger>
          <TabsTrigger value="seguridad">Seguridad</TabsTrigger>
          {canReadAudit && (
            <TabsTrigger value="actividad">Actividad</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="seguridad" className="max-w-3xl">
          <Card>
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                <KeyRound className="size-4 text-primary" aria-hidden />
              </div>
              <CardTitle className="mt-2 text-base">Contraseña</CardTitle>
              <CardDescription>
                Actualizá la contraseña de tu cuenta. Se van a cerrar las demás
                sesiones abiertas.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="organizacion" className="space-y-4">
          <OrganizationSettings
            orgName={org.name}
            canUpdate={canUpdateOrg}
            canDelete={canDeleteOrg}
          />
          <Link
            href="/dashboard/negocio"
            className="group flex max-w-3xl items-center gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30 hover:bg-accent/25 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
              <Store className="size-4.5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Información pública del negocio</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Datos de contacto, horarios y contexto que utiliza el agente.
              </span>
            </span>
            <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" aria-hidden />
          </Link>
        </TabsContent>

        <TabsContent value="apariencia">
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-start gap-3">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                  <Palette className="size-4.5 text-primary" aria-hidden />
                </div>
                <div>
                  <CardTitle className="text-base">Apariencia del panel</CardTitle>
                  <CardDescription className="mt-1">
                    Elegí cómo querés ver VantixApp. La preferencia queda guardada
                    en este navegador y se conserva al volver a iniciar sesión.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ThemeSettings />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accesos">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              {
                icon: Users,
                title: "Usuarios y permisos",
                description: can(role, "team.manage")
                  ? "Invitá integrantes y administrá los roles de la organización."
                  : "Consultá quiénes integran la organización y qué rol tiene cada persona.",
                href: "/dashboard/equipo",
              },
              {
                icon: Plug,
                title: "Integraciones",
                description: can(role, "integrations.manage")
                  ? "Conectá y supervisá los servicios externos habilitados."
                  : "Consultá el estado seguro de las conexiones de la organización.",
                href: "/dashboard/integraciones",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.title}
                  href={item.href}
                  className="group rounded-xl border border-border bg-card p-5 transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/30 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/20"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <ArrowUpRight className="size-4 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
                </Link>
              );
            })}
          </div>
        </TabsContent>

        {canReadAudit && (
          <TabsContent value="actividad">
            <Card>
              <CardHeader>
                <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                  <ScrollText className="size-4 text-primary" aria-hidden />
                </div>
                <CardTitle className="mt-2 text-base">Registro de actividad</CardTitle>
                <CardDescription>
                  Las últimas {auditLogs.length} acciones importantes
                  registradas en la organización.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {auditLogs.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    Todavía no hay actividad registrada.
                  </p>
                ) : (
                  <>
                  <div className="space-y-2 md:hidden">
                    {auditLogs.map((log) => (
                      <article key={log.id} className="rounded-lg border border-border/75 bg-background/35 p-3">
                        <div className="space-y-1">
                          <p className="break-words font-mono text-xs text-foreground">{log.action}</p>
                          <span className="block text-[10px] text-muted-foreground">{log.dateLabel}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{log.details ?? "Sin detalle adicional"}</p>
                        <p className="mt-2 text-xs font-medium">{log.userName ?? "Sistema"}</p>
                      </article>
                    ))}
                  </div>
                  <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Acción</TableHead>
                          <TableHead className="hidden sm:table-cell">
                            Detalle
                          </TableHead>
                          <TableHead>Usuario</TableHead>
                          <TableHead className="text-right">Fecha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="font-mono text-xs">
                              {log.action}
                            </TableCell>
                            <TableCell className="hidden max-w-56 truncate text-muted-foreground sm:table-cell">
                              {log.details ?? "—"}
                            </TableCell>
                            <TableCell>{log.userName ?? "Sistema"}</TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {log.dateLabel}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
