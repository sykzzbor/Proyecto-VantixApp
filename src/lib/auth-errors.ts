/**
 * Traduce los códigos de error de Better Auth a mensajes en español
 * aptos para mostrar al usuario final.
 */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "Email o contraseña incorrectos.",
  USER_ALREADY_EXISTS: "Ya existe una cuenta con ese email.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Ya existe una cuenta con ese email.",
  INVALID_TOKEN: "El enlace expiró o no es válido. Pedí uno nuevo.",
  PASSWORD_TOO_SHORT: "La contraseña debe tener al menos 10 caracteres.",
  PASSWORD_TOO_WEAK:
    "Esa contraseña es fácil de adivinar. Combiná letras y al menos un número o símbolo.",
  PASSWORD_TOO_LONG: "La contraseña es demasiado larga.",
  INVALID_PASSWORD: "La contraseña actual no es correcta.",
  USER_NOT_FOUND: "No encontramos una cuenta con esos datos.",
  FAILED_TO_CREATE_USER: "No se pudo crear la cuenta. Intentá de nuevo.",
  FAILED_TO_CREATE_SESSION: "No se pudo iniciar sesión. Intentá de nuevo.",
  EMAIL_NOT_VERIFIED: "Tu email todavía no fue verificado.",
  PROVIDER_NOT_FOUND: "El acceso con Google no está configurado en este entorno.",
  INVALID_CALLBACK_REQUEST:
    "La respuesta de Google no es válida o venció. Intentá de nuevo.",
  OAUTH_LINK_ERROR:
    "No se pudo vincular esta cuenta de forma segura. Iniciá sesión con tu método habitual.",
  EMAIL_DOESN_T_MATCH:
    "La cuenta de Google no coincide con el email de tu cuenta.",
};

export function translateAuthError(
  error: { code?: string | undefined; message?: string | undefined } | null
): string {
  const code = error?.code?.trim().toUpperCase().replaceAll("'", "_");
  if (code && AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
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
