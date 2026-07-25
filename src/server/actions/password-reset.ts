"use server";

import { headers } from "next/headers";
import { consumeThrottle } from "@/server/auth/throttle";
import { clientIpKey } from "@/server/auth/request-ip";

/**
 * Cupo por IP **y por correo** para "olvidé mi contraseña".
 *
 * Better Auth ya limita por IP el endpoint `/request-password-reset`, pero no
 * por destinatario: sin este chequeo, alguien con muchas IP puede llenar de
 * correos la casilla de una persona concreta.
 *
 * Devuelve solo si se puede seguir. Nunca dice si la cuenta existe: eso lo
 * resuelve Better Auth, que responde igual en los dos casos.
 */
export async function checkPasswordResetQuota(
  email: string
): Promise<{ allowed: boolean; retryAfterSeconds: number | null }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) {
    return { allowed: false, retryAfterSeconds: null };
  }

  const requestHeaders = await headers();

  const byIp = await consumeThrottle("password-reset-ip", clientIpKey(requestHeaders));
  if (!byIp.allowed) {
    return { allowed: false, retryAfterSeconds: byIp.retryAfterSeconds };
  }

  const byEmail = await consumeThrottle("password-reset-email", normalized);
  if (!byEmail.allowed) {
    return { allowed: false, retryAfterSeconds: byEmail.retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: null };
}
