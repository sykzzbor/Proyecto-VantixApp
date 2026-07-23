import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { AgentToolContext, AgentToolDefinition } from "@/server/agent/tools";
import { getTiendanubeAgentReadiness } from "@/server/integrations/tiendanube/service";

export const TIENDANUBE_AGENT_TOOL_NAMES = new Set([
  "search_store_products",
  "get_store_order_status",
]);

export const TIENDANUBE_AGENT_TOOL_DEFINITIONS: AgentToolDefinition[] = [
  {
    name: "search_store_products",
    description: "Consulta el catálogo sincronizado de Tiendanube para responder precio y stock. Es de solo lectura y nunca modifica la tienda.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Nombre, descripción o SKU del producto buscado." },
      },
      additionalProperties: false,
      required: ["query"],
    },
  },
  {
    name: "get_store_order_status",
    description: "Consulta el estado sincronizado de un pedido de Tiendanube por el número visible que informa el cliente. Es de solo lectura.",
    inputSchema: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "Número visible del pedido, sin IDs internos de VantixApp." },
      },
      additionalProperties: false,
      required: ["order_number"],
    },
  },
];

const querySchema = z.object({ query: z.string().trim().min(2).max(200) }).strict();
const orderSchema = z.object({ order_number: z.string().trim().min(1).max(80) }).strict();

type Outcome = { payload: unknown; resultCount: number; items?: string[] };

async function ensureReady(organizationId: string): Promise<boolean> {
  return getTiendanubeAgentReadiness(organizationId).catch(() => false);
}

function normalizedPhone(value: string | null | undefined): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function sameTiendanubeCustomerIdentity(input: {
  conversationEmail: string | null;
  conversationPhone: string | null;
  storeEmail: string | null;
  storePhone: string | null;
}): boolean {
  const conversationEmail = input.conversationEmail?.trim().toLowerCase() || null;
  const storeEmail = input.storeEmail?.trim().toLowerCase() || null;
  const conversationPhone = normalizedPhone(input.conversationPhone);
  const storePhone = normalizedPhone(input.storePhone);
  return Boolean(
    (conversationEmail && storeEmail && conversationEmail === storeEmail) ||
    (conversationPhone && storePhone && conversationPhone === storePhone)
  );
}

export async function searchTiendanubeProductsForAgent(ctx: AgentToolContext, raw: unknown): Promise<Outcome> {
  const input = querySchema.parse(raw);
  if (!(await ensureReady(ctx.organizationId))) {
    return { payload: { error: "La tienda no está disponible para consultas en este momento." }, resultCount: 0 };
  }
  const products = await prisma.tiendanubeProduct.findMany({
    where: {
      organizationId: ctx.organizationId,
      published: true,
      OR: [
        { name: { contains: input.query, mode: "insensitive" } },
        { description: { contains: input.query, mode: "insensitive" } },
        { variants: { some: { sku: { contains: input.query, mode: "insensitive" } } } },
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
        select: { sku: true, price: true, promotionalPrice: true, stock: true, stockManaged: true, values: true },
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
          precio: variant.promotionalPrice?.toString() ?? variant.price?.toString() ?? null,
          precio_regular: variant.price?.toString() ?? null,
          stock: variant.stockManaged ? variant.stock : "sin límite informado",
          opciones: variant.values,
        })),
      })),
      nota: products.length ? "Datos de la última sincronización con Tiendanube." : "No se encontraron productos sincronizados. No inventes stock ni precios.",
    },
    resultCount: products.length,
    items: products.map((product) => product.name),
  };
}

export async function getTiendanubeOrderForAgent(ctx: AgentToolContext, raw: unknown): Promise<Outcome> {
  const input = orderSchema.parse(raw);
  if (!(await ensureReady(ctx.organizationId))) {
    return { payload: { error: "La tienda no está disponible para consultas en este momento." }, resultCount: 0 };
  }
  const [order, conversation] = await Promise.all([
    prisma.tiendanubeOrder.findFirst({
      where: { organizationId: ctx.organizationId, orderNumber: input.order_number },
      select: {
        orderNumber: true,
        status: true,
        paymentStatus: true,
        shippingStatus: true,
        currency: true,
        total: true,
        customerExternalId: true,
        customerName: true,
        remoteUpdatedAt: true,
      },
    }),
    ctx.userId
      ? Promise.resolve(null)
      : prisma.conversation.findFirst({
          where: { id: ctx.conversationId, organizationId: ctx.organizationId },
          select: { customer: { select: { email: true, phone: true } } },
        }),
  ]);
  if (!order) {
    return { payload: { encontrado: false, nota: "No se encontró ese pedido en la última sincronización. Pedí verificar el número o derivá a una persona." }, resultCount: 0 };
  }
  if (!ctx.userId) {
    const storeCustomer = order.customerExternalId
      ? await prisma.tiendanubeCustomer.findUnique({
          where: {
            organizationId_externalId: {
              organizationId: ctx.organizationId,
              externalId: order.customerExternalId,
            },
          },
          select: { email: true, phone: true },
        })
      : null;
    if (
      !conversation?.customer ||
      !storeCustomer ||
      !sameTiendanubeCustomerIdentity({
        conversationEmail: conversation.customer.email,
        conversationPhone: conversation.customer.phone,
        storeEmail: storeCustomer.email,
        storePhone: storeCustomer.phone,
      })
    ) {
      return {
        payload: {
          encontrado: false,
          nota: "No pudimos validar ese pedido para este cliente. Pedí verificar los datos o derivá a una persona.",
        },
        resultCount: 0,
      };
    }
  }
  return {
    payload: {
      encontrado: true,
      pedido: order.orderNumber,
      estado: order.status,
      pago: order.paymentStatus,
      envio: order.shippingStatus,
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
