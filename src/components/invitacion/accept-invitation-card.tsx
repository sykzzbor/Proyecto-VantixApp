"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { acceptInvitation } from "@/server/actions/team";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormAlert } from "@/components/forms/form-alert";
import { SubmitButton } from "@/components/forms/submit-button";

type AcceptInvitationCardProps = {
  token: string;
  organizationName: string;
  invitationEmail: string;
  sessionEmail: string;
  emailMatches: boolean;
};

export function AcceptInvitationCard({
  token,
  organizationName,
  invitationEmail,
  sessionEmail,
  emailMatches,
}: AcceptInvitationCardProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  async function handleAccept() {
    setError(null);
    setAccepting(true);
    const result = await acceptInvitation(token);
    setAccepting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Te uniste a ${organizationName}.`);
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSwitchAccount() {
    await authClient.signOut();
    router.push(`/login?callbackURL=${encodeURIComponent(`/invitacion/${token}`)}`);
    router.refresh();
  }

  if (!emailMatches) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">
            Esta invitación es para otra cuenta
          </CardTitle>
          <CardDescription>
            La invitación fue enviada a <strong>{invitationEmail}</strong>,
            pero tu sesión actual es <strong>{sessionEmail}</strong>.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="outline" onClick={handleSwitchAccount}>
            Cambiar de cuenta
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          Te invitaron a {organizationName}
        </CardTitle>
        <CardDescription>
          Al aceptar, vas a poder acceder al panel de gestión del negocio con
          el rol que te asignaron.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FormAlert message={error} />
      </CardContent>
      <CardFooter>
        <SubmitButton
          type="button"
          loading={accepting}
          onClick={handleAccept}
          className="w-full"
        >
          Aceptar invitación
        </SubmitButton>
      </CardFooter>
    </Card>
  );
}
