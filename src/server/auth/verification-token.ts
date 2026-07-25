import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Tokens de verificación de correo emitidos por VantixApp.
 *
 * Better Auth firma un JWT sin estado: sirve tantas veces como quieras hasta
 * que vence, y emitir uno nuevo no invalida el anterior. Estas funciones
 * aportan lo que falta —aleatoriedad, un único uso y revocación de los
 * anteriores— sobre `EmailVerificationToken`.
 *
 * La lógica es pura y recibe sus dependencias por parámetro para poder
 * probarla sin base de datos; el cableado a Prisma vive en `email-verification.ts`.
 */

/** 32 bytes de entropía: el mismo orden que un token de sesión. */
const TOKEN_BYTES = 32;

export const EMAIL_VERIFICATION_TTL_MINUTES = 30;
export const EMAIL_VERIFICATION_TTL_MS = EMAIL_VERIFICATION_TTL_MINUTES * 60 * 1000;

/** Cooldown entre reenvíos, visible en la pantalla "Revisá tu correo". */
export const RESEND_COOLDOWN_SECONDS = 60;

export function generateVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Solo se persiste el hash. Si alguien lee la base no puede verificar correos
 * ajenos, igual que con las contraseñas.
 *
 * SHA-256 sin sal alcanza: el token tiene 256 bits de entropía, así que no hay
 * diccionario que atacar (a diferencia de una contraseña elegida por una persona).
 */
export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparación en tiempo constante de dos hashes hexadecimales. */
export function verificationHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type StoredVerificationToken = {
  id: string;
  userId: string;
  email: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export type VerificationTokenRejection =
  | "invalid"
  | "expired"
  | "already_used"
  | "email_changed";

export type VerificationTokenDecision =
  | { ok: true; userId: string; email: string }
  | { ok: false; reason: VerificationTokenRejection };

/**
 * Decide si un token guardado puede consumirse. Se separa del acceso a la base
 * para poder cubrir vencido / reutilizado / correo cambiado con tests puros.
 *
 * `currentEmail` es el correo que el usuario tiene *hoy*: si cambió después de
 * pedir el enlace, el token verificaría una dirección que ya no le pertenece.
 */
export function decideVerificationToken(input: {
  stored: StoredVerificationToken | null;
  currentEmail: string | null;
  now: Date;
}): VerificationTokenDecision {
  const { stored, currentEmail, now } = input;
  if (!stored) return { ok: false, reason: "invalid" };
  if (stored.consumedAt !== null) return { ok: false, reason: "already_used" };
  if (stored.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (
    currentEmail === null ||
    currentEmail.toLowerCase() !== stored.email.toLowerCase()
  ) {
    return { ok: false, reason: "email_changed" };
  }
  return { ok: true, userId: stored.userId, email: stored.email };
}

/** Mensaje para la pantalla de error. No distingue casos que revelen datos. */
export function verificationRejectionMessage(
  reason: VerificationTokenRejection
): string {
  if (reason === "already_used") {
    return "Este enlace ya se usó. Si todavía no podés entrar, pedí uno nuevo desde la pantalla de inicio de sesión.";
  }
  if (reason === "expired") {
    return "El enlace venció. Pedí uno nuevo y verificá tu correo dentro de los 30 minutos.";
  }
  return "El enlace no es válido. Pedí uno nuevo desde la pantalla de inicio de sesión.";
}
