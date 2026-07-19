import type { Metadata } from "next";
import { Building2, KeyRound, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { ProfileNameForm } from "@/components/configuracion/account-forms";
import { ProfileAvatarForm } from "@/components/configuracion/profile-avatar-form";
import { ROLE_LABELS } from "@/lib/permissions";
import { requireOrgContext } from "@/server/context";
import { findGoogleProfileImage } from "@/server/profile/avatar";

export const metadata: Metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const { user, org, role } = await requireOrgContext();
  const googleImage = await findGoogleProfileImage(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tu perfil"
        description="Administrá tu identidad personal desde un único lugar."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(19rem,.85fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="border-b">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary">
                  <UserRound className="size-4.5" aria-hidden />
                </span>
                <div>
                  <CardTitle className="text-base">Imagen personal</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Se muestra en la sidebar y en los espacios donde participás.
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <ProfileAvatarForm
                name={user.name}
                image={user.image}
                hasGoogleImage={Boolean(googleImage)}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="text-base">Información personal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border border-border bg-muted/35 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">Correo de acceso</p>
                <p className="mt-1 truncate text-sm font-medium">{user.email}</p>
              </div>
              <ProfileNameForm currentName={user.name} />
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader className="border-b">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base">Resumen de la cuenta</CardTitle>
              <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              { icon: Mail, label: "Correo", value: user.email },
              { icon: Building2, label: "Espacio de trabajo", value: org.name },
              { icon: ShieldCheck, label: "Permisos", value: ROLE_LABELS[role] },
              {
                icon: KeyRound,
                label: "Foto conectada",
                value: googleImage ? "Google disponible" : "Imagen personal",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex items-center gap-3 border-b border-border/70 py-3 last:border-0"
                >
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
