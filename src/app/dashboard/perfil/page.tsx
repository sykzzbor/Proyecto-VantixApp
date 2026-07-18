import type { Metadata } from "next";
import Link from "next/link";
import { Building2, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { ROLE_LABELS } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";

export const metadata: Metadata = { title: "Perfil" };

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export default async function ProfilePage() {
  const { user, org, role } = await requireOrgContext();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Perfil"
        description="Tu identidad dentro de VantixApp y el acceso al espacio de trabajo."
      >
        <Button asChild size="sm">
          <Link href="/dashboard/configuracion">Editar perfil</Link>
        </Button>
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(20rem,.9fr)]">
        <Card>
          <CardContent className="flex flex-col gap-6 pt-1 sm:flex-row sm:items-center">
            <Avatar className="size-24 border border-primary/20 bg-primary/10">
              <AvatarFallback className="bg-transparent text-2xl font-semibold text-primary">
                {initials(user.name) || "U"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-xl font-semibold tracking-tight">{user.name}</h3>
                <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
              </div>
              <p className="mt-1 truncate text-sm text-muted-foreground">{user.email}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border bg-muted/35 p-3">
                  <p className="text-xs text-muted-foreground">Organización</p>
                  <p className="mt-1 truncate text-sm font-medium">{org.name}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/35 p-3">
                  <p className="text-xs text-muted-foreground">Método de acceso</p>
                  <p className="mt-1 text-sm font-medium">Email y contraseña</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-base">Resumen de la cuenta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              { icon: Mail, label: "Correo de acceso", value: user.email },
              { icon: Building2, label: "Espacio de trabajo", value: org.name },
              { icon: ShieldCheck, label: "Permisos", value: ROLE_LABELS[role] },
              { icon: KeyRound, label: "Seguridad", value: "Contraseña administrable" },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-0">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="truncate text-sm font-medium">{item.value}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
