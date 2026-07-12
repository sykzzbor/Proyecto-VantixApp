import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createPrismaClient() {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DATABASE_URL ?? "",
      // Evita usar conexiones inactivas que el servidor ya cerró
      // (recomendado por Prisma para la base local de `prisma dev`;
      // inocuo con PostgreSQL administrado).
      max: 10,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: 0,
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
