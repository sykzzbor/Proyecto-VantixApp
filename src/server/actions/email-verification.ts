"use server";

import { headers } from "next/headers";
import { z } from "zod";
import {
  findUserPendingVerification,
  sendEmailVerification,
} from "@/server/auth/email-verification";
import { consumeThrottle, peekThrottle } from "@/server/auth/throttle";
import { clientIpKey } from "@/server/auth/request-ip";
import { RESEND_COOLDOWN_SECONDS } from "@/server/auth/verification-token";

/**
 * Reenvío del correo de verificación.
 *
 * La respuesta es SIEMPRE la misma, exista o no la cuenta y esté o no ya
 * verificada. Si dijera "no encontramos esa dirección", la pantalla se
 * convertiría en un buscador de cuentas registradas.
 */

const resendSchema = z.object({
  email: z.email().max(320),
});

export type ResendVerificationResult = {
  /** Mensaje genérico para mostrar. Nunca distingue casos. */
  message: string;
  /** Segundos que faltan para poder reintentar, si se agotó el cupo. */
  retryAfterSeconds: number | null;
};

const GENERIC_MESSAGE =
  "Si esa dirección tiene una cuenta sin verificar, te enviamos un enlace nuevo. Revisá tu bandeja y la carpeta de spam.";

export async function resendVerificationEmail(
  input: unknown
): Promise<ResendVerificationResult> {
  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) {
    // Ni siquiera un correo mal formado cambia el mensaje.
    return { message: GENERIC_MESSAGE, retryAfterSeconds: null };
  }
  const email = parsed.data.email.toLowerCase();
  const requestHeaders = await headers();

  // Dos cupos: por IP frena a quien barre direcciones ajenas; por correo
  // frena a quien bombardea una sola casilla desde muchas IP.
  const byIp = await consumeThrottle("verification-resend-ip", clientIpKey(requestHeaders));
  if (!byIp.allowed) {
    return {
      message: "Demasiados intentos. Esperá unos minutos antes de volver a pedirlo.",
      retryAfterSeconds: byIp.retryAfterSeconds,
    };
  }

  const byEmail = await consumeThrottle("verification-resend-email", email);
  if (!byEmail.allowed) {
    return {
      message: "Demasiados intentos. Esperá unos minutos antes de volver a pedirlo.",
      retryAfterSeconds: byEmail.retryAfterSeconds,
    };
  }

  const user = await findUserPendingVerification(email);
  if (user) {
    await sendEmailVerification({
      userId: user.id,
      email: user.email,
      name: user.name,
      isResend: true,
    });
  }

  return { message: GENERIC_MESSAGE, retryAfterSeconds: RESEND_COOLDOWN_SECONDS };
}

/** Cuánto falta para el próximo reenvío, para pintar el cooldown al cargar. */
export async function getResendCooldown(email: string): Promise<number | null> {
  const parsed = resendSchema.safeParse({ email });
  if (!parsed.success) return null;

  const decision = await peekThrottle(
    "verification-resend-email",
    parsed.data.email.toLowerCase()
  );
  return decision.allowed ? null : decision.retryAfterSeconds;
}
