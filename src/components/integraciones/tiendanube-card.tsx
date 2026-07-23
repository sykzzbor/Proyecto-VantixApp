"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, CircleOff, Loader2, RefreshCcw, Store, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { TiendanubeView } from "@/server/integrations/tiendanube/service";

type Busy = "connect" | "sync" | "disconnect" | null;

const RESULT_MESSAGES: Record<string, { tone: "success" | "info" | "error"; message: string }> = {
  conectado: { tone: "success", message: "Tiendanube quedó conectado. Ya podés sincronizar la tienda." },
  cancelado: { tone: "info", message: "La conexión con Tiendanube fue cancelada." },
  plan_requerido: { tone: "error", message: "Tiendanube requiere un plan Profesional o Empresarial activo." },
  sin_permisos: { tone: "error", message: "No tenés permisos para conectar Tiendanube." },
  estado_invalido: { tone: "error", message: "La conexión venció. Volvé a iniciarla." },
  error_oauth: { tone: "error", message: "Tiendanube no pudo completar la conexión." },
  sesion_requerida: { tone: "error", message: "Iniciá sesión para conectar Tiendanube." },
};

async function post(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    url?: string;
    counts?: Record<string, number>;
  };
  return { ok: response.ok, payload };
}

function formatDate(value: string | null) {
  if (!value) return "Todavía no registrada";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TiendanubeCard({ data, canManage, showSettings = false }: {
  data: TiendanubeView;
  canManage: boolean;
  showSettings?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    const result = searchParams.get("tiendanube");
    if (!result) return;
    const feedback = RESULT_MESSAGES[result];
    if (feedback?.tone === "success") toast.success(feedback.message);
    else if (feedback?.tone === "info") toast.info(feedback.message);
    else toast.error(feedback?.message ?? "No se pudo completar la conexión con Tiendanube.");
    const url = new URL(window.location.href);
    url.searchParams.delete("tiendanube");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [searchParams]);

  async function execute(path: string, action: Exclude<Busy, null>, body?: unknown) {
    setBusy(action);
    try {
      const result = await post(path, body);
      if (!result.ok) {
        toast.error(result.payload.message ?? "No se pudo completar la operación.");
        return result;
      }
      router.refresh();
      return result;
    } catch {
      toast.error("No se pudo conectar con el servidor.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    const result = await execute("/api/integrations/tiendanube/connect", "connect");
    if (result?.ok && result.payload.url) window.location.assign(result.payload.url);
  }

  async function sync() {
    const result = await execute("/api/integrations/tiendanube/sync", "sync", { idempotencyKey: crypto.randomUUID() });
    if (result?.ok) toast.success("Productos, clientes y pedidos sincronizados.");
  }

  async function disconnect() {
    if (!window.confirm("¿Desconectar Tiendanube? Los datos sincronizados se conservarán como referencia.")) return;
    const result = await execute("/api/integrations/tiendanube/disconnect", "disconnect");
    if (result?.ok) toast.success("Tiendanube quedó desconectado.");
  }

  const state = !data.planAccess
    ? { label: "Disponible desde Profesional", icon: CircleAlert, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
    : !data.configured
      ? { label: "Requiere configuración", icon: CircleDashed, className: "border-border bg-muted/40 text-muted-foreground" }
      : data.reconnectionRequired
        ? { label: "Reconexión requerida", icon: CircleAlert, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
        : data.connected
          ? { label: "Conectado", icon: CircleCheck, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" }
          : { label: data.status === "DISCONNECTED" ? "Desconectado" : "No conectado", icon: CircleOff, className: "border-border bg-muted/40 text-muted-foreground" };
  const StatusIcon = state.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
              <Store className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>Tiendanube</CardTitle>
              <CardDescription>Sincronizá catálogo, clientes y pedidos sin permitir modificaciones automáticas.</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={state.className}><StatusIcon className="size-3.5" aria-hidden />{state.label}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.planAccess && <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">{data.planMessage}</p>}
        {data.planAccess && !data.configured && <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">{data.configurationMessage}</p>}
        {(data.connected || data.status === "DISCONNECTED" || data.reconnectionRequired) && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Tienda</dt><dd className="mt-1 font-medium">{data.storeName ?? "Sin nombre"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Dominio</dt><dd className="mt-1 break-all font-medium">{data.storeDomain ?? "No informado"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Última sincronización</dt><dd className="mt-1 font-medium">{formatDate(data.lastSyncedAt)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Último webhook</dt><dd className="mt-1 font-medium">{formatDate(data.lastWebhookAt)}</dd></div>
          </dl>
        )}
        {data.lastError && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{data.lastError}</p>}
        {showSettings && data.connected && (
          <div className="space-y-4 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(data.counts).map(([key, value]) => (
                <div key={key} className="rounded-lg border bg-muted/20 p-3">
                  <p className="text-xs capitalize text-muted-foreground">{key === "products" ? "Productos" : key === "variants" ? "Variantes" : key === "customers" ? "Clientes" : "Pedidos"}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-sm font-semibold">Sincronización manual</h3>
              <p className="mt-1 text-xs text-muted-foreground">Lee productos, variantes, stock, precios, clientes y pedidos. VantixApp no modifica la tienda.</p>
            </div>
            {canManage && <Button onClick={sync} disabled={busy !== null}>{busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCcw />}Sincronizar ahora</Button>}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!data.planAccess ? <Button asChild size="sm"><Link href="/dashboard/planes">Ver planes</Link></Button>
          : canManage && data.configured && !data.connected ? <Button size="sm" onClick={connect} disabled={busy !== null}>{busy === "connect" && <Loader2 className="animate-spin" />}{data.reconnectionRequired ? "Reconectar Tiendanube" : "Conectar Tiendanube"}</Button>
          : canManage && data.connected ? <>
              {!showSettings && <Button asChild size="sm" variant="secondary"><Link href="/dashboard/integraciones/tiendanube">Administrar<ArrowRight /></Link></Button>}
              <Button size="sm" variant="outline" onClick={connect} disabled={busy !== null}><RefreshCcw />Reconectar</Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}><Unplug />Desconectar</Button>
            </> : null}
      </CardFooter>
    </Card>
  );
}
