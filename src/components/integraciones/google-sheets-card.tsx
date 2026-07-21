"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, CircleAlert, CircleCheck, CircleDashed, CircleOff, Loader2, RefreshCcw, Sheet, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getGoogleSheetsOAuthFeedback } from "@/lib/google-sheets-oauth-result";
import type { GoogleSheetsView } from "@/server/integrations/google-sheets/service";

type Busy = "connect" | "create" | "select" | "sync" | "disconnect" | null;

async function post(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({})) as {
    message?: string;
    url?: string;
    name?: string;
    rows?: Record<string, number>;
  };
  return { ok: response.ok, payload };
}

export function GoogleSheetsCard({
  data,
  canManage,
  showSettings = false,
}: {
  data: GoogleSheetsView;
  canManage: boolean;
  showSettings?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<Busy>(null);
  const [createName, setCreateName] = useState("Exportación VantixApp");
  const [reference, setReference] = useState("");
  const [datasets, setDatasets] = useState(["clients", "conversations", "metrics"]);

  useEffect(() => {
    const result = searchParams.get("sheets");
    const feedback = getGoogleSheetsOAuthFeedback(result);
    if (!result) return;
    if (feedback?.tone === "success") toast.success(feedback.message);
    else if (feedback?.tone === "info") toast.info(feedback.message);
    else if (feedback) toast.error(feedback.message);
    const url = new URL(window.location.href);
    url.searchParams.delete("sheets");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [searchParams]);

  async function handle(path: string, action: Exclude<Busy, null>, body?: unknown) {
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
    const result = await handle("/api/integrations/google-sheets/connect", "connect");
    if (result?.ok && result.payload.url) window.location.assign(result.payload.url);
  }

  async function createSpreadsheet() {
    const result = await handle("/api/integrations/google-sheets/spreadsheet", "create", {
      mode: "create",
      name: createName,
    });
    if (result?.ok) toast.success(`Hoja ${result.payload.name ?? "creada"} lista.`);
  }

  async function selectSpreadsheet() {
    const result = await handle("/api/integrations/google-sheets/spreadsheet", "select", {
      mode: "select",
      reference,
    });
    if (result?.ok) toast.success("Hoja vinculada correctamente.");
  }

  async function sync() {
    const result = await handle("/api/integrations/google-sheets/sync", "sync", {
      datasets,
      idempotencyKey: crypto.randomUUID(),
    });
    if (result?.ok) toast.success("Datos sincronizados con Google Sheets.");
  }

  async function disconnect() {
    if (!window.confirm("¿Desconectar Google Sheets? La hoja y los datos exportados no se borrarán.")) return;
    const result = await handle("/api/integrations/google-sheets/disconnect", "disconnect");
    if (result?.ok) toast.success("Google Sheets desconectado.");
  }

  const state = !data.planAccess
    ? { label: "Disponible desde Standard", icon: CircleAlert, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
    : !data.configured
      ? { label: "Requiere configuración", icon: CircleDashed, className: "border-border bg-muted/40 text-muted-foreground" }
      : !data.connected
        ? { label: "No conectado", icon: CircleOff, className: "border-border bg-muted/40 text-muted-foreground" }
        : data.reconnectionRequired
          ? { label: "Reconexión requerida", icon: CircleAlert, className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" }
        : data.status === "ERROR"
          ? { label: "Con error", icon: CircleAlert, className: "border-destructive/30 bg-destructive/10 text-destructive" }
          : { label: "Conectado", icon: CircleCheck, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  const StatusIcon = state.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
              <Sheet className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>Google Sheets</CardTitle>
              <CardDescription>Exportá clientes, conversaciones y métricas a una hoja controlada.</CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={state.className}>
            <StatusIcon className="size-3.5" aria-hidden /> {state.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.planAccess && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">{data.planMessage}</p>
        )}
        {data.planAccess && !data.configured && (
          <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">{data.configurationMessage}</p>
        )}
        {data.connected && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Hoja elegida</dt><dd className="mt-1 font-medium">{data.spreadsheetName ?? "Sin elegir"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Última sincronización</dt><dd className="mt-1 font-medium">{data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString("es-AR") : "Todavía no realizada"}</dd></div>
          </dl>
        )}
        {data.reconnectionRequired && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            Reconectá la cuenta para renovar los permisos de sincronización.
          </p>
        )}
        {data.lastError && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">{data.lastError}</p>}

        {showSettings && data.planAccess && data.configured && data.connected && !data.reconnectionRequired && canManage && (
          <div className="space-y-5 border-t pt-5">
            <section className="space-y-3">
              <div><h3 className="text-sm font-semibold">Crear una hoja</h3><p className="text-xs text-muted-foreground">Vantix crea un archivo nuevo en la cuenta conectada.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Label htmlFor="sheets-name" className="sr-only">Nombre de la hoja</Label>
                <Input id="sheets-name" value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={120} />
                <Button onClick={createSpreadsheet} disabled={busy !== null || createName.trim().length < 3}>{busy === "create" && <Loader2 className="animate-spin" />}Crear</Button>
              </div>
            </section>
            <section className="space-y-3">
              <div><h3 className="text-sm font-semibold">Usar una hoja existente</h3><p className="text-xs text-muted-foreground">Pegá la URL o el ID. Google validará que la cuenta tenga acceso.</p></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Label htmlFor="sheets-reference" className="sr-only">URL o ID de Google Sheets</Label>
                <Input id="sheets-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" maxLength={1000} />
                <Button variant="outline" onClick={selectSpreadsheet} disabled={busy !== null || reference.trim().length < 20}>{busy === "select" && <Loader2 className="animate-spin" />}Vincular</Button>
              </div>
            </section>
            <section className="space-y-3">
              <div><h3 className="text-sm font-semibold">Sincronización manual</h3><p className="text-xs text-muted-foreground">Reemplaza únicamente las pestañas administradas por Vantix.</p></div>
              <div className="grid gap-2 sm:grid-cols-3">
                {[["clients", "Clientes"], ["conversations", "Conversaciones"], ["metrics", "Métricas"]].map(([value, label]) => (
                  <Label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border px-3 font-normal">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={datasets.includes(value)}
                      onChange={(event) => setDatasets((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((item) => item !== value))}
                    />
                    {label}
                  </Label>
                ))}
              </div>
              <Button onClick={sync} disabled={busy !== null || !data.spreadsheetSelected || datasets.length === 0}>
                {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
                Sincronizar ahora
              </Button>
            </section>
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!data.planAccess ? <Button asChild size="sm"><Link href="/dashboard/planes">Ver planes</Link></Button>
          : canManage && data.configured && !data.connected ? <Button size="sm" onClick={connect} disabled={busy !== null}>{busy === "connect" && <Loader2 className="animate-spin" />}Conectar con Google</Button>
          : canManage && data.connected ? <>
              {!showSettings && <Button asChild variant="secondary" size="sm"><Link href="/dashboard/integraciones/google-sheets">Administrar<ArrowRight /></Link></Button>}
              <Button size="sm" variant="outline" onClick={connect} disabled={busy !== null}><RefreshCcw />Reconectar</Button>
              <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}><Unplug />Desconectar</Button>
            </> : null}
      </CardFooter>
    </Card>
  );
}
