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
      max: process.env.NODE_ENV === "production" ? 1 : 10,
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
