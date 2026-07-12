import type { Metadata } from "next";
import Link from "next/link";
import { AcceptInvitationCard } from "@/components/invitacion/accept-invitation-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSession } from "@/server/context";
import { getInvitationByToken } from "@/server/queries";

export const metadata: Metadata = {
  title: "Invitación al equipo",
};

function InvitationShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/40">
      <header className="px-6 py-5">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Vantix<span className="text-primary">App</span>
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-8 pb-16 sm:items-center sm:pt-4">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}

export default async function InvitationPage(
  props: PageProps<"/invitacion/[token]">
) {
  const { token } = await props.params;
  const [invitation, session] = await Promise.all([
    getInvitationByToken(token),
    getSession(),
  ]);

  if (!invitation || invitation.status === "REVOKED") {
    return (
      <InvitationShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Invitación no válida</CardTitle>
            <CardDescription>
              Esta invitación no existe o fue revocada. Pedile a la persona que
              te invitó que genere una nueva.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild variant="outline">
              <Link href="/login">Ir a iniciar sesión</Link>
            </Button>
          </CardFooter>
        </Card>
      </InvitationShell>
    );
  }

  if (invitation.status === "ACCEPTED") {
    return (
      <InvitationShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Invitación ya utilizada</CardTitle>
            <CardDescription>
              Esta invitación ya fue aceptada. Si sos vos quien la aceptó,
              iniciá sesión para entrar al panel.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link href="/login">Iniciar sesión</Link>
            </Button>
          </CardFooter>
        </Card>
      </InvitationShell>
    );
  }

  if (invitation.expired) {
    return (
      <InvitationShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Invitación vencida</CardTitle>
            <CardDescription>
              Esta invitación expiró. Pedile a la persona que te invitó que
              genere una nueva.
            </CardDescription>
          </CardHeader>
        </Card>
      </InvitationShell>
    );
  }

  if (!session) {
    const loginUrl = `/login?callbackURL=${encodeURIComponent(`/invitacion/${token}`)}`;
    const registerUrl = `/registro?invitacion=${encodeURIComponent(token)}`;
    return (
      <InvitationShell>
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">
              Te invitaron a {invitation.organizationName}
            </CardTitle>
            <CardDescription>
              La invitación fue enviada a <strong>{invitation.email}</strong>.
              Iniciá sesión o creá tu cuenta con ese email para aceptarla.
            </CardDescription>
          </CardHeader>
          <CardFooter className="flex-col gap-3">
            <Button asChild className="w-full">
              <Link href={registerUrl}>Crear cuenta</Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href={loginUrl}>Ya tengo cuenta</Link>
            </Button>
          </CardFooter>
        </Card>
      </InvitationShell>
    );
  }

  const emailMatches =
    session.user.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <InvitationShell>
      <AcceptInvitationCard
        token={token}
        organizationName={invitation.organizationName}
        invitationEmail={invitation.email}
        sessionEmail={session.user.email}
        emailMatches={emailMatches}
      />
    </InvitationShell>
  );
}
