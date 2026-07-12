import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Restablecer contraseña",
};

export default async function ResetPasswordPage(
  props: PageProps<"/restablecer-password">
) {
  const searchParams = await props.searchParams;
  const token =
    typeof searchParams.token === "string" ? searchParams.token : undefined;
  const hasError = typeof searchParams.error === "string";

  if (!token || hasError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Enlace no válido</CardTitle>
          <CardDescription>
            El enlace para restablecer la contraseña expiró o no es válido.
            Pedí uno nuevo desde la página de recuperación.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline">
            <Link href="/recuperar-password">Pedir un enlace nuevo</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return <ResetPasswordForm token={token} />;
}
