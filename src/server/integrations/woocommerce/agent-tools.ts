import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type {
  AgentToolContext,
  AgentToolDefinition,
} from "@/server/agent/tools";
import { getWooCommerceAgentReadiness } from "@/server/integrations/woocommerce/service";

export const WOOCOMMERCE_AGENT_TOOL_NAMES = new Set([
  "search_woocommerce_products",
  "get_woocommerce_order_status",
]);

export const WOOCOMMERCE_AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "search_woocommerce_products",
    description:
      "Consulta el catálogo sincronizado de WooCommerce para responder precio, SKU y stock. Es de solo lectura y nunca modifica la tienda.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Nombre, descripción o SKU del producto buscado.",
        },
      },
      additionalProperties: false,
      required: ["query"],
    },
  },
  {
    name: "get_woocommerce_order_status",
    description:
      "Consulta el estado sincronizado de un pedido de WooCommerce por el número visible informado por el cliente. Es de solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        order_number: {
          type: "string",
          description:
            "Número visible del pedido, sin IDs internos de VantixApp.",
        },
      },
      additionalProperties: false,
      required: ["order_number"],
    },
  },
];

const querySchema = z
  .object({ query: z.string().trim().min(2).max(200) })
  .strict();
const orderSchema = z
  .object({ order_number: z.string().trim().min(1).max(80) })
  .strict();

type Outcome = { payload: unknown; resultCount: number; items?: string[] };

function normalizedPhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function sameWooCommerceCustomerIdentity(input: {
  conversationEmail: string | null;
  conversationPhone: string | null;
  orderEmail: string | null;
  orderPhone: string | null;
}): boolean {
  const conversationEmail =
    input.conversationEmail?.trim().toLowerCase() || null;
  const orderEmail = input.orderEmail?.trim().toLowerCase() || null;
  const conversationPhone = normalizedPhone(input.conversationPhone);
  const orderPhone = normalizedPhone(input.orderPhone);
  return Boolean(
    (conversationEmail &&
      orderEmail &&
      conversationEmail === orderEmail) ||
      (conversationPhone &&
        orderPhone &&
        conversationPhone === orderPhone)
  );
}

export async function searchWooCommerceProductsForAgent(
  ctx: AgentToolContext,
  raw: unknown
): Promise<Outcome> {
  const input = querySchema.parse(raw);
  if (
    !(await getWooCommerceAgentReadiness(ctx.organizationId).catch(
      () => false
    ))
  ) {
    return {
      payload: {
        error: "La tienda no está disponible para consultas en este momento.",
      },
      resultCount: 0,
    };
  }
  const products = await prisma.wooCommerceProduct.findMany({
    where: {
      organizationId: ctx.organizationId,
      published: true,
      OR: [
        { name: { contains: input.query, mode: "insensitive" } },
        { description: { contains: input.query, mode: "insensitive" } },
        {
          variants: {
            some: { sku: { contains: input.query, mode: "insensitive" } },
          },
        },
      ],
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: {
      name: true,
      description: true,
      variants: {
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: {
          sku: true,
          price: true,
          regularPrice: true,
          salePrice: true,
          stock: true,
          stockManaged: true,
          attributes: true,
        },
      },
    },
  });
  return {
    payload: {
      resultados: products.map((product) => ({
        nombre: product.name,
        descripcion: product.description,
        variantes: product.variants.map((variant) => ({
          sku: variant.sku,
          precio:
            variant.salePrice?.toString() ??
            variant.price?.toString() ??
            null,
          precio_regular: variant.regularPrice?.toString() ?? null,
          stock: variant.stockManaged
            ? variant.stock
            : "sin límite informado",
          opciones: variant.attributes,
        })),
      })),
      nota: products.length
        ? "Datos de la última sincronización con WooCommerce."
        : "No se encontraron productos sincronizados. No inventes stock ni precios.",
    },
    resultCount: products.length,
    items: products.map((product) => product.name),
  };
}

export async function getWooCommerceOrderForAgent(
  ctx: AgentToolContext,
  raw: unknown
): Promise<Outcome> {
  const input = orderSchema.parse(raw);
  if (
    !(await getWooCommerceAgentReadiness(ctx.organizationId).catch(
      () => false
    ))
  ) {
    return {
      payload: {
        error: "La tienda no está disponible para consultas en este momento.",
      },
      resultCount: 0,
    };
  }
  const [order, conversation] = await Promise.all([
    prisma.wooCommerceOrder.findFirst({
      where: {
        organizationId: ctx.organizationId,
        orderNumber: input.order_number,
      },
      select: {
        orderNumber: true,
        status: true,
        currency: true,
        total: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        remoteUpdatedAt: true,
      },
    }),
    ctx.userId
      ? Promise.resolve(null)
      : prisma.conversation.findFirst({
          where: {
            id: ctx.conversationId,
            organizationId: ctx.organizationId,
          },
          select: {
            customer: { select: { email: true, phone: true } },
          },
        }),
  ]);
  if (!order) {
    return {
      payload: {
        encontrado: false,
        nota: "No se encontró ese pedido en la última sincronización. Pedí verificar el número o derivá a una persona.",
      },
      resultCount: 0,
    };
  }
  if (
    !ctx.userId &&
    (!conversation?.customer ||
      !sameWooCommerceCustomerIdentity({
        conversationEmail: conversation.customer.email,
        conversationPhone: conversation.customer.phone,
        orderEmail: order.customerEmail,
        orderPhone: order.customerPhone,
      }))
  ) {
    return {
      payload: {
        encontrado: false,
        nota: "No pudimos validar ese pedido para este cliente. Pedí verificar los datos o derivá a una persona.",
      },
      resultCount: 0,
    };
  }
  return {
    payload: {
      encontrado: true,
      pedido: order.orderNumber,
      estado: order.status,
      total: order.total?.toString() ?? null,
      moneda: order.currency,
      cliente: order.customerName,
      actualizado: order.remoteUpdatedAt?.toISOString() ?? null,
      nota: "Consulta de solo lectura. No afirmes que el pedido o el stock fueron modificados.",
    },
    resultCount: 1,
    items: order.orderNumber ? [order.orderNumber] : undefined,
  };
}
