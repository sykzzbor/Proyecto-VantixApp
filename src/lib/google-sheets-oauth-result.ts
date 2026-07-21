export function getGoogleSheetsOAuthFeedback(result: string | null): {
  tone: "success" | "info" | "error";
  message: string;
} | null {
  const messages = {
    conectado: { tone: "success", message: "Google Sheets quedó conectado." },
    cancelado: { tone: "info", message: "Cancelaste la conexión con Google Sheets." },
    sesion_requerida: { tone: "error", message: "Volvé a iniciar sesión para conectar Google Sheets." },
    sin_permisos: { tone: "error", message: "No tenés permisos para conectar Google Sheets." },
    plan_requerido: { tone: "error", message: "Google Sheets está disponible desde Standard." },
    estado_invalido: { tone: "error", message: "La conexión venció. Volvé a intentarlo." },
    sin_refresh_token: { tone: "error", message: "Google no entregó acceso sin conexión. Volvé a autorizar." },
    error_oauth: { tone: "error", message: "Google no pudo completar la conexión." },
  } as const;
  return result && result in messages ? messages[result as keyof typeof messages] : null;
}
