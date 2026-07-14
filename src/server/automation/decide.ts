import type { AutomationEventStatus } from "@/generated/prisma/enums";
import { nextAttemptAt } from "@/server/automation/backoff";
import type { DispatchResult } from "@/server/automation/types";

/**
 * Decisiones puras de la cola (sin efectos, testeables): a partir del resultado
 * del envío y del estado del evento, calcula el próximo estado.
 */

export type EventDecision = {
  status: AutomationEventStatus;
  attempts: number;
  nextAttemptAt: Date | null;
  processedAt: Date | null;
  /** Código de error sanitizado a guardar en lastError (no el mensaje completo). */
  lastError: string | null;
  /** Si se libera el lock (lockedAt = null). En PROCESSING/awaiting callback no. */
  clearLock: boolean;
};

/**
 * `attempts` es la cantidad de intentos YA realizados, incluido el actual.
 */
export function decideAfterDispatch(input: {
  attempts: number;
  maxAttempts: number;
  result: DispatchResult;
  now?: Date;
}): EventDecision {
  const { attempts, maxAttempts, result } = input;
  const now = input.now ?? new Date();

  if (result.ok) {
    if (result.awaitingCallback) {
      // Enviado; el resultado final llegará por callback. Queda PROCESSING y
      // bloqueado para que el reclaim lo recupere si el callback nunca llega.
      return {
        status: "PROCESSING",
        attempts,
        nextAttemptAt: null,
        processedAt: null,
        lastError: null,
        clearLock: false,
      };
    }
    return {
      status: "SUCCEEDED",
      attempts,
      nextAttemptAt: null,
      processedAt: now,
      lastError: null,
      clearLock: true,
    };
  }

  if (!result.retryable) {
    return {
      status: "FAILED",
      attempts,
      nextAttemptAt: null,
      processedAt: now,
      lastError: result.errorCode,
      clearLock: true,
    };
  }

  if (attempts >= maxAttempts) {
    return {
      status: "DEAD_LETTER",
      attempts,
      nextAttemptAt: null,
      processedAt: now,
      lastError: result.errorCode,
      clearLock: true,
    };
  }

  return {
    status: "PENDING",
    attempts,
    nextAttemptAt: nextAttemptAt(attempts, now),
    processedAt: null,
    lastError: result.errorCode,
    clearLock: true,
  };
}

/**
 * Decisión para un evento que quedó colgado en PROCESSING (callback nunca
 * llegó): se trata como un intento fallido recuperable.
 */
export function decideStaleProcessing(input: {
  attempts: number;
  maxAttempts: number;
  now?: Date;
}): EventDecision {
  const { attempts, maxAttempts } = input;
  const now = input.now ?? new Date();
  if (attempts >= maxAttempts) {
    return {
      status: "DEAD_LETTER",
      attempts,
      nextAttemptAt: null,
      processedAt: now,
      lastError: "callback_timeout",
      clearLock: true,
    };
  }
  return {
    status: "PENDING",
    attempts,
    nextAttemptAt: nextAttemptAt(attempts, now),
    processedAt: null,
    lastError: "callback_timeout",
    clearLock: true,
  };
}
