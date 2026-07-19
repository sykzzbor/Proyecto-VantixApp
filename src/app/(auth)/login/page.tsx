import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { safeCallbackUrl, translateAuthError } from "@/lib/auth-errors";
import { isGoogleSignInConfigured } from "@/lib/google-auth";
import { getSession } from "@/server/context";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage(props: PageProps<"/login">) {
  const session = await getSession();
  if (session) redirect("/dashboard");

  const searchParams = await props.searchParams;
  const callbackURL = safeCallbackUrl(
    typeof searchParams.callbackURL === "string"
      ? searchParams.callbackURL
      : undefined
  );
  const oauthError =
    typeof searchParams.error === "string"
      ? translateAuthError({ code: searchParams.error })
      : null;

  return (
    <LoginForm
      callbackURL={callbackURL}
      googleConfigured={isGoogleSignInConfigured()}
      initialError={oauthError}
    />
  );
}
