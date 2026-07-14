import { BACKOFF_BASE_MS, BACKOFF_MAX_MS } from "@/server/automation/constants";

/**
 * Backoff exponencial con tope. `attempts` es la cantidad de intentos ya
 * realizados (1 tras el primer intento fallido).
 */
export function backoffDelayMs(
  attempts: number,
  baseMs: number = BACKOFF_BASE_MS,
  maxMs: number = BACKOFF_MAX_MS
): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 20);
  return Math.min(baseMs * 2 ** exponent, maxMs);
}

export function nextAttemptAt(
  attempts: number,
  now: Date = new Date(),
  baseMs?: number,
  maxMs?: number
): Date {
  return new Date(now.getTime() + backoffDelayMs(attempts, baseMs, maxMs));
}
