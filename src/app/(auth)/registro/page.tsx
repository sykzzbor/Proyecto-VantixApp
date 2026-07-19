import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
import { translateAuthError } from "@/lib/auth-errors";
import { isGoogleSignInConfigured } from "@/lib/google-auth";
import { getSession } from "@/server/context";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default async function RegisterPage(props: PageProps<"/registro">) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const searchParams = await props.searchParams;
  const invitationToken =
    typeof searchParams.invitacion === "string"
      ? searchParams.invitacion
      : undefined;
  const oauthError =
    typeof searchParams.error === "string"
      ? translateAuthError({ code: searchParams.error })
      : null;

  return (
    <RegisterForm
      invitationToken={invitationToken}
      googleConfigured={isGoogleSignInConfigured()}
      initialError={oauthError}
    />
  );
}
