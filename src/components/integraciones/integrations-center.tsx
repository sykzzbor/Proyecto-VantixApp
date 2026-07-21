"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleOff,
  Clock3,
  Loader2,
  PlugZap,
  RefreshCcw,
  ShieldCheck,
  ShoppingBag,
  Store,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { WhatsappIcon } from "@/components/whatsapp/whatsapp-icon";
import { ManualWhatsappConnectionDialog } from "@/components/integraciones/manual-whatsapp-connection-dialog";
import { YCloudConnectionDialog } from "@/components/integraciones/ycloud-connection-dialog";
import { GoogleCalendarAppointmentSettings } from "@/components/integraciones/google-calendar-appointment-settings";
import { GoogleSheetsCard } from "@/components/integraciones/google-sheets-card";
import { cn } from "@/lib/utils";
import { getGoogleCalendarOAuthFeedback } from "@/lib/google-calendar-oauth-result";
import type {
  IntegrationsCenterView,
  SafeDiagnostic,
} from "@/server/integrations/diagnostics";

type FacebookLoginResponse = {
  authResponse?: { code?: string };
  status?: string;
};

type FacebookSdk = {
  init: (options: {
    appId: string;
    version: string;
    cookie?: boolean;
    xfbml?: boolean;
  }) => void;
  login: (
    callback: (response: FacebookLoginResponse) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        setup: Record<string, never>;
        featureType: string;
        sessionInfoVersion: string;
      };
    }
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type StartResponse = {
  ok?: boolean;
  state?: string;
  message?: string;
  configuration?: {
    appId?: string;
    configurationId?: string;
    graphApiVersion?: string;
  };
};

const FACEBOOK_MESSAGE_ORIGINS = new Set([
  "https://www.facebook.com",
  "https://web.facebook.com",
]);
const FACEBOOK_SDK_ID = "meta-facebook-jssdk";
const FACEBOOK_SDK_URL = "https://connect.facebook.net/es_LA/sdk.js";
let facebookSdkPromise: Promise<FacebookSdk> | null = null;

function loadFacebookSdk(configuration: {
  appId: string;
  graphApiVersion: string;
}): Promise<FacebookSdk> {
  if (window.FB) {
    window.FB.init({
      appId: configuration.appId,
      version: configuration.graphApiVersion,
      cookie: false,
      xfbml: false,
    });
    return Promise.resolve(window.FB);
  }
  if (facebookSdkPromise) return facebookSdkPromise;

  facebookSdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (!window.FB) {
        document.getElementById(FACEBOOK_SDK_ID)?.remove();
        window.fbAsyncInit = undefined;
      }
      facebookSdkPromise = null;
      reject(new Error("No se pudo cargar el inicio de sesión de Meta."));
    }, 12_000);

    window.fbAsyncInit = () => {
      if (!window.FB) {
        window.clearTimeout(timeout);
        facebookSdkPromise = null;
        reject(new Error("No se pudo iniciar la conexión con Meta."));
        return;
      }
      window.FB.init({
        appId: configuration.appId,
        version: configuration.graphApiVersion,
        cookie: false,
        xfbml: false,
      });
      window.clearTimeout(timeout);
      resolve(window.FB);
    };

    const existing = document.getElementById(FACEBOOK_SDK_ID);
    if (existing) return;
    const script = document.createElement("script");
    script.id = FACEBOOK_SDK_ID;
    script.async = true;
    script.defer = true;
    script.src = FACEBOOK_SDK_URL;
    script.onerror = () => {
      window.clearTimeout(timeout);
      facebookSdkPromise = null;
      window.fbAsyncInit = undefined;
      script.remove();
      reject(new Error("No se pudo cargar el inicio de sesión de Meta."));
    };
    document.head.appendChild(script);
  });
  return facebookSdkPromise;
}

function parseEmbeddedSignupMessage(data: unknown):
  | { event: "FINISH" | "CANCEL" | "ERROR" }
  | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (
    record.event !== "FINISH" &&
    record.event !== "CANCEL" &&
    record.event !== "ERROR"
  ) {
    return null;
  }
  return { event: record.event };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function postAction(
  path: string,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await readJson(response);
  if (!response.ok) {
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "No se pudo completar la operación."
    );
  }
  return result;
}

function formatDate(value: string | null): string {
  if (!value) return "Sin actividad";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin actividad";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function DiagnosticList({ diagnostic }: { diagnostic: SafeDiagnostic }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Estado de preparación</p>
        <Badge
          variant={diagnostic.missingCount === 0 ? "default" : "outline"}
          className={cn(
            diagnostic.missingCount === 0 &&
              "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            diagnostic.missingCount > 0 &&
              "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          )}
        >
          {diagnostic.missingCount === 0
            ? "Configuración completa"
            : `Faltan ${diagnostic.missingCount} ${
                diagnostic.missingCount === 1 ? "paso" : "pasos"
              }`}
        </Badge>
      </div>
      <ul className="grid gap-2" aria-label="Pasos de configuración">
        {diagnostic.steps.map((step) => (
          <li
            key={step.code}
            className="flex min-w-0 items-start gap-2.5 rounded-lg border border-border/70 bg-muted/25 p-3"
          >
            <span
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                step.ready
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
              )}
            >
              {step.ready ? (
                <Check className="size-3.5" aria-hidden />
              ) : (
                <Clock3 className="size-3.5" aria-hidden />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{step.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {step.description}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

const WHATSAPP_STATUS = {
  not_connected: {
    label: "No conectado",
    icon: CircleOff,
    className: "border-border bg-muted/40 text-muted-foreground",
  },
  meta_configuration_pending: {
    label: "Configuración de Meta pendiente",
    icon: CircleDashed,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  connecting: {
    label: "Conectando",
    icon: Loader2,
    className: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  action_required: {
    label: "Acción requerida",
    icon: CircleAlert,
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  connected: {
    label: "Conectado",
    icon: CircleCheck,
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  error: {
    label: "Con error",
    icon: CircleAlert,
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  disconnected: {
    label: "Desconectado",
    icon: CircleOff,
    className: "border-border bg-muted/40 text-muted-foreground",
  },
} as const;

function WhatsappCard({
  data,
  canManage,
}: {
  data: IntegrationsCenterView["whatsapp"];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "connect" | "test" | "reconnect" | "disconnect" | null
  >(null);
  const mountedRef = useRef(true);
  const attemptOpenRef = useRef(false);
  const embeddedCleanupRef = useRef<(() => void) | null>(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const status = WHATSAPP_STATUS[data.status];
  const StatusIcon = status.icon;
  const webhookReady =
    data.diagnostics.steps.find((step) => step.code === "webhook")?.ready ??
    false;

  const cancelOpenAttempt = useCallback((force = false) => {
    if (!attemptOpenRef.current && !force) return Promise.resolve();
    attemptOpenRef.current = false;
    return fetch("/api/integrations/whatsapp/cancel", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      keepalive: true,
    })
      .then(() => undefined)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      embeddedCleanupRef.current?.();
      embeddedCleanupRef.current = null;
      void cancelOpenAttempt();
    };
  }, [cancelOpenAttempt]);

  async function refreshAfter(message: string) {
    toast.success(message);
    router.refresh();
  }

  async function completeEmbeddedSignup(code: string) {
    const result = await postAction("/api/integrations/whatsapp/complete", {
      code,
    });
    if (!mountedRef.current) return;
    if (result.state === "processing") {
      toast.info(
        "La conexión ya se está verificando. El estado se actualizará al finalizar."
      );
      router.refresh();
      return;
    }
    if (result.state !== "connected" && result.state !== "already_connected") {
      throw new Error("Meta no confirmó la conexión.");
    }
    await refreshAfter("WhatsApp quedó conectado de forma segura.");
  }

  async function connectWhatsapp() {
    embeddedCleanupRef.current?.();
    embeddedCleanupRef.current = null;
    setBusy("connect");
    let settled = false;
    let cleanup = () => undefined;
    try {
      const start = (await postAction(
        "/api/integrations/whatsapp/start"
      )) as StartResponse;
      attemptOpenRef.current = true;
      if (!mountedRef.current) {
        void cancelOpenAttempt();
        return;
      }
      const configuration = start.configuration;
      if (
        !configuration?.appId ||
        !configuration.configurationId ||
        !configuration.graphApiVersion
      ) {
        throw new Error("La configuración de Meta todavía no está completa.");
      }
      const sdk = await loadFacebookSdk({
        appId: configuration.appId,
        graphApiVersion: configuration.graphApiVersion,
      });
      if (!mountedRef.current) return;

      const onMessage = (event: MessageEvent) => {
        if (
          !mountedRef.current ||
          !FACEBOOK_MESSAGE_ORIGINS.has(event.origin)
        ) {
          return;
        }
        const message = parseEmbeddedSignupMessage(event.data);
        if (!message || settled) return;
        if (message.event === "CANCEL") {
          settled = true;
          cleanup();
          void cancelOpenAttempt().finally(() => router.refresh());
          setBusy(null);
          toast.info("La conexión con Meta fue cancelada.");
        } else if (message.event === "ERROR") {
          settled = true;
          cleanup();
          void cancelOpenAttempt().finally(() => router.refresh());
          setBusy(null);
          toast.error("Meta no pudo completar la conexión. Volvé a intentar.");
        }
      };
      const timeout = window.setTimeout(() => {
        if (!mountedRef.current || settled) return;
        settled = true;
        cleanup();
        void cancelOpenAttempt().finally(() => router.refresh());
        setBusy(null);
        toast.error("La conexión con Meta venció. Volvé a intentar.");
      }, 5 * 60_000);
      cleanup = () => {
        window.removeEventListener("message", onMessage);
        window.clearTimeout(timeout);
        embeddedCleanupRef.current = null;
      };
      embeddedCleanupRef.current = cleanup;
      window.addEventListener("message", onMessage);

      sdk.login(
        (response) => {
          if (!mountedRef.current || settled) return;
          const code = response.authResponse?.code;
          if (!code) {
            settled = true;
            cleanup();
            void cancelOpenAttempt().finally(() => router.refresh());
            setBusy(null);
            toast.info("La conexión con Meta no se completó.");
            return;
          }
          settled = true;
          cleanup();
          attemptOpenRef.current = false;
          void completeEmbeddedSignup(code)
            .catch((error) => {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "No se pudo completar la conexión."
              );
              // Si el backend falló antes de reclamar el código, cierra el
              // intento AWAITING_CODE. PROCESSING/SUCCEEDED no se modifican.
              void cancelOpenAttempt(true).finally(() => router.refresh());
            })
            .finally(() => setBusy(null));
        },
        {
          config_id: configuration.configurationId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: "",
            sessionInfoVersion: "3",
          },
        }
      );
    } catch (error) {
      cleanup();
      await cancelOpenAttempt();
      if (!mountedRef.current) return;
      setBusy(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar la conexión con Meta."
      );
    }
  }

  async function runSimpleAction(
    action: "test" | "reconnect" | "disconnect"
  ) {
    setBusy(action);
    try {
      await postAction(`/api/integrations/whatsapp/${action}`);
      if (action === "disconnect") {
        setDisconnectOpen(false);
        await refreshAfter(
          "WhatsApp fue desconectado sin borrar conversaciones ni mensajes."
        );
      } else if (action === "reconnect") {
        await refreshAfter("WhatsApp volvió a quedar conectado.");
      } else {
        await refreshAfter("La conexión con WhatsApp fue verificada.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo completar la operación."
      );
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const shouldConnect =
    !data.integration &&
    (data.status !== "connecting" || data.resumeAvailable) &&
    data.status !== "meta_configuration_pending";
  const shouldRetry =
    data.status === "action_required" || data.status === "error";
  const shouldReconnect = data.status === "disconnected";

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <WhatsappIcon className="size-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>WhatsApp</CardTitle>
              <CardDescription>
                Canal oficial para mensajes, estados de entrega y alertas.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={status.className}>
            <StatusIcon
              className={cn(
                "size-3.5",
                data.status === "connecting" && "animate-spin"
              )}
              aria-hidden
            />
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {data.integration ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail
              label="Proveedor"
              value={
                data.integration.provider === "YCLOUD"
                  ? "YCloud"
                  : "Meta Cloud API"
              }
            />
            <Detail
              label="Número"
              value={data.integration.maskedPhoneNumber ?? "No disponible"}
            />
            <Detail
              label="Nombre verificado"
              value={data.integration.verifiedName ?? "No disponible"}
            />
            <Detail
              label="Método"
              value={
                data.integration.connectionMethod === "EMBEDDED_SIGNUP"
                  ? "Conexión guiada"
                  : data.integration.connectionMethod === "COEXISTENCE"
                    ? "Coexistence"
                    : "Manual"
              }
            />
            <Detail
              label="Última sincronización"
              value={formatDate(data.integration.lastSyncedAt ?? null)}
            />
            <Detail
              label="Último webhook"
              value={formatDate(data.integration.lastWebhookAt ?? null)}
            />
            <Detail
              label="Conectado desde"
              value={formatDate(data.integration.connectedAt ?? null)}
            />
            <Detail
              label="Webhook"
              value={webhookReady ? "Activo" : "Pendiente"}
            />
          </dl>
        ) : (
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Tu número todavía no está conectado. Cuando lo conectes, acá vas a
            ver el proveedor, el número y la actividad del canal.
          </p>
        )}

        {data.lastError && (
          <div className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">Último error</p>
              <p className="mt-0.5 break-words text-xs leading-relaxed">
                {data.lastError}
              </p>
            </div>
          </div>
        )}

        <details className="group rounded-lg border border-border/70 bg-muted/20">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium marker:hidden">
            <span>Preparación del canal</span>
            <span className="text-xs font-normal text-muted-foreground">
              {data.diagnostics.missingCount === 0
                ? "Completa"
                : `${data.diagnostics.missingCount} pendiente${data.diagnostics.missingCount === 1 ? "" : "s"}`}
            </span>
          </summary>
          <div className="border-t border-border/70 p-3">
            <DiagnosticList diagnostic={data.diagnostics} />
          </div>
        </details>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {canManage ? (
          <>
            <ManualWhatsappConnectionDialog
              onConnected={() => router.refresh()}
              triggerLabel={
                data.status === "connected" &&
                data.integration?.provider === "META_CLOUD"
                  ? "Reconectar"
                  : "Conectar manualmente"
              }
            />
            <YCloudConnectionDialog
              onConnected={() => router.refresh()}
              triggerLabel={
                data.integration?.provider === "YCLOUD"
                  ? "Reconectar YCloud"
                  : "Conectar con YCloud"
              }
            />
            {(shouldConnect || data.status === "meta_configuration_pending") && (
              <Button
                type="button"
                onClick={connectWhatsapp}
                disabled={!data.configurationAvailable || busy !== null}
                title={
                  data.configurationAvailable
                    ? undefined
                    : "La configuración externa de Meta todavía está pendiente"
                }
              >
                {busy === "connect" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <PlugZap aria-hidden />
                )}
                {data.status === "connecting"
                  ? "Continuar conexión"
                  : "Conectar WhatsApp"}
              </Button>
            )}
            {shouldRetry && (
              <Button
                type="button"
                onClick={() =>
                  !data.integration ||
                  data.integration.connectionMethod === "EMBEDDED_SIGNUP"
                    ? connectWhatsapp()
                    : runSimpleAction("reconnect")
                }
                disabled={
                  busy !== null ||
                  ((!data.integration ||
                    data.integration.connectionMethod === "EMBEDDED_SIGNUP") &&
                    !data.configurationAvailable)
                }
              >
                {busy === "reconnect" || busy === "connect" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw aria-hidden />
                )}
                Reintentar
              </Button>
            )}
            {shouldReconnect && (
              <Button
                type="button"
                onClick={() => runSimpleAction("reconnect")}
                disabled={busy !== null}
              >
                {busy === "reconnect" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <RefreshCcw aria-hidden />
                )}
                Reconectar
              </Button>
            )}
            {data.status === "connected" && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => runSimpleAction("test")}
                  disabled={busy !== null}
                >
                  {busy === "test" ? (
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <ShieldCheck aria-hidden />
                  )}
                  Probar conexión
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setDisconnectOpen(true)}
                  disabled={busy !== null}
                >
                  <Unplug aria-hidden />
                  Desconectar
                </Button>
              </>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Vista de solo lectura. Un propietario o administrador puede cambiar
            la conexión.
          </p>
        )}
      </CardFooter>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desconectar WhatsApp?</AlertDialogTitle>
            <AlertDialogDescription>
              Se detendrán los nuevos mensajes y automatizaciones del canal. Las
              conversaciones, clientes y mensajes existentes se conservarán.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "disconnect"}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy === "disconnect"}
              onClick={(event) => {
                event.preventDefault();
                void runSimpleAction("disconnect");
              }}
            >
              {busy === "disconnect" && (
                <Loader2 className="animate-spin" aria-hidden />
              )}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

type GoogleCalendarData = IntegrationsCenterView["googleCalendar"];

function GoogleCalendarCard({
  data,
  canManage,
  showSettings = false,
}: {
  data: GoogleCalendarData;
  canManage: boolean;
  showSettings?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<
    "connect" | "test" | "disconnect" | "calendars" | "select" | null
  >(null);
  const [calendars, setCalendars] = useState<
    { id: string; name: string; primary: boolean }[] | null
  >(null);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  async function post(path: string, body?: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
      [key: string]: unknown;
    };
    return { ok: response.ok, payload };
  }

  async function handleConnect() {
    setBusy("connect");
    try {
      const { ok, payload } = await post("/api/integrations/google-calendar/connect");
      if (!ok || typeof payload.url !== "string") {
        toast.error(payload.message ?? "No se pudo iniciar la conexión con Google.");
        return;
      }
      window.location.assign(payload.url);
    } catch {
      toast.error("No se pudo iniciar la conexión con Google.");
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy("test");
    try {
      const { ok, payload } = await post("/api/integrations/google-calendar/test");
      if (ok) toast.success("Conexión con Google Calendar verificada.");
      else toast.error(payload.message ?? "La prueba de conexión falló.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function handleLoadCalendars() {
    setBusy("calendars");
    try {
      const response = await fetch("/api/integrations/google-calendar/calendars");
      const payload = (await response.json().catch(() => ({}))) as {
        calendars?: { id: string; name: string; primary: boolean }[];
        message?: string;
      };
      if (!response.ok || !payload.calendars) {
        toast.error(payload.message ?? "No se pudieron listar los calendarios.");
        return;
      }
      setCalendars(payload.calendars);
    } finally {
      setBusy(null);
    }
  }

  async function handleSelect(calendarId: string) {
    setBusy("select");
    try {
      const { ok, payload } = await post(
        "/api/integrations/google-calendar/calendar",
        { calendarId }
      );
      if (ok) {
        toast.success("Calendario elegido.");
        setCalendars(null);
        router.refresh();
      } else {
        toast.error(payload.message ?? "No se pudo elegir el calendario.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setBusy("disconnect");
    try {
      const { ok, payload } = await post("/api/integrations/google-calendar/disconnect");
      if (ok) toast.success("Google Calendar desconectado.");
      else toast.error(payload.message ?? "No se pudo desconectar.");
      setDisconnectOpen(false);
      setCalendars(null);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const statusBadge = !data.planAccess
    ? {
        label: "Disponible desde Standard",
        className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        icon: CircleAlert,
      }
    : !data.configured
    ? {
        label: "Requiere configuración",
        className: "border-border bg-muted/40 text-muted-foreground",
        icon: CircleDashed,
      }
    : !data.connected
      ? {
          label: "No conectado",
          className: "border-border bg-muted/40 text-muted-foreground",
          icon: CircleOff,
        }
      : data.reconnectionRequired
        ? {
            label: "Reconexión requerida",
            className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
            icon: CircleAlert,
          }
      : data.status === "ERROR"
        ? {
            label: "Con error",
            className: "border-destructive/30 bg-destructive/10 text-destructive",
            icon: CircleAlert,
          }
        : {
            label: "Conectado",
            className:
              "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            icon: CircleCheck,
          };
  const StatusIcon = statusBadge.icon;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="size-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>Google Calendar</CardTitle>
              <CardDescription>
                Conexión y disponibilidad segura para los turnos de la organización.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={statusBadge.className}>
            <StatusIcon className="size-3.5" aria-hidden />
            {statusBadge.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!data.planAccess ? (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            {data.planMessage ??
              "Google Calendar está disponible desde el plan Standard."}
          </p>
        ) : !data.configured ? (
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            {data.configurationMessage ??
              "Google Calendar requiere completar la configuración del servidor."}
          </p>
        ) : data.connected ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Cuenta" value={data.googleEmail ?? "No disponible"} />
            <Detail
              label="Calendario elegido"
              value={data.selectedCalendarName ?? "Sin elegir"}
            />
            <Detail
              label="Última prueba"
              value={formatDate(data.lastTestedAt)}
            />
            <Detail
              label="Acceso"
              value={data.writeAccess ? "Gestión de turnos habilitada" : "Reconexión requerida"}
            />
          </dl>
        ) : (
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Conectá una cuenta de Google para elegir el calendario de trabajo y
            gestionar turnos.
          </p>
        )}

        {data.reconnectionRequired && (
          <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 text-xs leading-relaxed">
              Esta conexión conserva permisos de solo lectura. Reconectala para
              crear, reprogramar y cancelar turnos.
            </p>
          </div>
        )}

        {data.lastError && data.status === "ERROR" && (
          <div className="flex gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p className="min-w-0 break-words text-xs leading-relaxed">
              {data.lastError}
            </p>
          </div>
        )}

        {calendars && (
          <div className="space-y-2 rounded-lg border border-border/70 bg-background/40 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Elegí el calendario de trabajo
            </p>
            {calendars.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                La cuenta no tiene calendarios visibles.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto">
                {calendars.map((calendar) => (
                  <li key={calendar.id}>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => handleSelect(calendar.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                        calendar.id === data.selectedCalendarId &&
                          "bg-primary/10 text-foreground"
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {calendar.name}
                        {calendar.primary && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">
                            principal
                          </span>
                        )}
                      </span>
                      {calendar.id === data.selectedCalendarId && (
                        <Check className="size-4 shrink-0 text-primary" aria-hidden />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {showSettings && data.planAccess && (
          <div className="border-t border-border/70 pt-5">
            <GoogleCalendarAppointmentSettings canManage={canManage} />
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {canManage && !data.planAccess ? (
          data.connected ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={busy !== null}
              onClick={() => setDisconnectOpen(true)}
            >
              <Unplug className="size-4" aria-hidden />
              Desconectar
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/dashboard/planes">Ver planes</Link>
            </Button>
          )
        ) : canManage ? (
          data.connected ? (
            <>
              {!showSettings && (
                <Button asChild variant="secondary" size="sm">
                  <Link href="/dashboard/integraciones/google-calendar">
                    Administrar agenda
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={calendars ? () => setCalendars(null) : handleLoadCalendars}
              >
                {busy === "calendars" && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                {calendars ? "Ocultar calendarios" : "Elegir calendario"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={handleTest}
              >
                {busy === "test" ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <PlugZap className="size-4" aria-hidden />
                )}
                Probar conexión
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy !== null}
                onClick={handleConnect}
              >
                <RefreshCcw className="size-4" aria-hidden />
                Reconectar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive sm:ml-auto"
                disabled={busy !== null}
                onClick={() => setDisconnectOpen(true)}
              >
                <Unplug className="size-4" aria-hidden />
                Desconectar
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={handleConnect}
              >
                {busy === "connect" && (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                )}
                Conectar con Google
              </Button>
              {!showSettings && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/integraciones/google-calendar">
                    Ver configuración
                    <ArrowRight className="size-4" aria-hidden />
                  </Link>
                </Button>
              )}
            </>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            Solo el propietario o un administrador pueden gestionar esta
            integración.
          </p>
        )}
      </CardFooter>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desconectar Google Calendar</AlertDialogTitle>
            <AlertDialogDescription>
              Se revoca el acceso y se eliminan las credenciales guardadas. Vas
              a poder reconectar cuando quieras.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "disconnect"}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleDisconnect();
              }}
              disabled={busy === "disconnect"}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {busy === "disconnect" && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Desconectar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function UpcomingIntegrationCard({
  name,
  description,
  icon: Icon,
  status,
}: {
  name: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "En desarrollo" | "Próximamente";
}) {
  return (
    <Card className="min-w-0 border-dashed bg-card/65">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
            <Icon className="size-5" aria-hidden />
          </span>
          <Badge variant="outline" className="bg-muted/55 text-muted-foreground">
            {status}
          </Badge>
        </div>
        <CardTitle className="pt-2">{name}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Todavía no requiere configuración ni credenciales de tu parte.
        </p>
      </CardFooter>
    </Card>
  );
}

export function IntegrationsCenter({
  initialData,
  canManage,
}: {
  initialData: Pick<IntegrationsCenterView, "whatsapp" | "googleCalendar" | "googleSheets">;
  canManage: boolean;
}) {
  const searchParams = useSearchParams();
  const whatsappOperational = initialData.whatsapp.status === "connected";
  const googleOperational =
    initialData.googleCalendar.planAccess &&
    initialData.googleCalendar.connected &&
    !initialData.googleCalendar.reconnectionRequired &&
    initialData.googleCalendar.status !== "ERROR";
  const sheetsOperational =
    initialData.googleSheets.planAccess &&
    initialData.googleSheets.connected &&
    !initialData.googleSheets.reconnectionRequired &&
    initialData.googleSheets.spreadsheetSelected &&
    initialData.googleSheets.status !== "ERROR";
  const operationalCount = [whatsappOperational, googleOperational, sheetsOperational].filter(Boolean).length;

  useEffect(() => {
    const result = searchParams.get("google");
    const feedback = getGoogleCalendarOAuthFeedback(result);
    if (!result) return;
    if (feedback?.tone === "success") toast.success(feedback.message);
    else if (feedback?.tone === "info") toast.info(feedback.message);
    else if (feedback) toast.error(feedback.message);

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("google");
    window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  }, [searchParams]);

  return (
    <div className="space-y-7" aria-label="Integraciones de la organización">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Operativas</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{operationalCount}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Disponibles</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">3</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Requieren atención</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{3 - operationalCount}</p>
        </div>
      </div>

      {operationalCount > 0 && (
        <section className="space-y-3" aria-labelledby="integrations-operational">
          <div>
            <h3 id="integrations-operational" className="text-sm font-semibold">Conectadas y operativas</h3>
            <p className="mt-1 text-xs text-muted-foreground">Servicios listos para trabajar con esta organización.</p>
          </div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {whatsappOperational && <WhatsappCard data={initialData.whatsapp} canManage={canManage} />}
            {googleOperational && <GoogleCalendarCard data={initialData.googleCalendar} canManage={canManage} />}
            {sheetsOperational && <GoogleSheetsCard data={initialData.googleSheets} canManage={canManage} />}
          </div>
        </section>
      )}

      {operationalCount < 3 && (
        <section className="space-y-3" aria-labelledby="integrations-pending">
          <div>
            <h3 id="integrations-pending" className="text-sm font-semibold">Disponibles y pendientes</h3>
            <p className="mt-1 text-xs text-muted-foreground">Conectá o completá únicamente los servicios que necesita tu operación.</p>
          </div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {!whatsappOperational && <WhatsappCard data={initialData.whatsapp} canManage={canManage} />}
            {!googleOperational && <GoogleCalendarCard data={initialData.googleCalendar} canManage={canManage} />}
            {!sheetsOperational && <GoogleSheetsCard data={initialData.googleSheets} canManage={canManage} />}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="integrations-upcoming">
        <div>
          <h3 id="integrations-upcoming" className="text-sm font-semibold">
            Próximamente
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Integraciones en desarrollo que todavía no están disponibles para conectar.
          </p>
        </div>
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <UpcomingIntegrationCard
            name="Tiendanube"
            description="Catálogo y operación comercial conectados con tu tienda."
            icon={Store}
            status="En desarrollo"
          />
          <UpcomingIntegrationCard
            name="WooCommerce"
            description="Productos y pedidos conectados con tu operación en VantixApp."
            icon={ShoppingBag}
            status="Próximamente"
          />
        </div>
      </section>
    </div>
  );
}

export function GoogleCalendarIntegrationDetail({
  data,
  canManage,
}: {
  data: GoogleCalendarData;
  canManage: boolean;
}) {
  return <GoogleCalendarCard data={data} canManage={canManage} showSettings />;
}
