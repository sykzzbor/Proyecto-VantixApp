export type GoogleCalendarOAuthFeedback = {
  tone: "success" | "error" | "info";
  message: string;
};

const GOOGLE_CALENDAR_OAUTH_FEEDBACK: Record<
  string,
  GoogleCalendarOAuthFeedback
> = {
  conectado: {
    tone: "success",
    message: "Google Calendar quedó conectado correctamente.",
  },
  cancelado: {
    tone: "info",
    message: "La conexión con Google fue cancelada.",
  },
  sesion_requerida: {
    tone: "error",
    message: "Volvé a iniciar sesión para conectar Google Calendar.",
  },
  sin_permisos: {
    tone: "error",
    message: "No tenés permisos para gestionar esta integración.",
  },
  suscripcion_requerida: {
    tone: "error",
    message: "Necesitás una suscripción activa para conectar Google Calendar.",
  },
  plan_requerido: {
    tone: "error",
    message: "Google Calendar está disponible desde el plan Standard.",
  },
  estado_invalido: {
    tone: "error",
    message: "La autorización venció o ya fue utilizada. Intentá conectar nuevamente.",
  },
  sin_refresh_token: {
    tone: "error",
    message: "Google no entregó autorización renovable. Intentá reconectar la cuenta.",
  },
  error_oauth: {
    tone: "error",
    message: "Google no pudo completar la autorización. Intentá nuevamente.",
  },
};

/** Traduce exclusivamente códigos conocidos; nunca muestra parámetros externos. */
export function getGoogleCalendarOAuthFeedback(
  result: string | null | undefined
): GoogleCalendarOAuthFeedback | null {
  if (!result) return null;
  return GOOGLE_CALENDAR_OAUTH_FEEDBACK[result] ?? null;
}
