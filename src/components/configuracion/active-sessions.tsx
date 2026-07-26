"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Laptop, LogOut, MonitorSmartphone, Smartphone } from "lucide-react";
import type { SessionSummary } from "@/server/auth/sessions";
import {
  revokeOtherSessions,
  revokeSession,
} from "@/server/actions/sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Sesiones abiertas de la cuenta.
 *
 * La lista llega ya resuelta del servidor, con la IP recortada y sin ningún
 * token. Cerrar una sesión se resuelve del lado del servidor contra el
 * `userId` de la sesión: el id que sale de acá no puede alcanzar la sesión de
 * otra persona.
 */

function iconFor(os: string) {
  if (os === "iOS" || os === "Android") return Smartphone;
  if (os === "Sistema desconocido") return MonitorSmartphone;
  return Laptop;
}

function cuando(iso: string): string {
  const fecha = new Date(iso);
  const minutos = Math.round((Date.now() - fecha.getTime()) / 60000);
  if (minutos < 1) return "hace instantes";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(fecha);
}

export function ActiveSessions({ sessions }: { sessions: SessionSummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const otras = sessions.filter((s) => !s.current).length;

  function cerrarUna(id: string) {
    setBusyId(id);
    startTransition(async () => {
      const result = await revokeSession(id);
      setBusyId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Sesión cerrada.");
      router.refresh();
    });
  }

  function cerrarOtras() {
    startTransition(async () => {
      const result = await revokeOtherSessions();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Se cerraron las demás sesiones.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
              <MonitorSmartphone className="size-4 text-primary" aria-hidden />
            </div>
            <CardTitle className="mt-2 text-base">Sesiones activas</CardTitle>
            <CardDescription className="mt-1">
              Dónde está abierta tu cuenta. Si no reconocés algo, cerralo y
              cambiá tu contraseña.
            </CardDescription>
          </div>
          {otras > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={cerrarOtras}
            >
              <LogOut className="size-4" aria-hidden />
              Cerrar las demás ({otras})
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-5">
        {sessions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No pudimos leer tus sesiones. Actualizá la página.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {sessions.map((session) => {
              const Icon = iconFor(session.os);
              return (
                <li
                  key={session.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/75 bg-background/35 p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{session.deviceLabel}</p>
                        {session.current && (
                          <Badge variant="default">Esta sesión</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Última actividad {cuando(session.lastActiveAt)}
                        {session.approximateIp
                          ? ` · IP aprox. ${session.approximateIp}`
                          : ""}
                      </p>
                    </div>
                  </div>

                  {!session.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-start text-destructive hover:text-destructive sm:self-auto"
                      disabled={pending && busyId === session.id}
                      onClick={() => cerrarUna(session.id)}
                    >
                      {pending && busyId === session.id ? "Cerrando…" : "Cerrar"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
