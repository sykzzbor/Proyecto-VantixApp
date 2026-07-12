/**
 * Traduce los códigos de error de Better Auth a mensajes en español
 * aptos para mostrar al usuario final.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email o contraseña incorrectos.",
  USER_ALREADY_EXISTS: "Ya existe una cuenta con ese email.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Ya existe una cuenta con ese email.",
  INVALID_TOKEN: "El enlace expiró o no es válido. Pedí uno nuevo.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 8 caracteres.",
  PASSWORD_TOO_LONG: "La contraseña es demasiado larga.",
  INVALID_PASSWORD: "La contraseña actual no es correcta.",
  USER_NOT_FOUND: "No encontramos una cuenta con esos datos.",
  FAILED_TO_CREATE_USER: "No se pudo crear la cuenta. Intentá de nuevo.",
  FAILED_TO_CREATE_SESSION: "No se pudo iniciar sesión. Intentá de nuevo.",
  EMAIL_NOT_VERIFIED: "Tu email todavía no fue verificado.",
};

export function translateAuthError(
  error: { code?: string | undefined; message?: string | undefined } | null
): string {
  if (error?.code && AUTH_ERROR_MESSAGES[error.code]) {
    return AUTH_ERROR_MESSAGES[error.code];
  }
  return "No se pudo completar la operación. Intentá de nuevo.";
}

/** Evita open redirects: solo acepta rutas internas. */
export function safeCallbackUrl(
  url: string | undefined | null,
  fallback = "/dashboard"
): string {
  if (url && url.startsWith("/") && !url.startsWith("//")) return url;
  return fallback;
}
