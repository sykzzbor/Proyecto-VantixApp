import { Prisma } from "@/generated/prisma/client";

/**
 * Prisma normaliza normalmente los conflictos serializables como P2034, pero
 * los adaptadores JS pueden propagar el conflicto del driver al cerrar una
 * transacción interactiva. Ambos representan la misma condición reintentable.
 */
export function isSerializableTransactionConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }

  if (
    typeof error !== "object" ||
    error === null ||
    !("name" in error) ||
    error.name !== "DriverAdapterError" ||
    !("cause" in error) ||
    typeof error.cause !== "object" ||
    error.cause === null ||
    !("kind" in error.cause)
  ) {
    return false;
  }

  return error.cause.kind === "TransactionWriteConflict";
}
