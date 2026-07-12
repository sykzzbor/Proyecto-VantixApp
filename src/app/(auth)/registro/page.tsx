import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/auth/register-form";
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

  return <RegisterForm invitationToken={invitationToken} />;
}
