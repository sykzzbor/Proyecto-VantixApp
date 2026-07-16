import type { Metadata } from "next";
import { KeyRound, ScrollText, UserRound } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import {
  ChangePasswordForm,
  ProfileNameForm,
} from "@/components/configuracion/account-forms";
import { OrganizationSettings } from "@/components/configuracion/organization-settings";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { can } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { getAuditLogs } from "@/server/queries";

export const metadata: Metadata = {
  title: "Configuración",
};

export default async function ConfiguracionPage() {
  const { user, org, role } = await requireOrgContext();
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

      <Tabs defaultValue="cuenta" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
          <TabsTrigger value="cuenta">Cuenta</TabsTrigger>
          <TabsTrigger value="organizacion">Organización</TabsTrigger>
          {canReadAudit && (
            <TabsTrigger value="actividad">Actividad</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="cuenta" className="grid items-start gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                <UserRound className="size-4 text-[#8eacff]" aria-hidden />
              </div>
              <CardTitle className="mt-2 text-base">Perfil</CardTitle>
              <CardDescription>
                Tu nombre y el email con el que iniciás sesión.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account-email">Email</Label>
                <Input
                  id="account-email"
                  value={user.email}
                  disabled
                  readOnly
                />
                <p className="text-xs text-muted-foreground">
                  El email no se puede cambiar en esta etapa.
                </p>
              </div>
              <ProfileNameForm currentName={user.name} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                <KeyRound className="size-4 text-[#8eacff]" aria-hidden />
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

        <TabsContent value="organizacion">
          <OrganizationSettings
            orgName={org.name}
            canUpdate={canUpdateOrg}
            canDelete={canDeleteOrg}
          />
        </TabsContent>

        {canReadAudit && (
          <TabsContent value="actividad">
            <Card>
              <CardHeader>
                <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
                  <ScrollText className="size-4 text-[#8eacff]" aria-hidden />
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
