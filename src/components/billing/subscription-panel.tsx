"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CreditCard, RefreshCcw, RotateCcw, XCircle } from "lucide-react";
import type { BillingOverview } from "@/server/billing/service";
import type { BillingHistoryEntry, PaymentOutcome } from "@/server/billing/history";
import { BILLING_PLANS } from "@/lib/billing/plans";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * Estado real de la suscripción, acciones y historial de pagos.
 *
 * Todo lo que se muestra viene del servidor ya resuelto: este componente no
 * calcula estados ni fechas, solo los presenta. Las acciones pegan contra las
 * rutas de `/api/billing`, que vuelven a resolver la organización desde la
 * sesión y verifican el permiso: nada de lo que se manda desde acá se usa
 * para decidir a qué organización se le toca la suscripción.
 */

const ESTADO: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  TRIALING: { label: "Prueba gratuita", variant: "secondary" },
  ACTIVE: { label: "Activa", variant: "default" },
  PAST_DUE: { label: "Pago pendiente", variant: "destructive" },
  CANCELED: { label: "Cancelada", variant: "outline" },
  EXPIRED: { label: "Vencida", variant: "destructive" },
  INCOMPLETE: { label: "Sin confirmar", variant: "outline" },
};

const RESULTADO: Record<PaymentOutcome, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
  canceled: "outline",
  other: "outline",
};

function fecha(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

function fechaHora(iso: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(iso));
}

function pesos(value: number): string {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

export function SubscriptionPanel({
  billing,
  history,
  priceArs,
  canManage,
}: {
  billing: BillingOverview;
  history: BillingHistoryEntry[];
  /** Precio vigente del plan actual en ARS; `null` si no se pudo cotizar. */
  priceArs: number | null;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pendiente, setPendiente] = useState<"cancel" | "sync" | null>(null);
  const { entitlement } = billing;
  const estado = ESTADO[entitlement.status] ?? {
    label: entitlement.status,
    variant: "outline" as const,
  };

  async function accion(ruta: string, tipo: "cancel" | "sync") {
    setPendiente(tipo);
    try {
      const response = await fetch(ruta, { method: "POST" });
      const data = (await response.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!response.ok) {
        toast.error(data?.message ?? "No se pudo completar la operación.");
        return;
      }
      toast.success(
        tipo === "cancel"
          ? "Suscripción cancelada. Conservás el acceso hasta el final del período pago."
          : "Estado actualizado."
      );
      router.refresh();
    } catch {
      toast.error("No se pudo conectar. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setPendiente(null);
    }
  }

  const cancelada = entitlement.status === "CANCELED";
  const precioPlan = BILLING_PLANS[entitlement.plan];

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Tu suscripción</CardTitle>
              <CardDescription className="mt-1">
                Estado real informado por Mercado Pago.
              </CardDescription>
            </div>
            <Badge variant={estado.variant}>{estado.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Plan actual</dt>
              <dd className="mt-1 text-sm font-semibold">
                {entitlement.planName}
                {entitlement.internalPlanTest && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    (prueba interna)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Precio</dt>
              <dd className="mt-1 text-sm font-semibold">
                {priceArs === null ? (
                  <span className="font-normal text-muted-foreground">
                    USD {precioPlan.usdMonthly} · cotización no disponible
                  </span>
                ) : (
                  <>
                    {pesos(priceArs)}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      ARS / mes
                    </span>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {entitlement.status === "TRIALING" ? "Fin de la prueba" : "Próximo cobro"}
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {entitlement.status === "TRIALING"
                  ? fecha(entitlement.trialEndsAt)
                  : fecha(entitlement.nextBillingAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {cancelada ? "Acceso hasta" : "Período vigente hasta"}
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {fecha(entitlement.currentPeriodEndsAt ?? entitlement.trialEndsAt)}
              </dd>
            </div>
          </dl>

          {!entitlement.accessAllowed && (
            <p className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
              El acceso está limitado. Elegí un plan más abajo para volver a
              operar con normalidad.
            </p>
          )}

          {cancelada && entitlement.accessAllowed && (
            <p className="mt-5 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              Cancelaste la suscripción. Conservás el acceso hasta el{" "}
              {fecha(entitlement.currentPeriodEndsAt)}. Podés reactivarla
              eligiendo un plan más abajo.
            </p>
          )}

          {canManage && (
            <div className="mt-5 flex flex-wrap gap-2">
              {billing.canSynchronize && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendiente !== null}
                  onClick={() => accion("/api/billing/sync", "sync")}
                >
                  <RefreshCcw className="size-4" aria-hidden />
                  {pendiente === "sync" ? "Actualizando…" : "Actualizar estado"}
                </Button>
              )}

              {billing.canCancel && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={pendiente !== null}>
                      <XCircle className="size-4" aria-hidden />
                      Cancelar suscripción
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Cancelar la suscripción?</AlertDialogTitle>
                      <AlertDialogDescription>
                        No se van a hacer más cobros. Conservás el acceso hasta
                        el {fecha(entitlement.currentPeriodEndsAt)} y podés
                        volver a contratar cuando quieras.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Volver</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => accion("/api/billing/cancel", "cancel")}
                      >
                        Cancelar suscripción
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

              {cancelada && (
                <Button variant="default" size="sm" asChild>
                  <a href="#planes">
                    <RotateCcw className="size-4" aria-hidden />
                    Reactivar suscripción
                  </a>
                </Button>
              )}
            </div>
          )}

          {billing.lastSyncedAt && (
            <p className="mt-4 text-xs text-muted-foreground">
              Última sincronización con Mercado Pago: {fechaHora(billing.lastSyncedAt)}.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex size-9 items-center justify-center rounded-lg border border-primary/15 bg-primary/10">
            <CreditCard className="size-4 text-primary" aria-hidden />
          </div>
          <CardTitle className="mt-2 text-base">Historial de pagos</CardTitle>
          <CardDescription>
            Movimientos informados por Mercado Pago. Si un dato no llegó, se
            muestra vacío.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todavía no hay movimientos. Cuando contrates un plan van a
              aparecer acá.
            </p>
          ) : (
            <>
              <div className="space-y-2 md:hidden">
                {history.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-lg border border-border/75 bg-background/35 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-medium">{item.description}</p>
                      <Badge variant={RESULTADO[item.outcome]}>
                        {item.outcomeLabel}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {fechaHora(item.occurredAt)}
                    </p>
                    {item.amountArs !== null && (
                      <p className="mt-1 text-sm font-semibold">
                        {pesos(item.amountArs)} {item.currency}
                      </p>
                    )}
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Movimiento</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead className="text-right">Importe</TableHead>
                      <TableHead className="text-right">Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((item) => (
                      <TableRow key={item.id} className={item.ignored ? "opacity-55" : undefined}>
                        <TableCell className="whitespace-nowrap text-xs">
                          {fechaHora(item.occurredAt)}
                        </TableCell>
                        <TableCell className="text-sm">{item.description}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.plan ? BILLING_PLANS[item.plan].name : "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm font-medium">
                          {item.amountArs === null ? "—" : pesos(item.amountArs)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={RESULTADO[item.outcome]}>
                            {item.outcomeLabel}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
