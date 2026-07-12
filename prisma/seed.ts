/**
 * Seed opcional: crea una cuenta demo con un negocio completo para
 * explorar la plataforma sin cargar datos a mano.
 *
 * Ejecutar con: npm run db:seed
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { auth } from "../src/lib/auth";
import { slugify } from "../src/lib/slug";

const DEMO_EMAIL = "demo@vantix.local";
const DEMO_PASSWORD = "VantixDemo123";

async function main() {
  const existing = await prisma.user.findUnique({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });
  if (existing) {
    console.log(`La cuenta demo (${DEMO_EMAIL}) ya existe. No se hizo nada.`);
    return;
  }

  // Alta del usuario a través de Better Auth para que la contraseña
  // quede hasheada exactamente igual que en un registro real.
  await auth.api.signUpEmail({
    body: { name: "Cuenta Demo", email: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: DEMO_EMAIL },
    select: { id: true },
  });

  const org = await prisma.organization.create({
    data: { name: "Estética Aurora", slug: slugify("Estética Aurora") },
  });

  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: "OWNER" },
  });

  await prisma.businessProfile.create({
    data: {
      organizationId: org.id,
      name: "Estética Aurora",
      description:
        "Salón de belleza especializado en coloración y tratamientos capilares. Atendemos con y sin turno previo.",
      industry: "Belleza y cuidado personal",
      phone: "+54 9 11 5555-0000",
      email: "hola@esteticaaurora.com.ar",
      address: "Av. Santa Fe 2450",
      city: "Buenos Aires",
      country: "Argentina",
      openingHours: "Martes a sábados de 9 a 19 h",
      paymentMethods:
        "Efectivo, débito, crédito hasta 3 cuotas sin interés y transferencia.",
      shippingInfo:
        "Los productos se retiran en el salón. No hacemos envíos a domicilio.",
    },
  });

  await prisma.agentSettings.create({
    data: {
      organizationId: org.id,
      assistantName: "Aurora",
      tone: "FRIENDLY",
      welcomeMessage:
        "¡Hola! Soy Aurora, la asistente del salón. ¿Querés consultar precios, horarios o reservar un turno?",
      fallbackMessage:
        "No tengo esa información a mano. Le paso tu consulta al equipo y te responden a la brevedad.",
      handoffRules:
        "Derivar a una persona cuando: piden hablar con alguien, hay un reclamo, o consultan por un turno ya reservado.",
      enabled: false,
    },
  });

  await prisma.product.createMany({
    data: [
      {
        organizationId: org.id,
        name: "Shampoo reparador 500 ml",
        description: "Con keratina y aceite de argán. Apto cabello teñido.",
        price: 12500,
        stock: 24,
        category: "Cuidado capilar",
      },
      {
        organizationId: org.id,
        name: "Máscara nutritiva 250 ml",
        description: "Tratamiento intensivo semanal para puntas dañadas.",
        price: 9800,
        stock: 15,
        category: "Cuidado capilar",
      },
      {
        organizationId: org.id,
        name: "Aceite de argán 60 ml",
        price: 15200,
        stock: 8,
        category: "Styling",
      },
      {
        organizationId: org.id,
        name: "Protector térmico en spray",
        description: "Imprescindible antes de planchita o secador.",
        price: 8900,
        stock: 0,
        category: "Styling",
        active: false,
      },
    ],
  });

  await prisma.service.createMany({
    data: [
      {
        organizationId: org.id,
        name: "Corte y peinado",
        description: "Incluye lavado y brushing.",
        price: 18000,
        durationMinutes: 60,
      },
      {
        organizationId: org.id,
        name: "Coloración completa",
        description: "Color a elección con productos sin amoníaco.",
        price: 45000,
        durationMinutes: 150,
      },
      {
        organizationId: org.id,
        name: "Tratamiento de keratina",
        price: 60000,
        durationMinutes: 180,
      },
      {
        organizationId: org.id,
        name: "Perfilado de cejas",
        price: 7500,
        durationMinutes: 20,
      },
    ],
  });

  await prisma.faq.createMany({
    data: [
      {
        organizationId: org.id,
        question: "¿Atienden sin turno previo?",
        answer:
          "Sí, pero recomendamos reservar para no esperar. Los sábados solo trabajamos con turno.",
        category: "Turnos",
      },
      {
        organizationId: org.id,
        question: "¿Qué medios de pago aceptan?",
        answer:
          "Efectivo, débito, crédito en hasta 3 cuotas sin interés y transferencia.",
        category: "Pagos",
      },
      {
        organizationId: org.id,
        question: "¿Puedo cancelar o reprogramar mi turno?",
        answer:
          "Sí, hasta 24 horas antes sin cargo. Con menos anticipación se cobra el 50 % del servicio.",
        category: "Turnos",
      },
    ],
  });

  await prisma.auditLog.create({
    data: {
      organizationId: org.id,
      userId: user.id,
      action: "organizacion.creada",
      entityType: "organization",
      entityId: org.id,
      details: { nombre: org.name, origen: "seed" },
    },
  });

  console.log("Seed completado. Credenciales de la cuenta demo:");
  console.log(`  Email:      ${DEMO_EMAIL}`);
  console.log(`  Contraseña: ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error("Error al ejecutar el seed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
