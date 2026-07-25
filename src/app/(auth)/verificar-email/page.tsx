import type { Metadata } from "next";
import Link from "next/link";
import { VerifyEmailCard } from "@/components/auth/verify-email-card";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { AuthCardHeader } from "@/components/auth/auth-card-header";

export const metadata: Metadata = {
  title: "Verificar correo",
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage(
  props: PageProps<"/verificar-email">
) {
  const searchParams = await props.searchParams;
  const token =
    typeof searchParams.token === "string" ? searchParams.token : null;

  if (!token) {
    return (
      <Card className="border-border/80 bg-card/95">
        <AuthCardHeader
          eyebrow="Verificación de correo"
          title="Enlace no válido"
          description="Este enlace está incompleto o no es válido. Pedí uno nuevo desde la pantalla de verificación."
        />
        <CardFooter className="flex-col gap-3">
          <Button asChild variant="outline" className="w-full">
            <Link href="/verificar-email/pendiente">Pedir un enlace nuevo</Link>
          </Button>
          <Button asChild variant="ghost" className="w-full text-muted-foreground">
            <Link href="/login">Volver a iniciar sesión</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return <VerifyEmailCard token={token} />;
}
