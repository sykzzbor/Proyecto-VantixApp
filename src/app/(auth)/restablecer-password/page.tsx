import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardFooter,
} from "@/components/ui/card";
import { AuthCardHeader } from "@/components/auth/auth-card-header";

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
      <Card className="border-border/80 bg-card/95">
        <AuthCardHeader
          eyebrow="Recuperación de acceso"
          title="Enlace no válido"
          description="El enlace para restablecer la contraseña expiró o no es válido. Pedí uno nuevo desde la página de recuperación."
        />
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
