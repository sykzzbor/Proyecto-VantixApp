/**
 * Política de contraseñas.
 *
 * Se aplica en el servidor (hook de Better Auth) y también en el cliente, con
 * el mismo módulo, para que el formulario avise antes de enviar. El chequeo del
 * cliente es comodidad; el que manda es el del servidor.
 */

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Contraseñas que aparecen primero en cualquier lista de fuerza bruta. No
 * pretende reemplazar a una base tipo HIBP: corta lo obvio sin pedir una
 * llamada externa en el camino del registro.
 */
const COMMON_PASSWORDS = new Set([
  "contrasena",
  "contraseña",
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "qwertyuiop",
  "qwerty123",
  "iloveyou",
  "administrator",
  "letmein123",
  "welcome123",
  "abc12345",
  "vantixapp",
  "vantix123",
]);

export type PasswordIssue =
  | "too_short"
  | "too_long"
  | "needs_variety"
  | "too_common"
  | "contains_email";

export const PASSWORD_ISSUE_MESSAGES: Record<PasswordIssue, string> = {
  too_short: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  too_long: "La contraseña es demasiado larga.",
  needs_variety:
    "Combiná letras y al menos un número o símbolo.",
  too_common: "Esa contraseña es demasiado común. Elegí otra.",
  contains_email: "La contraseña no puede contener tu correo.",
};

export const PASSWORD_HINT = `Mínimo ${MIN_PASSWORD_LENGTH} caracteres, con letras y al menos un número o símbolo.`;

function normalize(password: string): string {
  return password.toLowerCase().replace(/[^a-z0-9áéíóúñ]/g, "");
}

/**
 * Devuelve el primer problema encontrado, o `null` si la contraseña sirve.
 * `email` es opcional: cuando está, evita que alguien use su propia dirección.
 */
export function findPasswordIssue(
  password: string,
  email?: string | null
): PasswordIssue | null {
  if (password.length < MIN_PASSWORD_LENGTH) return "too_short";
  if (password.length > MAX_PASSWORD_LENGTH) return "too_long";

  const hasLetter = /\p{L}/u.test(password);
  const hasNonLetter = /[^\p{L}]/u.test(password);
  if (!hasLetter || !hasNonLetter) return "needs_variety";

  const normalized = normalize(password);
  if (COMMON_PASSWORDS.has(normalized)) return "too_common";

  // Una sola letra o dígito repetido pasa el chequeo de variedad
  // ("aaaaaaaaa1"), así que se descarta aparte.
  if (new Set(normalized).size <= 3) return "too_common";

  const localPart = email?.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 3 && normalized.includes(normalize(localPart))) {
    return "contains_email";
  }

  return null;
}

export function validatePassword(
  password: string,
  email?: string | null
): { ok: true } | { ok: false; issue: PasswordIssue; message: string } {
  const issue = findPasswordIssue(password, email);
  if (!issue) return { ok: true };
  return { ok: false, issue, message: PASSWORD_ISSUE_MESSAGES[issue] };
}
