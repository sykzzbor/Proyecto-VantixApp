import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatCurrency, formatDuration } from "@/lib/format";
import { requestConversationHumanHandoff } from "@/server/automation/handoff";
import {
  KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  searchKnowledgeChunks,
} from "@/server/knowledge/search";
import {
  APPOINTMENT_TOOL_DEFINITIONS,
  runCancelAppointment,
  runCheckAvailability,
  runCreateAppointment,
  runRescheduleAppointment,
} from "@/server/agent/appointment-tools";
import {
  TIENDANUBE_AGENT_TOOL_DEFINITIONS,
  getTiendanubeOrderForAgent,
  searchTiendanubeProductsForAgent,
} from "@/server/integrations/tiendanube/agent-tools";

/**
 * Contexto interno de ejecución de herramientas. El organizationId
 * proviene SIEMPRE de la sesión autenticada en el servidor: nunca se
 * acepta un organization_id generado por la IA ni enviado por el navegador.
 */
export type AgentToolContext = {
  organizationId: string;
  conversationId: string;
  sourceMessageId?: string | null;
  userId: string | null;
  flags: { humanTakeover: boolean };
};

/** Resultado interno de una herramienta: lo que ve el modelo + metadata de uso. */
type ToolOutcome = {
  payload: unknown;
  resultCount: number;
  items?: string[];
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
    name: "search_knowledge",
    description:
      "Busca información dentro de los documentos cargados por el negocio (manuales, políticas, catálogos, instructivos). Usala cuando la consulta pueda depender de esos documentos. Devuelve fragmentos relevantes con el nombre del documento; respondé solo con lo que devuelva.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto de la consulta del cliente.",
        },
        category: {
          type: ["string", "null"],
          description: "Categoría exacta para acotar la búsqueda, o null.",
        },
        limit: {
          type: ["integer", "null"],
          description: "Cantidad máxima de fragmentos (1 a 6), o null para el valor por defecto.",
        },
      },
      additionalProperties: false,
      required: ["query", "category", "limit"],
    },
  },
  ...APPOINTMENT_TOOL_DEFINITIONS,
  ...TIENDANUBE_AGENT_TOOL_DEFINITIONS,
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

const knowledgeSearchArgs = z.object({
  query: z.string().trim().min(1).max(200),
  category: z.string().trim().max(60).nullish(),
  limit: z.number().int().min(1).max(KNOWLEDGE_SEARCH_MAX_LIMIT).nullish(),
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

async function getBusinessInformation(
  ctx: AgentToolContext
): Promise<ToolOutcome> {
  const profile = await prisma.businessProfile.findUnique({
    where: { organizationId: ctx.organizationId },
  });
  if (!profile) {
    return {
      payload: { error: "El negocio todavía no cargó su información general." },
      resultCount: 0,
    };
  }

  const direccion = [profile.address, profile.city, profile.country]
    .filter(Boolean)
    .join(", ");

  return {
    payload: {
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
    },
    resultCount: 1,
  };
}

async function searchProducts(
  ctx: AgentToolContext,
  rawArgs: unknown
): Promise<ToolOutcome> {
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
      payload: {
        resultados: [],
        nota: "No se encontraron productos activos que coincidan. No inventes productos.",
      },
      resultCount: 0,
    };
  }

  return {
    payload: {
      resultados: products.map((product) => ({
        nombre: product.name,
        descripcion: product.description,
        precio: formatCurrency(product.price.toNumber()),
        stock: product.stock,
        sin_stock: product.stock === 0,
        categoria: product.category,
        estado: "activo",
      })),
    },
    resultCount: products.length,
    items: products.map((product) => product.name),
  };
}

async function searchServices(
  ctx: AgentToolContext,
  rawArgs: unknown
): Promise<ToolOutcome> {
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
      payload: {
        resultados: [],
        nota: "No se encontraron servicios activos que coincidan. No inventes servicios.",
      },
      resultCount: 0,
    };
  }

  return {
    payload: {
      resultados: services.map((service) => ({
        nombre: service.name,
        descripcion: service.description,
        precio: formatCurrency(service.price.toNumber()),
        duracion: formatDuration(service.durationMinutes),
      })),
    },
    resultCount: services.length,
    items: services.map((service) => service.name),
  };
}

async function searchFaqs(
  ctx: AgentToolContext,
  rawArgs: unknown
): Promise<ToolOutcome> {
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
      payload: {
        resultados: [],
        nota: "No hay preguntas frecuentes que coincidan con la consulta.",
      },
      resultCount: 0,
    };
  }

  return {
    payload: {
      resultados: faqs.map((faq) => ({
        pregunta: faq.question,
        respuesta: faq.answer,
        categoria: faq.category,
      })),
    },
    resultCount: faqs.length,
  };
}

async function searchKnowledge(
  ctx: AgentToolContext,
  rawArgs: unknown
): Promise<ToolOutcome> {
  const args = knowledgeSearchArgs.parse(rawArgs);
  const hits = await searchKnowledgeChunks({
    organizationId: ctx.organizationId,
    query: args.query,
    category: args.category ?? null,
    limit: args.limit ?? KNOWLEDGE_SEARCH_DEFAULT_LIMIT,
  });

  if (hits.length === 0) {
    return {
      payload: {
        resultados: [],
        nota: "No se encontró información en los documentos del negocio para esta consulta. No inventes el contenido de un documento.",
      },
      resultCount: 0,
    };
  }

  return {
    payload: {
      resultados: hits.map((hit) => ({
        documento: hit.documentName,
        fragmento: hit.content,
      })),
      nota: "Respondé solo con esta información. No cites un documento que no aparezca acá.",
    },
    resultCount: hits.length,
    items: Array.from(new Set(hits.map((hit) => hit.documentName))),
  };
}

async function requestHumanSupport(
  ctx: AgentToolContext,
  rawArgs: unknown
): Promise<ToolOutcome> {
  const args = humanSupportArgs.parse(rawArgs);

  await requestConversationHumanHandoff({
    organizationId: ctx.organizationId,
    conversationId: ctx.conversationId,
    sourceMessageId: ctx.sourceMessageId,
    userId: ctx.userId,
    reason: args.reason,
  });
  ctx.flags.humanTakeover = true;

  return {
    payload: {
      ok: true,
      mensaje:
        "La conversación quedó marcada para que la continúe una persona del equipo. Avisale al cliente con amabilidad.",
    },
    resultCount: 1,
  };
}

/** Registro liviano del uso de herramientas (para métricas). No rompe el flujo. */
async function recordToolUsage(
  ctx: AgentToolContext,
  tool: string,
  resultCount: number,
  items?: string[]
) {
  try {
    await prisma.agentToolUsage.create({
      data: {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        tool,
        resultCount,
        metadata:
          items && items.length > 0 ? { items: items.slice(0, 5) } : undefined,
      },
    });
  } catch (error) {
    console.error(
      "[VantixApp] No se pudo registrar el uso de una herramienta:",
      error instanceof Error ? error.name : "unknown_error"
    );
  }
}

async function dispatchTool(
  ctx: AgentToolContext,
  name: string,
  args: unknown
): Promise<ToolOutcome> {
  switch (name) {
    case "get_business_information":
      return getBusinessInformation(ctx);
    case "search_products":
      return searchProducts(ctx, args);
    case "search_services":
      return searchServices(ctx, args);
    case "search_faqs":
      return searchFaqs(ctx, args);
    case "search_knowledge":
      return searchKnowledge(ctx, args);
    case "check_appointment_availability":
      return runCheckAvailability(ctx, args);
    case "create_appointment":
      return runCreateAppointment(ctx, args);
    case "reschedule_appointment":
      return runRescheduleAppointment(ctx, args);
    case "cancel_appointment":
      return runCancelAppointment(ctx, args);
    case "search_store_products":
      return searchTiendanubeProductsForAgent(ctx, args);
    case "get_store_order_status":
      return getTiendanubeOrderForAgent(ctx, args);
    case "request_human_support":
      return requestHumanSupport(ctx, args);
    default:
      return { payload: { error: "Herramienta desconocida." }, resultCount: 0 };
  }
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

    const outcome = await dispatchTool(ctx, name, args);
    await recordToolUsage(ctx, name, outcome.resultCount, outcome.items);
    return JSON.stringify(outcome.payload);
  } catch (error) {
    console.error(
      "[VantixApp] Error al ejecutar una herramienta del agente:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return JSON.stringify({
      error:
        "La consulta no se pudo completar. Informale al cliente que hubo un inconveniente técnico.",
    });
  }
}
