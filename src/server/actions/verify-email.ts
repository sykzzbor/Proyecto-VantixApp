"use server";

import { headers } from "next/headers";
import { consumeEmailVerificationToken } from "@/server/auth/email-verification";
import { verificationRejectionMessage } from "@/server/auth/verification-token";
import { consumeThrottle } from "@/server/auth/throttle";
import { clientIpKey } from "@/server/auth/request-ip";

import type { VerifyEmailFormState } from "@/lib/validations/verify-email-state";

/**
 * Consume el token de verificación.
 *
 * Va por POST y no por GET a propósito: los antivirus y los previsualizadores
 * de enlaces de algunos clientes de correo abren las URL automáticamente, y
 * con un token de un solo uso eso lo quemaría antes de que la persona llegue
 * a hacer clic.
 */
export async function verifyEmailAction(
  previousState: VerifyEmailFormState,
  formData: FormData
): Promise<VerifyEmailFormState> {
  const token = String(formData.get("token") ?? "");

  // Limita la fuerza bruta sobre tokens sin castigar a quien reintenta el suyo.
  const requestHeaders = await headers();
  const decision = await consumeThrottle(
    "verification-consume-ip",
    clientIpKey(requestHeaders)
  );
  if (!decision.allowed) {
    return {
      status: "error",
      error: "Demasiados intentos. Esperá unos minutos y volvé a intentarlo.",
      attempt: previousState.attempt + 1,
    };
  }

  const result = await consumeEmailVerificationToken(token);
  if (!result.ok) {
    return {
      status: "error",
      error: verificationRejectionMessage(result.reason),
      attempt: previousState.attempt + 1,
    };
  }

  return { status: "idle", error: null, attempt: previousState.attempt + 1 };
}
