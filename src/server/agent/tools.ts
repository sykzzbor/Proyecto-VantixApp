import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatCurrency, formatDuration } from "@/lib/format";
import { recordAudit } from "@/server/audit";
import { saveMessage } from "@/server/conversations";

/**
 * Contexto interno de ejecución de herramientas. El organizationId
 * proviene SIEMPRE de la sesión autenticada en el servidor: nunca se
 * acepta un organization_id generado por la IA ni enviado por el navegador.
 */
export type AgentToolContext = {
  organizationId: string;
  conversationId: string;
  userId: string | null;
  flags: { humanTakeover: boolean };
};

const MAX_PRODUCT_RESULTS = 5;
const MAX_SERVICE_RESULTS = 5;
const MAX_FAQ_RESULTS = 3;

// ============================================================
// Definiciones neutrales de herramientas
// ============================================================

export type AgentToolDefinition = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
    required: string[];
  };
};

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    name: "get_business_information",
    description:
      "Devuelve la información general del negocio: nombre, rubro, descripción, dirección, teléfono, horarios, métodos de pago e información de envíos.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
      required: [],
    },
  },
  {
    name: "search_products",
    description:
      "Busca productos activos del negocio por texto y, opcionalmente, por categoría. Usala para consultas de precios, stock o disponibilidad de productos.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Texto de búsqueda con las palabras clave del producto (por ejemplo: 'shampoo reparador').",
        },
        category: {
          type: ["string", "null"],
          description: "Categoría exacta para filtrar, o null si no aplica.",
        },
      },
      additionalProperties: false,
      required: ["query", "category"],
    },
  },
  {
    name: "search_services",
    description:
      "Busca servicios activos del negocio por texto. Usala para consultas de precios o duración de servicios.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto de búsqueda con las palabras clave del servicio.",
        },
      },
      additionalProperties: false,
      required: ["query"],
    },
  },
  {
    name: "search_faqs",
    description:
      "Busca preguntas frecuentes activas relacionadas con la consulta del cliente.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto de la consulta del cliente.",
        },
      },
      additionalProperties: false,
      required: ["query"],
    },
  },
  {
    name: "request_human_support",
    description:
      "Marca la conversación para que la continúe una persona del equipo. Usala cuando el cliente pida hablar con alguien, haya un reclamo o lo indiquen las reglas de derivación.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo breve de la derivación.",
        },
        summary: {
          type: "string",
          description:
            "Resumen corto de la conversación para la persona que la retome.",
        },
      },
      additionalProperties: false,
      required: ["reason", "summary"],
    },
  },
];

// ============================================================
// Validación de argumentos (defensa adicional a strict mode)
// ============================================================

const productSearchArgs = z.object({
  query: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).nullish(),
});

const textSearchArgs = z.object({
  query: z.string().trim().min(1).max(200),
});

const humanSupportArgs = z.object({
  reason: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(600),
});

// ============================================================
// Ejecución
// ============================================================

/** Filtro OR por palabras sobre varios campos de texto. */
function buildTextFilter(query: string, fields: string[]) {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .slice(0, 5);
  const terms = words.length > 0 ? words : [query];

  return terms.flatMap((term) =>
    fields.map((field) => ({
      [field]: { contains: term, mode: "insensitive" as const },
    }))
  );
}

async function getBusinessInformation(ctx: AgentToolContext) {
  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId: ctx.organizationId },
  });
  if (!profile) {
    return { error: "El negocio todavía no cargó su información general." };
  }

  const direccion = [profile.address, profile.city, profile.country]
    .filter(Boolean)
    .join(", ");

  return {
    nombre: profile.name,
    rubro: profile.industry,
    descripcion: profile.description,
    direccion: direccion || null,
    telefono: profile.phone,
    email: profile.email,
    sitio_web: profile.website,
    horarios: profile.openingHours,
    metodos_de_pago: profile.paymentMethods,
    envios: profile.shippingInfo,
    nota: "Los campos en null no fueron cargados por el negocio: no inventes esa información.",
  };
}

async function searchProducts(ctx: AgentToolContext, rawArgs: unknown) {
  const args = productSearchArgs.parse(rawArgs);
  const where: Prisma.ProductWhereInput = {
    organizationId: ctx.organizationId,
    active: true,
    OR: buildTextFilter(args.query, ["name", "description", "category"]),
  };
  if (args.category) {
    where.category = { equals: args.category, mode: "insensitive" };
  }

  const products = await prisma.product.findMany({
    where,
    take: MAX_PRODUCT_RESULTS,
    orderBy: { updatedAt: "desc" },
  });

  if (products.length === 0) {
    return {
      resultados: [],
      nota: "No se encontraron productos activos que coincidan. No inventes productos.",
    };
  }

  return {
    resultados: products.map((product) => ({
      nombre: product.name,
      descripcion: product.description,
      precio: formatCurrency(product.price.toNumber()),
      stock: product.stock,
      sin_stock: product.stock === 0,
      categoria: product.category,
      estado: "activo",
    })),
  };
}

async function searchServices(ctx: AgentToolContext, rawArgs: unknown) {
  const args = textSearchArgs.parse(rawArgs);
  const services = await prisma.service.findMany({
    where: {
      organizationId: ctx.organizationId,
      active: true,
      OR: buildTextFilter(args.query, ["name", "description"]),
    },
    take: MAX_SERVICE_RESULTS,
    orderBy: { updatedAt: "desc" },
  });

  if (services.length === 0) {
    return {
      resultados: [],
      nota: "No se encontraron servicios activos que coincidan. No inventes servicios.",
    };
  }

  return {
    resultados: services.map((service) => ({
      nombre: service.name,
      descripcion: service.description,
      precio: formatCurrency(service.price.toNumber()),
      duracion: formatDuration(service.durationMinutes),
    })),
  };
}

async function searchFaqs(ctx: AgentToolContext, rawArgs: unknown) {
  const args = textSearchArgs.parse(rawArgs);
  const faqs = await prisma.faq.findMany({
    where: {
      organizationId: ctx.organizationId,
      active: true,
      OR: buildTextFilter(args.query, ["question", "answer", "category"]),
    },
    take: MAX_FAQ_RESULTS,
    orderBy: { updatedAt: "desc" },
  });

  if (faqs.length === 0) {
    return {
      resultados: [],
      nota: "No hay preguntas frecuentes que coincidan con la consulta.",
    };
  }

  return {
    resultados: faqs.map((faq) => ({
      pregunta: faq.question,
      respuesta: faq.answer,
      categoria: faq.category,
    })),
  };
}

async function requestHumanSupport(ctx: AgentToolContext, rawArgs: unknown) {
  const args = humanSupportArgs.parse(rawArgs);

  const updated = await prisma.conversation.updateMany({
    where: {
      id: ctx.conversationId,
      organizationId: ctx.organizationId,
    },
    data: { handlingMode: "HUMAN", humanTakeoverAt: new Date() },
  });
  if (updated.count !== 1) {
    throw new Error("conversation_scope_mismatch");
  }
  await saveMessage({
    organizationId: ctx.organizationId,
    conversationId: ctx.conversationId,
    senderType: "SYSTEM",
    content: "El asistente derivó la conversación a atención humana.",
  });
  ctx.flags.humanTakeover = true;

  await recordAudit({
    organizationId: ctx.organizationId,
    userId: ctx.userId,
    action: "agente.derivacion_solicitada",
    entityType: "conversation",
    entityId: ctx.conversationId,
    details: { motivo: args.reason.slice(0, 200) },
  });

  return {
    ok: true,
    mensaje:
      "La conversación quedó marcada para que la continúe una persona del equipo. Avisale al cliente con amabilidad.",
  };
}

/**
 * Ejecuta una herramienta pedida por el modelo. Cualquier error se
 * devuelve como resultado neutro para que el modelo pueda responder
 * sin exponer detalles internos.
 */
export async function executeAgentTool(
  ctx: AgentToolContext,
  name: string,
  rawArguments: unknown
): Promise<string> {
  try {
    const args: unknown =
      typeof rawArguments === "string"
        ? rawArguments
          ? JSON.parse(rawArguments)
          : {}
        : (rawArguments ?? {});
    switch (name) {
      case "get_business_information":
        return JSON.stringify(await getBusinessInformation(ctx));
      case "search_products":
        return JSON.stringify(await searchProducts(ctx, args));
      case "search_services":
        return JSON.stringify(await searchServices(ctx, args));
      case "search_faqs":
        return JSON.stringify(await searchFaqs(ctx, args));
      case "request_human_support":
        return JSON.stringify(await requestHumanSupport(ctx, args));
      default:
        return JSON.stringify({ error: "Herramienta desconocida." });
    }
  } catch (error) {
    console.error(
      "[VantixApp] Error al ejecutar una herramienta del agente:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return JSON.stringify({
      error: "La consulta no se pudo completar. Informale al cliente que hubo un inconveniente técnico.",
    });
  }
}
