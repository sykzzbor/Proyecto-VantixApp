/**
 * Borra por completo una cuenta y todo lo que cuelga de ella.
 *
 * Pensado para limpiar cuentas de prueba. En seco por defecto: sin
 * `--confirmar` solo muestra el inventario de lo que borraría.
 *
 * Uso:
 *   DATABASE_URL='...' npx tsx scripts/borrar-cuenta.mts correo@ejemplo.com
 *   DATABASE_URL='...' npx tsx scripts/borrar-cuenta.mts correo@ejemplo.com --confirmar
 *
 * Salvaguardas:
 * - Exige el correo exacto; nunca borra por coincidencia parcial.
 * - Se niega a borrar una organización que tenga otros miembros.
 * - Verifica al final que no quede ningún registro huérfano.
 */
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const email = process.argv[2]?.trim().toLowerCase();
const confirmar = process.argv.includes("--confirmar");

if (!email || !email.includes("@")) {
  console.error("Falta el correo. Uso: npx tsx scripts/borrar-cuenta.mts correo@ejemplo.com [--confirmar]");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString, max: 1 }),
});

/** Misma derivación que `src/server/auth/throttle.ts`. */
function throttleKey(scope: string, identifier: string): string {
  return createHash("sha256")
    .update(`${scope}:${identifier.toLowerCase()}`, "utf8")
    .digest("hex");
}

async function main() {
  console.log(`Base: ${new URL(connectionString!).hostname}`);
  console.log(`Usuarios totales: ${await prisma.user.count()} · Organizaciones: ${await prisma.organization.count()}`);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, createdAt: true },
  });

  if (!user) {
    console.log(`\nNo existe ninguna cuenta con ${email}. No hay nada que borrar.`);
    return;
  }

  console.log(`\n=== CUENTA ===\n${user.email} · ${user.name} · alta ${user.createdAt.toISOString()}`);

  const memberships = await prisma.organizationMember.findMany({
    where: { userId: user.id },
    select: { organizationId: true, role: true, organization: { select: { name: true } } },
  });

  // Una organización compartida no se borra: dejaría sin espacio de trabajo a
  // los demás miembros. Solo se quita la membresía de esta cuenta.
  const orgsABorrar: string[] = [];
  console.log("\n=== ORGANIZACIONES ===");
  if (memberships.length === 0) console.log("(ninguna)");
  for (const m of memberships) {
    const otros = await prisma.organizationMember.count({
      where: { organizationId: m.organizationId, userId: { not: user.id } },
    });
    if (otros === 0) {
      orgsABorrar.push(m.organizationId);
      console.log(`- ${m.organization.name} (${m.role}) → se borra entera`);
    } else {
      console.log(`- ${m.organization.name} (${m.role}) → TIENE ${otros} miembro(s) más: se conserva, solo se quita esta membresía`);
    }
  }

  const enOrgs = orgsABorrar.length ? { organizationId: { in: orgsABorrar } } : { organizationId: "__ninguna__" };

  const inventario = {
    sesiones: await prisma.session.count({ where: { userId: user.id } }),
    "cuentas de proveedor": await prisma.account.count({ where: { userId: user.id } }),
    "tokens de verificación": await prisma.emailVerificationToken.count({ where: { userId: user.id } }),
    "verifications (reset)": await prisma.verification.count({ where: { value: user.id } }),
    trial: await prisma.userTrial.count({ where: { userId: user.id } }),
    membresías: memberships.length,
    "perfiles de negocio": await prisma.businessProfile.count({ where: enOrgs }),
    "config del agente": await prisma.agentSettings.count({ where: enOrgs }),
    onboarding: await prisma.organizationOnboarding.count({ where: enOrgs }),
    suscripciones: await prisma.organizationSubscription.count({ where: enOrgs }),
    "eventos de facturación": await prisma.billingEvent.count({ where: enOrgs }),
    "preguntas frecuentes": await prisma.faq.count({ where: enOrgs }),
    productos: await prisma.product.count({ where: enOrgs }),
    servicios: await prisma.service.count({ where: enOrgs }),
    conversaciones: await prisma.conversation.count({ where: enOrgs }),
    "registros de auditoría": await prisma.auditLog.count({ where: enOrgs }),
  };

  console.log("\n=== DATOS RELACIONADOS ===");
  for (const [k, v] of Object.entries(inventario)) console.log(`${k}: ${v}`);

  if (!confirmar) {
    console.log("\n--- MARCHA EN SECO: no se borró nada ---");
    console.log("Volvé a ejecutar con --confirmar para borrar de verdad.");
    return;
  }

  console.log("\n=== BORRANDO ===");

  // Los contadores de rate limit se guardan hasheados y sin clave foránea:
  // hay que borrarlos por clave derivada. Solo los que dependen del correo;
  // los que van por IP se comparten con otras personas y vencen solos.
  const clavesThrottle = ["verification-resend-email", "password-reset-email"].map((scope) =>
    throttleKey(scope, email)
  );
  const throttles = await prisma.authThrottle.deleteMany({
    where: { key: { in: clavesThrottle } },
  });
  console.log(`contadores de rate limit: ${throttles.count}`);

  const verifications = await prisma.verification.deleteMany({ where: { value: user.id } });
  console.log(`verifications (reset): ${verifications.count}`);

  for (const organizationId of orgsABorrar) {
    await prisma.organization.delete({ where: { id: organizationId } });
    console.log(`organización borrada: ${organizationId}`);
  }

  // El resto (sesiones, cuentas, tokens, trial, membresías sobrantes) cae por
  // las claves foráneas en cascada declaradas en el esquema.
  await prisma.user.delete({ where: { id: user.id } });
  console.log(`cuenta borrada: ${email}`);

  console.log("\n=== VERIFICACIÓN DE HUÉRFANOS ===");
  const restos = {
    usuario: await prisma.user.count({ where: { email } }),
    sesiones: await prisma.session.count({ where: { userId: user.id } }),
    "cuentas de proveedor": await prisma.account.count({ where: { userId: user.id } }),
    "tokens de verificación": await prisma.emailVerificationToken.count({ where: { userId: user.id } }),
    "verifications (reset)": await prisma.verification.count({ where: { value: user.id } }),
    trial: await prisma.userTrial.count({ where: { userId: user.id } }),
    membresías: await prisma.organizationMember.count({ where: { userId: user.id } }),
    "org activa": await prisma.activeOrganizationSelection.count({ where: { userId: user.id } }),
    "contadores de rate limit": await prisma.authThrottle.count({ where: { key: { in: clavesThrottle } } }),
    ...(orgsABorrar.length
      ? {
          organizaciones: await prisma.organization.count({ where: { id: { in: orgsABorrar } } }),
          "perfiles de negocio": await prisma.businessProfile.count({ where: enOrgs }),
          onboarding: await prisma.organizationOnboarding.count({ where: enOrgs }),
          suscripciones: await prisma.organizationSubscription.count({ where: enOrgs }),
          "eventos de facturación": await prisma.billingEvent.count({ where: enOrgs }),
          "preguntas frecuentes": await prisma.faq.count({ where: enOrgs }),
          "registros de auditoría": await prisma.auditLog.count({ where: enOrgs }),
        }
      : {}),
  };

  let huerfanos = 0;
  for (const [k, v] of Object.entries(restos)) {
    if (v > 0) huerfanos += v;
    console.log(`${v === 0 ? "OK  " : "RESTA"} ${k}: ${v}`);
  }

  console.log(
    huerfanos === 0
      ? "\nSin registros huérfanos."
      : `\nQuedaron ${huerfanos} registro(s). Revisar a mano.`
  );

  console.log(`\nTotales finales → usuarios: ${await prisma.user.count()} · organizaciones: ${await prisma.organization.count()}`);
}

main()
  .catch((error) => {
    console.error("Falló el borrado:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
