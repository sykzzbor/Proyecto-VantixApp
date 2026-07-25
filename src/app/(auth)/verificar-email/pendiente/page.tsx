import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PendingVerificationCard } from "@/components/auth/pending-verification-card";
import { getResendCooldown } from "@/server/actions/email-verification";
import { getSession, isVerifiedUser } from "@/server/context";

export const metadata: Metadata = {
  title: "Revisá tu correo",
  robots: { index: false, follow: false },
};

export default async function PendingVerificationPage(
  props: PageProps<"/verificar-email/pendiente">
) {
  const session = await getSession();

  // Ya verificado: no tiene sentido esperar acá.
  if (session && isVerifiedUser(session.user)) redirect("/dashboard");

  const searchParams = await props.searchParams;
  const requestedEmail =
    typeof searchParams.email === "string" ? searchParams.email : null;

  /**
   * Con sesión, el correo sale de la sesión y se ignora el de la URL: si no,
   * cualquiera podría abrir esta pantalla con la dirección de otra persona y
   * usar el botón de reenvío para molestarla.
   */
  const email = session?.user.email ?? requestedEmail;

  const cooldown = email ? await getResendCooldown(email) : null;

  return (
    <PendingVerificationCard
      email={email}
      initialCooldown={cooldown}
      hasSession={Boolean(session)}
    />
  );
}
