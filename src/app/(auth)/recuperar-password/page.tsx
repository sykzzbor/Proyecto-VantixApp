import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getSession } from "@/server/context";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

export default async function ForgotPasswordPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return <ForgotPasswordForm />;
}
