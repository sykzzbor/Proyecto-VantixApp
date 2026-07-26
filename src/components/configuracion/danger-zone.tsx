"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { deleteAccount } from "@/server/actions/account";
import { deleteOrganization } from "@/server/actions/organization";
import { DELETE_ACCOUNT_PHRASE } from "@/server/auth/account-deletion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/auth/password-input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Acciones irreversibles.
 *
 * La confirmación escrita y la contraseña son ayudas para que nadie borre por
 * error: la verificación real (permisos, reautenticación, transferencia de
 * propiedad) la hace el servidor, que no confía en nada de lo que se manda
 * desde acá salvo la contraseña y la frase.
 */
export function DangerZone({
  canDeleteOrganization,
  organizationName,
  requiresPassword,
}: {
  canDeleteOrganization: boolean;
  organizationName: string;
  /** `false` cuando la cuenta solo entra con Google. */
  requiresPassword: boolean;
}) {
  const router = useRouter();

  const [orgPhrase, setOrgPhrase] = useState("");
  const [deletingOrg, setDeletingOrg] = useState(false);

  const [accountPhrase, setAccountPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);

  async function onDeleteOrganization() {
    setDeletingOrg(true);
    const result = await deleteOrganization();
    setDeletingOrg(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("La organización fue eliminada.");
    router.push("/onboarding");
    router.refresh();
  }

  async function onDeleteAccount() {
    setDeletingAccount(true);
    const result = await deleteAccount({
      confirmation: accountPhrase,
      ...(requiresPassword ? { password } : {}),
    });
    setDeletingAccount(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    // La sesión ya no existe del lado del servidor; una recarga completa
    // evita que quede una pantalla del panel con datos de una cuenta borrada.
    window.location.href = "/";
  }

  // El nombre exacto es una confirmación más fuerte que una frase fija: hay
  // que mirar qué organización se está por borrar para poder escribirlo.
  const orgPhraseOk = orgPhrase.trim() === organizationName.trim();
  const accountPhraseOk =
    accountPhrase.trim().replace(/\s+/g, " ").toUpperCase() ===
    DELETE_ACCOUNT_PHRASE;
  const accountReady =
    accountPhraseOk && (!requiresPassword || password.length > 0);

  return (
    <Card className="border-destructive/35">
      <CardHeader className="border-b border-destructive/25">
        <div className="flex size-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/10">
          <TriangleAlert className="size-4 text-destructive" aria-hidden />
        </div>
        <CardTitle className="mt-2 text-base">Zona de peligro</CardTitle>
        <CardDescription>
          Estas acciones no se pueden deshacer. Leé bien antes de confirmar.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-8 pt-6">
        {canDeleteOrganization && (
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">Eliminar la organización</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Se borran las conversaciones, el catálogo, el conocimiento, las
                integraciones y la facturación de{" "}
                <span className="font-medium text-foreground">{organizationName}</span>.
                Tu cuenta personal se conserva.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-phrase">
                Escribí el nombre exacto de la organización para confirmar
              </Label>
              <Input
                id="org-phrase"
                value={orgPhrase}
                autoComplete="off"
                onChange={(event) => setOrgPhrase(event.target.value)}
                placeholder={organizationName}
                className="max-w-xs"
              />
            </div>
            <Button
              variant="destructive"
              disabled={!orgPhraseOk || deletingOrg}
              onClick={onDeleteOrganization}
            >
              {deletingOrg ? "Eliminando…" : "Eliminar la organización"}
            </Button>
          </section>
        )}

        <section className="space-y-3 border-t border-border pt-6">
          <div>
            <h3 className="text-sm font-semibold">Eliminar mi cuenta</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Se borran tu cuenta, tus sesiones y los espacios de trabajo donde
              seas la única persona. En los espacios compartidos solo se quita
              tu acceso: si sos el propietario, la propiedad pasa a otro
              integrante. Es definitivo.
            </p>
          </div>

          {requiresPassword ? (
            <div className="max-w-xs space-y-2">
              <Label htmlFor="delete-password">Tu contraseña</Label>
              <PasswordInput
                id="delete-password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Confirmá con tu contraseña"
              />
            </div>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Tu cuenta entra con Google, así que no hay contraseña que pedir.
              Por seguridad, la sesión tiene que ser reciente: si hace más de
              una hora que iniciaste sesión, volvé a entrar antes de continuar.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="account-phrase">
              Escribí <span className="font-mono">{DELETE_ACCOUNT_PHRASE}</span> para confirmar
            </Label>
            <Input
              id="account-phrase"
              value={accountPhrase}
              autoComplete="off"
              onChange={(event) => setAccountPhrase(event.target.value)}
              placeholder={DELETE_ACCOUNT_PHRASE}
              className="max-w-xs"
            />
          </div>

          <Button
            variant="destructive"
            disabled={!accountReady || deletingAccount}
            onClick={onDeleteAccount}
          >
            {deletingAccount ? "Eliminando…" : "Eliminar mi cuenta"}
          </Button>
        </section>
      </CardContent>
    </Card>
  );
}
