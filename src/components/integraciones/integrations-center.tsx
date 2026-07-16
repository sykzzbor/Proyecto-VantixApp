"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bot,
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
  Unplug,
  Workflow,
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
import { cn } from "@/lib/utils";
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

        <DiagnosticList diagnostic={data.diagnostics} />
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

const N8N_STATUS = {
  mock: {
    label: "Modo de prueba",
    className: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300",
  },
  incomplete: {
    label: "Configuración incompleta",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  ready: {
    label: "Listo para activar",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  operational: {
    label: "Operativo",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  error: {
    label: "Con error",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
} as const;

const N8N_ACTIVATION_STEPS = [
  "Publicar los subworkflows.",
  "Publicar el router.",
  "Obtener el webhook de producción.",
  "Configurar las firmas en ambos sistemas.",
  "Ejecutar una prueba firmada.",
  "Confirmar el callback.",
  "Cambiar el proveedor.",
  "Probar una derivación humana.",
  "Probar un seguimiento automático.",
] as const;

function N8nCard({
  data,
  canManage,
}: {
  data: IntegrationsCenterView["n8n"];
  canManage: boolean;
}) {
  const router = useRouter();
  const [testing, setTesting] = useState(false);
  const status = N8N_STATUS[data.status];
  const canTest =
    data.endpointConfigured &&
    data.outboundSignatureConfigured &&
    data.callbackConfigured &&
    data.dispatcherConfigured &&
    data.workflowsPublished;

  async function waitForProbe(eventId: string) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
      }
      const response = await fetch(`/api/automation/events/${eventId}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) continue;
      const body = (await readJson(response)) as {
        event?: { status?: string };
      };
      const eventStatus = body.event?.status;
      if (eventStatus === "SUCCEEDED") {
        toast.success("Conexión verificada mediante callback firmado.");
        router.refresh();
        return;
      }
      if (
        eventStatus === "FAILED" ||
        eventStatus === "DEAD_LETTER" ||
        eventStatus === "CANCELLED"
      ) {
        toast.error("La prueba no recibió una confirmación válida.");
        router.refresh();
        return;
      }
    }
    toast.info(
      "La prueba sigue esperando el callback. Podés actualizar el panel más tarde."
    );
    router.refresh();
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await postAction("/api/automation/test-connection");
      if (typeof result.eventId !== "string") {
        throw new Error("No se pudo crear la prueba de conexión.");
      }
      toast.info(
        "Prueba enviada. La conexión se confirmará únicamente cuando llegue el callback firmado."
      );
      await waitForProbe(result.eventId);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo probar la conexión."
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-300">
              <Workflow className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>n8n</CardTitle>
              <CardDescription>
                Orquestación firmada para derivaciones y seguimientos.
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className={status.className}>
            {data.status === "error" ? (
              <CircleAlert aria-hidden />
            ) : data.status === "operational" ? (
              <CircleCheck aria-hidden />
            ) : (
              <Bot aria-hidden />
            )}
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-sm leading-relaxed">
          <p className="font-medium">
            Proveedor activo: {data.provider === "mock" ? "modo de prueba" : "n8n"}
          </p>
          {data.provider === "mock" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Los eventos reales todavía no se envían a n8n. La prueba controlada
              no cambia este estado.
            </p>
          )}
        </div>

        {data.lastConnectionAt || data.lastEventSentAt || data.lastCallbackAt ? (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail
              label="Última conexión"
              value={formatDate(data.lastConnectionAt)}
            />
            <Detail
              label="Último evento enviado"
              value={formatDate(data.lastEventSentAt)}
            />
            <Detail
              label="Último callback"
              value={formatDate(data.lastCallbackAt)}
            />
            <Detail
              label="Workflows"
              value={data.workflowsPublished ? "Publicados" : "Pendientes de publicar"}
            />
            <Detail
              label="Router y callback"
              value={data.connectionTestVerified ? "Verificados" : "Pendientes de probar"}
            />
          </dl>
        ) : (
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Todavía no hubo actividad con n8n. Cuando la conexión esté activa,
            acá vas a ver los últimos eventos y callbacks.
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

        <DiagnosticList diagnostic={data.diagnostics} />

        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            <p className="text-sm font-semibold">Checklist de activación</p>
          </div>
          <ol className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {N8N_ACTIVATION_STEPS.map((step, index) => (
              <li key={step} className="flex min-w-0 items-start gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {index + 1}
                </span>
                <span className="pt-0.5 leading-relaxed">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
        {canManage ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={testConnection}
              disabled={!canTest || testing}
              title={
                canTest
                  ? "La prueba mantiene el proveedor en modo mock"
                  : "Completá la preparación técnica antes de probar"
              }
            >
              {testing ? (
                <Loader2 className="animate-spin" aria-hidden />
              ) : (
                <PlugZap aria-hidden />
              )}
              Probar conexión
            </Button>
            <p className="text-xs text-muted-foreground">
              Activación manual bloqueada hasta completar todos los pasos.
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Vista de solo lectura. Un propietario o administrador puede ejecutar
            pruebas.
          </p>
        )}
      </CardFooter>
    </Card>
  );
}

type GoogleCalendarData = IntegrationsCenterView["googleCalendar"];

function GoogleCalendarCard({
  data,
  canManage,
}: {
  data: GoogleCalendarData;
  canManage: boolean;
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

  const statusBadge = !data.configured
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
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-[#8eacff]">
              <CalendarDays className="size-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <CardTitle>Google Calendar</CardTitle>
              <CardDescription>
                Base para agendar turnos desde las conversaciones (próxima etapa).
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
        {!data.configured ? (
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Falta configurar las credenciales de Google en el servidor. Ver{" "}
            <span className="font-medium text-foreground">
              docs/GOOGLE_CALENDAR_SETUP.md
            </span>
            .
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
            <Detail label="Acceso" value="Solo lectura de calendarios" />
          </dl>
        ) : (
          <p className="rounded-lg border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Conectá una cuenta de Google para elegir el calendario de trabajo.
            Los permisos de escritura para turnos se pedirán en la próxima
            etapa.
          </p>
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
                        <Check className="size-4 shrink-0 text-[#8eacff]" aria-hidden />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {canManage ? (
          data.connected ? (
            <>
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
            <Button
              size="sm"
              disabled={busy !== null || !data.configured}
              onClick={handleConnect}
            >
              {busy === "connect" && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Conectar con Google
            </Button>
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

export function IntegrationsCenter({
  initialData,
  canManage,
}: {
  initialData: IntegrationsCenterView;
  canManage: boolean;
}) {
  return (
    <section
      className="grid min-w-0 gap-5 xl:grid-cols-2"
      aria-label="Integraciones de la organización"
    >
      <WhatsappCard data={initialData.whatsapp} canManage={canManage} />
      <N8nCard data={initialData.n8n} canManage={canManage} />
      <GoogleCalendarCard data={initialData.googleCalendar} canManage={canManage} />
    </section>
  );
}
