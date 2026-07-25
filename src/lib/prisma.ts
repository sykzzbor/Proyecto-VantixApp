import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL?.trim() ?? "";

  if (!connectionString && process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL no está configurada.");
  }

  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      // Cada instancia serverless mantiene su propio pool. Un máximo bajo evita
      // agotar conexiones; el proveedor administrado debe aportar el pooler.
      //
      // Además, `max: 1` es OBLIGATORIO por un defecto de @prisma/adapter-pg
      // (reproducido en 7.8.0 y 7.9.0): con más de una conexión en el pool, dos
      // consultas concurrentes pueden cruzarse los parámetros. En el dashboard,
      // el `take: 8` de getAuditLogs terminaba ligado al booleano `active` de un
      // count paralelo y Postgres respondía
      // `invalid input syntax for type boolean: "8"`.
      //
      // Producción ya usaba 1 y nunca se vio afectada; el bug solo aparecía en
      // desarrollo, que usaba 10. Se iguala el valor para que ambos entornos se
      // comporten igual. Antes de volver a subirlo hay que verificar que el
      // adaptador esté corregido.
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    }),
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma?: ReturnType<typeof createPrismaClient>;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
