import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Autenticación de los trabajos programados de facturación.
 *
 * Usa `CRON_SECRET`, que es la variable que Vercel Cron manda sola como
 * `Authorization: Bearer …` en cada ejecución. Deliberadamente no reutiliza
 * `getCronSecret()` de automatizaciones: aquel exige además que el dispatcher
 * esté habilitado, y los avisos de prueba tienen que salir aunque las
 * automatizaciones estén apagadas.
 */

const MIN_SECRET_LENGTH = 16;
const MAX_SECRET_LENGTH = 4096;

export function getBillingCronSecret(): string | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (
    !secret ||
    secret.length < MIN_SECRET_LENGTH ||
    secret.length > MAX_SECRET_LENGTH
  ) {
    return null;
  }
  return secret;
}

/**
 * Comparación en tiempo constante sobre el hash de ambos valores: iguala los
 * largos y evita que el tiempo de respuesta filtre cuántos caracteres
 * coincidían.
 */
export function secretsMatch(left: string, right: string): boolean {
  const a = createHash("sha256").update(left, "utf8").digest();
  const b = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** Extrae el secreto presentado, de la cabecera Bearer o de la propia. */
export function readPresentedSecret(headers: Headers): string {
  const bearer = headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  return headers.get("x-cron-secret")?.trim() ?? "";
}

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 503 | 401; error: "not_configured" | "unauthorized" };

export function authorizeBillingCron(headers: Headers): CronAuthResult {
  const secret = getBillingCronSecret();
  if (!secret) return { ok: false, status: 503, error: "not_configured" };

  const presented = readPresentedSecret(headers);
  if (!presented || !secretsMatch(presented, secret)) {
    return { ok: false, status: 401, error: "unauthorized" };
  }
  return { ok: true };
}
