"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleOff,
  Eye,
  EyeOff,
  Loader2,
  RefreshCcw,
  ShoppingBag,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WooCommerceView } from "@/server/integrations/woocommerce/service";

type Busy = "connect" | "sync" | "disconnect" | null;

async function post(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    message?: string;
    store?: { name: string; url: string };
  };
  return { ok: response.ok, payload };
}

function formatDate(value: string | null) {
  if (!value) return "Todavía no registrada";
  return new Intl.DateTimeFormat("es-AR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function WooCommerceCard({
  data,
  canManage,
  showSettings = false,
}: {
  data: WooCommerceView;
  canManage: boolean;
  showSettings?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [showForm, setShowForm] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [storeUrl, setStoreUrl] = useState(data.storeUrl ?? "");
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setBusy("connect");
    try {
      const result = await post("/api/integrations/woocommerce/connect", {
        storeUrl,
        consumerKey,
        consumerSecret,
      });
      if (!result.ok) {
        setFormError(
          result.payload.message ?? "No se pudo conectar WooCommerce."
        );
        return;
      }
      setConsumerKey("");
      setConsumerSecret("");
      setShowForm(false);
      toast.success("WooCommerce quedó conectado.");
      router.refresh();
    } catch {
      setFormError("No se pudo conectar con el servidor.");
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setBusy("sync");
    try {
      const result = await post("/api/integrations/woocommerce/sync", {
        idempotencyKey: crypto.randomUUID(),
      });
      if (!result.ok) {
        toast.error(
          result.payload.message ?? "No se pudo sincronizar WooCommerce."
        );
        return;
      }
      toast.success("Productos, clientes y pedidos sincronizados.");
      router.refresh();
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (
      !window.confirm(
        "¿Desconectar WooCommerce? Los datos sincronizados se conservarán como referencia."
      )
    ) {
      return;
    }
    setBusy("disconnect");
    try {
      const result = await post(
        "/api/integrations/woocommerce/disconnect"
      );
      if (!result.ok) {
        toast.error(
          result.payload.message ?? "No se pudo desconectar WooCommerce."
        );
        return;
      }
      toast.success("WooCommerce quedó desconectado.");
      router.refresh();
    } catch {
      toast.error("No se pudo conectar con el servidor.");
    } finally {
      setBusy(null);
    }
  }

  const state = !data.planAccess
    ? {
        label: "Disponible desde Profesional",
        icon: CircleAlert,
        className:
          "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      }
    : !data.configured
      ? {
          label: "Requiere configuración",
          icon: CircleDashed,
          className: "border-border bg-muted/40 text-muted-foreground",
        }
      : data.reconnectionRequired
        ? {
            label: "Reconexión requerida",
            icon: CircleAlert,
            className:
              "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
          }
        : data.connected
          ? {
              label: "Conectado",
              icon: CircleCheck,
              className:
                "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            }
          : {
              label:
                data.status === "DISCONNECTED"
                  ? "Desconectado"
                  : "No conectado",
              icon: CircleOff,
              className: "border-border bg-muted/40 text-muted-foreground",
            };
  const StatusIcon = state.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <ShoppingBag className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>WooCommerce</CardTitle>
              <CardDescription>
                Sincronizá catálogo, clientes y pedidos. VantixApp no modifica
                stock ni pedidos.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={state.className}>
            <StatusIcon className="size-3.5" aria-hidden />
            {state.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.planAccess && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            {data.planMessage}
          </p>
        )}
        {data.planAccess && !data.configured && (
          <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            {data.configurationMessage}
          </p>
        )}
        {(data.connected ||
          data.status === "DISCONNECTED" ||
          data.reconnectionRequired) && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Tienda</dt>
              <dd className="mt-1 font-medium">
                {data.storeName ?? "Sin nombre"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">URL</dt>
              <dd className="mt-1 break-all font-medium">
                {data.storeUrl ?? "No informada"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Última sincronización
              </dt>
              <dd className="mt-1 font-medium">
                {formatDate(data.lastSyncedAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Último webhook
              </dt>
              <dd className="mt-1 font-medium">
                {formatDate(data.lastWebhookAt)}
              </dd>
            </div>
          </dl>
        )}
        {data.lastError && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {data.lastError}
          </p>
        )}
        {showForm && canManage && data.planAccess && data.configured && (
          <form
            onSubmit={connect}
            className="space-y-4 rounded-xl border bg-muted/20 p-4"
          >
            <div className="space-y-2">
              <Label htmlFor="woocommerce-store-url">URL de la tienda</Label>
              <Input
                id="woocommerce-store-url"
                type="url"
                inputMode="url"
                autoComplete="url"
                value={storeUrl}
                onChange={(event) => setStoreUrl(event.target.value)}
                placeholder="https://mitienda.com"
                maxLength={500}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="woocommerce-consumer-key">Consumer Key</Label>
              <Input
                id="woocommerce-consumer-key"
                value={consumerKey}
                onChange={(event) => setConsumerKey(event.target.value)}
                placeholder="ck_…"
                autoComplete="off"
                maxLength={103}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="woocommerce-consumer-secret">
                Consumer Secret
              </Label>
              <div className="relative">
                <Input
                  id="woocommerce-consumer-secret"
                  type={showSecret ? "text" : "password"}
                  value={consumerSecret}
                  onChange={(event) => setConsumerSecret(event.target.value)}
                  placeholder="cs_…"
                  autoComplete="new-password"
                  maxLength={103}
                  className="pr-11"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0"
                  onClick={() => setShowSecret((value) => !value)}
                  aria-label={
                    showSecret ? "Ocultar Consumer Secret" : "Mostrar Consumer Secret"
                  }
                >
                  {showSecret ? <EyeOff /> : <Eye />}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Creá claves con acceso Lectura/Escritura: la escritura se usa
              únicamente para registrar webhooks; la sincronización y el agente
              son de solo lectura.
            </p>
            {formError && (
              <p
                role="alert"
                tabIndex={-1}
                className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
              >
                {formError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy !== null}>
                {busy === "connect" && <Loader2 className="animate-spin" />}
                Validar y conectar
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  setShowForm(false);
                  setConsumerKey("");
                  setConsumerSecret("");
                  setFormError(null);
                }}
              >
                Cancelar
              </Button>
            </div>
          </form>
        )}
        {showSettings && data.connected && (
          <div className="space-y-4 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries(data.counts).map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border bg-muted/20 p-3"
                >
                  <p className="text-xs text-muted-foreground">
                    {key === "products"
                      ? "Productos"
                      : key === "variants"
                        ? "Variantes"
                        : key === "customers"
                          ? "Clientes"
                          : "Pedidos"}
                  </p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {value}
                  </p>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-sm font-semibold">Sincronización manual</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Actualiza productos, variantes, SKU, stock, precios, clientes y
                pedidos desde la tienda.
              </p>
            </div>
            {canManage && (
              <Button onClick={sync} disabled={busy !== null}>
                {busy === "sync" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <RefreshCcw />
                )}
                Sincronizar ahora
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {!data.planAccess ? (
          <Button asChild size="sm">
            <Link href="/dashboard/planes">Ver planes</Link>
          </Button>
        ) : canManage && data.configured && !data.connected && !showForm ? (
          <Button size="sm" onClick={() => setShowForm(true)}>
            {data.reconnectionRequired
              ? "Reconectar WooCommerce"
              : "Conectar WooCommerce"}
          </Button>
        ) : canManage && data.connected ? (
          <>
            {!showSettings && (
              <Button asChild size="sm" variant="secondary">
                <Link href="/dashboard/integraciones/woocommerce">
                  Administrar
                  <ArrowRight />
                </Link>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(true)}
              disabled={busy !== null}
            >
              <RefreshCcw />
              Reconectar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={disconnect}
              disabled={busy !== null}
            >
              {busy === "disconnect" ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Unplug />
              )}
              Desconectar
            </Button>
          </>
        ) : null}
      </CardFooter>
    </Card>
  );
}
