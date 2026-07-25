import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Rate limiting persistido en PostgreSQL para los flujos de autenticación.
 *
 * `src/server/rate-limit.ts` cuenta en memoria: sirve dentro de un proceso,
 * pero en Vercel cada invocación serverless arranca con su propio mapa vacío,
 * así que un atacante solo tiene que provocar instancias nuevas para no chocar
 * nunca contra el límite. Los flujos sensibles (reenvío de verificación,
 * recuperación de contraseña) necesitan un contador compartido.
 */

export type ThrottleScope =
  | "verification-resend-ip"
  | "verification-resend-email"
  | "password-reset-ip"
  | "password-reset-email"
  | "verification-consume-ip"
  | "onboarding-write";

export type ThrottleRule = { limit: number; windowMs: number };

/**
 * Dos dimensiones por flujo: por IP frena al que barre direcciones ajenas,
 * por correo frena al que bombardea una sola casilla desde muchas IP.
 */
export const THROTTLE_RULES: Record<ThrottleScope, ThrottleRule> = {
  "verification-resend-ip": { limit: 10, windowMs: 60 * 60 * 1000 },
  "verification-resend-email": { limit: 5, windowMs: 60 * 60 * 1000 },
  "password-reset-ip": { limit: 10, windowMs: 60 * 60 * 1000 },
  "password-reset-email": { limit: 5, windowMs: 60 * 60 * 1000 },
  "verification-consume-ip": { limit: 30, windowMs: 10 * 60 * 1000 },
  // Generoso a propósito: el onboarding autoguarda y no queremos frenar a
  // alguien que realmente está completando su configuración.
  "onboarding-write": { limit: 120, windowMs: 5 * 60 * 1000 },
};

export type ThrottleDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Decide a partir del estado ya leído/escrito. Se expone aparte del acceso a la
 * base para poder probar los bordes (ventana vencida, límite exacto) sin PostgreSQL.
 */
export function decideThrottle(input: {
  count: number;
  windowEnd: Date;
  limit: number;
  now: Date;
}): ThrottleDecision {
  const { count, windowEnd, limit, now } = input;
  if (count <= limit) return { allowed: true, remaining: limit - count };
  const retryAfterMs = windowEnd.getTime() - now.getTime();
  return {
    allowed: false,
    // Siempre al menos 1s: un 0 haría que el cliente reintente en bucle.
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

/**
 * La clave se guarda hasheada: la tabla no revela qué correos pidieron un
 * reenlace ni desde qué IP, aunque alguien lea la base.
 */
export function throttleKey(scope: ThrottleScope, identifier: string): string {
  return createHash("sha256")
    .update(`${scope}:${identifier.toLowerCase()}`, "utf8")
    .digest("hex");
}

/**
 * Cuenta un intento y devuelve la decisión.
 *
 * Se usa la API tipada de Prisma y no `$queryRaw`. Con el adaptador `pg`, una
 * sentencia cruda puede dejar la conexión del pool desincronizada si el request
 * se aborta a mitad de camino, y la siguiente consulta que la toma falla con
 * "bind message supplies N parameters, but prepared statement requires 0".
 *
 * El incremento (`increment: 1`) sí es atómico en la base: dos requests
 * simultáneos dentro de la ventana no pueden leer el mismo valor viejo. La
 * única carrera que queda es en el reinicio de una ventana ya vencida, donde
 * dos requests podrían dejar el contador en 1; para un rate limit es
 * aceptable, porque solo afloja un intento justo en el borde de la ventana.
 *
 * Los intentos rechazados también incrementan, pero `windowEnd` no se mueve:
 * el bloqueo nunca se extiende solo, siempre se libera al terminar la ventana.
 */
export async function consumeThrottle(
  scope: ThrottleScope,
  identifier: string,
  rule: ThrottleRule = THROTTLE_RULES[scope],
  now: Date = new Date()
): Promise<ThrottleDecision> {
  const key = throttleKey(scope, identifier);
  const windowEnd = new Date(now.getTime() + rule.windowMs);

  try {
    // Ventana viva: incremento atómico.
    const incremented = await prisma.authThrottle.updateMany({
      where: { key, windowEnd: { gt: now } },
      data: { count: { increment: 1 } },
    });

    if (incremented.count === 0) {
      // No existe la fila o la ventana venció: se abre una nueva.
      await prisma.authThrottle.upsert({
        where: { key },
        create: { key, count: 1, windowEnd },
        update: { count: 1, windowEnd },
      });
      return { allowed: true, remaining: rule.limit - 1 };
    }

    const row = await prisma.authThrottle.findUnique({
      where: { key },
      select: { count: true, windowEnd: true },
    });
    if (!row) return { allowed: true, remaining: rule.limit - 1 };

    return decideThrottle({
      count: row.count,
      windowEnd: row.windowEnd,
      limit: rule.limit,
      now,
    });
  } catch (error) {
    // Si el contador falla, la elección es dejar pasar en vez de romper el
    // login de todo el mundo. Better Auth mantiene su propio límite por endpoint.
    console.error(
      "[VantixApp][throttle] No se pudo registrar el intento:",
      error instanceof Error ? error.name : "error desconocido"
    );
    return { allowed: true, remaining: 0 };
  }
}

/** Lee el estado sin contar un intento (para mostrar el cooldown en pantalla). */
export async function peekThrottle(
  scope: ThrottleScope,
  identifier: string,
  rule: ThrottleRule = THROTTLE_RULES[scope],
  now: Date = new Date()
): Promise<ThrottleDecision> {
  const row = await prisma.authThrottle.findUnique({
    where: { key: throttleKey(scope, identifier) },
    select: { count: true, windowEnd: true },
  });
  if (!row || row.windowEnd.getTime() <= now.getTime()) {
    return { allowed: true, remaining: rule.limit };
  }
  return decideThrottle({
    count: row.count,
    windowEnd: row.windowEnd,
    limit: rule.limit,
    now,
  });
}

/** Borra las ventanas vencidas. Pensado para un job programado. */
export async function purgeExpiredThrottles(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.authThrottle.deleteMany({
    where: { windowEnd: { lte: now } },
  });
  return count;
}
