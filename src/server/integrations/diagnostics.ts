import { prisma } from "@/lib/prisma";
import { getAutomationInfrastructureStatus } from "@/server/automation/dashboard";
import { sanitizeAutomationMessage } from "@/server/automation/sanitization";
import {
  getMetaEmbeddedSignupPublicConfiguration,
  isYCloudWebhookRuntimeConfigured,
  isWhatsappWebhookRuntimeConfigured,
} from "@/server/whatsapp/config";
import { resolveCurrentWhatsappIntegration } from "@/server/whatsapp/current-integration";
import {
  getGoogleCalendarView,
  type GoogleCalendarView,
} from "@/server/integrations/google-calendar/service";

const REQUIRED_WHATSAPP_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
] as const;

export type SafeDiagnosticStep = {
  code: string;
  label: string;
  description: string;
  ready: boolean;
};

export type SafeDiagnostic = {
  state: "pending" | "ready" | "operational" | "error";
  missingCount: number;
  steps: SafeDiagnosticStep[];
};

export type WhatsappCenterStatus =
  | "not_connected"
  | "meta_configuration_pending"
  | "connecting"
  | "action_required"
  | "connected"
  | "error"
  | "disconnected";

export type IntegrationsCenterView = {
  whatsapp: {
    status: WhatsappCenterStatus;
    configurationAvailable: boolean;
    resumeAvailable: boolean;
    lastError: string | null;
    integration: null | {
      provider: "META_CLOUD" | "YCLOUD";
      connectionMethod: "MANUAL" | "EMBEDDED_SIGNUP" | "COEXISTENCE";
      maskedPhoneNumber: string;
      verifiedName: string;
      connectedAt: string | null;
      lastSyncedAt: string | null;
      lastWebhookAt: string | null;
      lastError: string | null;
    };
    diagnostics: SafeDiagnostic;
  };
  n8n: {
    provider: "mock" | "n8n";
    status: "mock" | "incomplete" | "ready" | "operational" | "error";
    endpointConfigured: boolean;
    outboundSignatureConfigured: boolean;
    callbackConfigured: boolean;
    dispatcherConfigured: boolean;
    workflowsPublished: boolean;
    connectionTestVerified: boolean;
    lastConnectionAt: string | null;
    lastEventSentAt: string | null;
    lastCallbackAt: string | null;
    lastError: string | null;
    diagnostics: SafeDiagnostic;
  };
  googleCalendar: GoogleCalendarView;
};

function maskPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "No disponible";
  const visible = digits.slice(-4);
  return `•••• ${visible}`;
}

function iso(value: Date | null | undefined): string | null {
  return value?.toISOString() ?? null;
}

function diagnosticState(
  steps: SafeDiagnosticStep[],
  options: { error?: boolean; active?: boolean } = {}
): SafeDiagnostic["state"] {
  if (options.error) return "error";
  if (steps.some((step) => !step.ready)) return "pending";
  return options.active ? "operational" : "ready";
}

function buildDiagnostic(
  steps: SafeDiagnosticStep[],
  options?: { error?: boolean; active?: boolean }
): SafeDiagnostic {
  return {
    state: diagnosticState(steps, options),
    missingCount: steps.filter((step) => !step.ready).length,
    steps,
  };
}

export function buildWhatsappDiagnostic(input: {
  metaApplication: boolean;
  embeddedSignupConfiguration: boolean;
  permissions: boolean;
  numberConnected: boolean;
  webhook: boolean;
  error?: boolean;
}): SafeDiagnostic {
  const steps: SafeDiagnosticStep[] = [
    {
      code: "meta_application",
      label: "Aplicación de Meta",
      description: input.metaApplication
        ? "La aplicación está preparada en el servidor."
        : "Falta completar la aplicación de Meta.",
      ready: input.metaApplication,
    },
    {
      code: "embedded_signup_configuration",
      label: "Configuración de conexión",
      description: input.embeddedSignupConfiguration
        ? "El flujo oficial de conexión está disponible."
        : "Falta preparar el flujo oficial de conexión.",
      ready: input.embeddedSignupConfiguration,
    },
    {
      code: "permissions",
      label: "Permisos de WhatsApp",
      description: input.permissions
        ? "Los permisos necesarios fueron verificados."
        : "Los permisos se verificarán al conectar el número.",
      ready: input.permissions,
    },
    {
      code: "phone_number",
      label: "Número conectado",
      description: input.numberConnected
        ? "Hay un número operativo para esta organización."
        : "Todavía no hay un número operativo.",
      ready: input.numberConnected,
    },
    {
      code: "webhook",
      label: "Webhook",
      description: input.webhook
        ? "La recepción de eventos está preparada."
        : "La recepción de eventos todavía no está preparada.",
      ready: input.webhook,
    },
  ];
  return buildDiagnostic(steps, {
    error: input.error,
    active: input.numberConnected && input.webhook,
  });
}

export function buildYCloudDiagnostic(input: {
  credentials: boolean;
  numberConnected: boolean;
  webhook: boolean;
  error?: boolean;
}): SafeDiagnostic {
  const steps: SafeDiagnosticStep[] = [
    {
      code: "ycloud_access",
      label: "Acceso a YCloud",
      description: input.credentials
        ? "El acceso y el canal fueron verificados por YCloud."
        : "Falta conectar y validar el canal de YCloud.",
      ready: input.credentials,
    },
    {
      code: "phone_number",
      label: "Número Coexistence",
      description: input.numberConnected
        ? "El número está conectado y operativo."
        : "Todavía no hay un número Coexistence operativo.",
      ready: input.numberConnected,
    },
    {
      code: "webhook",
      label: "Webhook de YCloud",
      description: input.webhook
        ? "VantixApp recibió eventos firmados de YCloud."
        : "Falta confirmar la recepción de un evento firmado de YCloud.",
      ready: input.webhook,
    },
  ];
  return buildDiagnostic(steps, {
    error: input.error,
    active: input.numberConnected && input.webhook,
  });
}

export function buildN8nDiagnostic(input: {
  endpoint: boolean;
  outboundSignature: boolean;
  callbackSignature: boolean;
  dispatcher: boolean;
  workflowsPublished: boolean;
  connectionTest: boolean;
  providerActive: boolean;
  error?: boolean;
}): SafeDiagnostic {
  const steps: SafeDiagnosticStep[] = [
    {
      code: "endpoint",
      label: "Endpoint",
      description: input.endpoint
        ? "El destino de automatizaciones está preparado."
        : "Falta preparar el destino de automatizaciones.",
      ready: input.endpoint,
    },
    {
      code: "outbound_signature",
      label: "Firma de salida",
      description: input.outboundSignature
        ? "La firma de eventos está preparada."
        : "Falta preparar la firma de eventos.",
      ready: input.outboundSignature,
    },
    {
      code: "callback_signature",
      label: "Callback",
      description: input.callbackSignature
        ? "La validación de callbacks está preparada."
        : "Falta preparar la validación de callbacks.",
      ready: input.callbackSignature,
    },
    {
      code: "dispatcher",
      label: "Dispatcher",
      description: input.dispatcher
        ? "El procesamiento programado está preparado."
        : "Falta habilitar el procesamiento programado.",
      ready: input.dispatcher,
    },
    {
      code: "workflows",
      label: "Workflows",
      description: input.workflowsPublished
        ? "La publicación fue confirmada de forma explícita."
        : "Los workflows siguen pendientes de publicar.",
      ready: input.workflowsPublished,
    },
    {
      code: "connection_test",
      label: "Router y callback",
      description: input.connectionTest
        ? "La prueba firmada recibió su callback correctamente."
        : "Falta ejecutar y confirmar la prueba firmada.",
      ready: input.connectionTest,
    },
  ];
  return buildDiagnostic(steps, {
    error: input.error,
    active: input.providerActive,
  });
}

function resolveWhatsappStatus(input: {
  configurationAvailable: boolean;
  integrationStatus: string | null;
  attemptStatus: string | null;
}): WhatsappCenterStatus {
  if (input.attemptStatus === "PROCESSING" || input.attemptStatus === "AWAITING_CODE") {
    return "connecting";
  }
  if (input.integrationStatus === "CONNECTED") return "connected";
  if (input.integrationStatus === "ERROR") return "error";
  if (input.integrationStatus === "ACTION_REQUIRED" || input.attemptStatus === "FAILED") {
    return "action_required";
  }
  if (input.integrationStatus === "DISCONNECTED") return "disconnected";
  if (!input.configurationAvailable) return "meta_configuration_pending";
  return "not_connected";
}

function signupAttemptErrorMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    configuration_pending: "La configuración externa de Meta está pendiente.",
    invalid_signup_state: "La sesión de conexión venció. Volvé a intentarlo.",
    invalid_code: "Meta no aceptó el código temporal. Volvé a intentarlo.",
    permissions_pending: "Meta todavía no otorgó todos los permisos necesarios.",
    asset_ambiguous:
      "Meta informó más de una opción y requiere una selección inequívoca.",
    number_already_connected:
      "Ese número ya está conectado a otra organización.",
    connection_unavailable:
      "Meta no pudo completar la conexión en este momento.",
    webhook_pending: "La recepción de eventos todavía está pendiente.",
  };
  return messages[code] ?? "La conexión requiere revisión.";
}

export async function getIntegrationsCenterView(
  organizationId: string
): Promise<IntegrationsCenterView> {
  const metaConfiguration = getMetaEmbeddedSignupPublicConfiguration();
  const [whatsappResolution, attempt, automation, googleCalendar] =
    await Promise.all([
      resolveCurrentWhatsappIntegration(organizationId),
      prisma.whatsappEmbeddedSignupAttempt.findUnique({
        where: { organizationId },
        select: { status: true, expiresAt: true, lastErrorCode: true },
      }),
      getAutomationInfrastructureStatus(organizationId),
      getGoogleCalendarView(organizationId),
    ]);
  const integration = whatsappResolution.state === "current"
    ? await prisma.whatsappIntegration.findFirst({
        where: { id: whatsappResolution.id, organizationId },
        select: {
          status: true,
          provider: true,
          connectionMethod: true,
          displayPhoneNumber: true,
          verifiedName: true,
          grantedScopes: true,
          connectedAt: true,
          lastSyncedAt: true,
          lastWebhookAt: true,
          webhookSubscribedAt: true,
          lastError: true,
        },
      })
    : null;

  const connected = integration?.status === "CONNECTED";
  const activeAttempt =
    attempt && attempt.expiresAt.getTime() > Date.now() ? attempt : null;
  const manualCompatibility =
    integration?.connectionMethod === "MANUAL" && connected;
  const permissions =
    (integration?.provider === "YCLOUD" && connected) ||
    manualCompatibility ||
    REQUIRED_WHATSAPP_SCOPES.every((scope) =>
      integration?.grantedScopes.includes(scope)
    );
  const ycloud = integration?.provider === "YCLOUD";
  const webhook = ycloud
    ? isYCloudWebhookRuntimeConfigured() && Boolean(integration?.lastWebhookAt)
    : isWhatsappWebhookRuntimeConfigured() &&
      Boolean(integration?.webhookSubscribedAt || integration?.lastWebhookAt);
  const hasError =
    integration?.status === "ERROR" || whatsappResolution.state === "ambiguous";
  const whatsappDiagnostics = ycloud
    ? buildYCloudDiagnostic({
        credentials: connected,
        numberConnected: connected,
        webhook,
        error: hasError,
      })
    : buildWhatsappDiagnostic({
        metaApplication: !metaConfiguration.missingCategories.includes(
          "meta_application"
        ),
        embeddedSignupConfiguration:
          !metaConfiguration.missingCategories.includes(
            "embedded_signup_configuration"
          ),
        permissions,
        numberConnected: connected,
        webhook,
        error: hasError,
      });

  const workflowsPublished = automation.workflowsPublished;
  const connectionTestVerified = automation.probeVerified;
  const n8nDiagnostics = buildN8nDiagnostic({
    endpoint: automation.endpointConfigured,
    outboundSignature: automation.outboundSignatureConfigured,
    callbackSignature: automation.callbackConfigured,
    dispatcher: automation.dispatcherConfigured,
    workflowsPublished,
    connectionTest: connectionTestVerified,
    providerActive: automation.provider === "n8n",
    error: automation.connectionStatus === "ERROR",
  });
  const n8nStatus =
    automation.connectionStatus === "ERROR"
      ? "error"
      : automation.provider === "mock"
        ? "mock"
        : n8nDiagnostics.missingCount > 0
          ? "incomplete"
          : n8nDiagnostics.state === "operational"
            ? "operational"
            : "ready";

  return {
    whatsapp: {
      status: resolveWhatsappStatus({
        configurationAvailable: metaConfiguration.available,
        integrationStatus:
          whatsappResolution.state === "ambiguous"
            ? "ACTION_REQUIRED"
            : integration?.status ?? null,
        attemptStatus: activeAttempt?.status ?? null,
      }),
      configurationAvailable: metaConfiguration.available,
      resumeAvailable: activeAttempt?.status === "AWAITING_CODE",
      lastError:
        (whatsappResolution.state === "ambiguous"
          ? "La conexión requiere revisión antes de continuar."
          : sanitizeAutomationMessage(integration?.lastError ?? null)) ??
        (activeAttempt?.status === "FAILED"
          ? signupAttemptErrorMessage(activeAttempt.lastErrorCode)
          : null),
      integration: integration
        ? {
            provider: integration.provider,
            connectionMethod: integration.connectionMethod,
            maskedPhoneNumber: maskPhoneNumber(
              integration.displayPhoneNumber
            ),
            verifiedName: integration.verifiedName,
            connectedAt: iso(integration.connectedAt),
            lastSyncedAt: iso(integration.lastSyncedAt),
            lastWebhookAt: iso(integration.lastWebhookAt),
            lastError: sanitizeAutomationMessage(integration.lastError),
          }
        : null,
      diagnostics: whatsappDiagnostics,
    },
    n8n: {
      provider: automation.provider,
      status: n8nStatus,
      endpointConfigured: automation.endpointConfigured,
      outboundSignatureConfigured: automation.outboundSignatureConfigured,
      callbackConfigured: automation.callbackConfigured,
      dispatcherConfigured: automation.dispatcherConfigured,
      workflowsPublished,
      connectionTestVerified,
      lastConnectionAt: automation.lastConnectionAt,
      lastEventSentAt: automation.lastEventSentAt,
      lastCallbackAt: automation.lastCallbackAt,
      lastError: sanitizeAutomationMessage(automation.lastError),
      diagnostics: n8nDiagnostics,
    },
    googleCalendar,
  };
}
