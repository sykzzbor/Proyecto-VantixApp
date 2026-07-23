import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature } from "@/server/billing/rules";
import { ActionError } from "@/server/errors";
import { decryptAccessToken, encryptAccessToken } from "@/server/whatsapp/crypto";
import {
  TiendanubeApiError,
  ensureTiendanubeWebhooks,
  getTiendanubeOrder,
  getTiendanubeProduct,
  getTiendanubeStore,
  hasRequiredTiendanubeScopes,
  listTiendanubeCustomers,
  listTiendanubeOrders,
  listTiendanubeProducts,
  type TiendanubeCustomerRemote,
  type TiendanubeOrderRemote,
  type TiendanubeProductRemote,
  type TiendanubeTokens,
} from "@/server/integrations/tiendanube/api";
import {
  getTiendanubeConfigurationStatus,
  type TiendanubeConfigurationIssue,
} from "@/server/integrations/tiendanube/config";

export class TiendanubeIntegrationError extends ActionError {
  constructor(readonly code: "store_in_use" | "missing_scopes" | "not_connected", message: string) {
    super(message);
    this.name = "TiendanubeIntegrationError";
  }
}

export type TiendanubeView = {
  planAccess: boolean;
  planMessage: string | null;
  configured: boolean;
  configurationIssue: TiendanubeConfigurationIssue | null;
  configurationMessage: string | null;
  connected: boolean;
  reconnectionRequired: boolean;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | null;
  storeName: string | null;
  storeDomain: string | null;
  lastSyncedAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  counts: { products: number; variants: number; customers: number; orders: number };
};

function localized(value: Record<string, string> | undefined): string | null {
  if (!value) return null;
  const candidate = value.es || value.pt || value.en || Object.values(value)[0];
  return candidate?.trim() || null;
}

function plainText(value: string | null, max = 4000): string | null {
  if (!value) return null;
  const text = value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, max) : null;
}

function decimal(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999_999_999) return null;
  return new Prisma.Decimal(parsed.toFixed(2));
}

function date(value: string | null | undefined): Date | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}

function sanitizeError(error: unknown): string {
  if (error instanceof TiendanubeApiError) return error.safeMessage.slice(0, 500);
  if (error instanceof TiendanubeIntegrationError) return error.message.slice(0, 500);
  return "No se pudo completar la operación con Tiendanube.";
}

export async function getTiendanubeView(organizationId: string): Promise<TiendanubeView> {
  const configuration = getTiendanubeConfigurationStatus();
  const [connection, entitlement, products, variants, customers, orders] = await Promise.all([
    prisma.tiendanubeConnection.findUnique({
      where: { organizationId },
      select: {
        status: true,
        storeName: true,
        storeDomain: true,
        grantedScopes: true,
        encryptedAccessToken: true,
        lastSyncedAt: true,
        lastWebhookAt: true,
        lastError: true,
      },
    }),
    getOrganizationEntitlement(organizationId),
    prisma.tiendanubeProduct.count({ where: { organizationId } }),
    prisma.tiendanubeProductVariant.count({ where: { organizationId } }),
    prisma.tiendanubeCustomer.count({ where: { organizationId } }),
    prisma.tiendanubeOrder.count({ where: { organizationId } }),
  ]);
  const planAccess = entitlement.accessAllowed && hasPlanFeature(entitlement, "tiendanube");
  const scopesReady = connection ? hasRequiredTiendanubeScopes(connection.grantedScopes) : false;
  const reconnectionRequired = Boolean(connection && (
    connection.status === "ERROR" || !connection.encryptedAccessToken || !scopesReady
  ));
  return {
    planAccess,
    planMessage: planAccess ? null : "Tiendanube está disponible en los planes Profesional y Empresarial.",
    configured: configuration.configured,
    configurationIssue: configuration.issue,
    configurationMessage: configuration.message,
    connected: Boolean(
      connection &&
      connection.status === "CONNECTED" &&
      connection.encryptedAccessToken &&
      scopesReady
    ),
    reconnectionRequired,
    status: connection?.status ?? null,
    storeName: connection?.storeName ?? null,
    storeDomain: connection?.storeDomain ?? null,
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    lastWebhookAt: connection?.lastWebhookAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
    counts: { products, variants, customers, orders },
  };
}

export async function connectTiendanube(input: {
  organizationId: string;
  userId: string;
  tokens: TiendanubeTokens;
}, fetchImpl?: typeof fetch): Promise<{ storeName: string }> {
  if (!hasRequiredTiendanubeScopes(input.tokens.scopes)) {
    throw new TiendanubeIntegrationError(
      "missing_scopes",
      "La autorización no incluye productos, clientes y pedidos. Volvé a conectar Tiendanube."
    );
  }
  const occupied = await prisma.tiendanubeConnection.findUnique({
    where: { storeId: input.tokens.storeId },
    select: { organizationId: true },
  });
  if (occupied && occupied.organizationId !== input.organizationId) {
    throw new TiendanubeIntegrationError("store_in_use", "Esa tienda ya está vinculada a otra organización.");
  }
  const store = await getTiendanubeStore(input.tokens.accessToken, input.tokens.storeId, fetchImpl);
  await ensureTiendanubeWebhooks(input.tokens.accessToken, input.tokens.storeId, fetchImpl);
  const storeName = localized(store.name) ?? "Tienda conectada";
  const previous = await prisma.tiendanubeConnection.findUnique({
    where: { organizationId: input.organizationId },
    select: { storeId: true },
  });
  const replacingStore = Boolean(previous && previous.storeId !== input.tokens.storeId);
  await prisma.$transaction(async (tx) => {
    if (replacingStore) {
      await tx.tiendanubeProductVariant.deleteMany({ where: { organizationId: input.organizationId } });
      await tx.tiendanubeProduct.deleteMany({ where: { organizationId: input.organizationId } });
      await tx.tiendanubeCustomer.deleteMany({ where: { organizationId: input.organizationId } });
      await tx.tiendanubeOrder.deleteMany({ where: { organizationId: input.organizationId } });
    }
    await tx.tiendanubeConnection.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        storeId: input.tokens.storeId,
        status: "CONNECTED",
        storeName: storeName.slice(0, 160),
        storeDomain: store.original_domain?.slice(0, 255) ?? null,
        grantedScopes: input.tokens.scopes,
        encryptedAccessToken: encryptAccessToken(input.tokens.accessToken),
        connectedByUserId: input.userId,
      },
      update: {
        storeId: input.tokens.storeId,
        status: "CONNECTED",
        storeName: storeName.slice(0, 160),
        storeDomain: store.original_domain?.slice(0, 255) ?? null,
        grantedScopes: input.tokens.scopes,
        encryptedAccessToken: encryptAccessToken(input.tokens.accessToken),
        connectedByUserId: input.userId,
        lastError: null,
        disconnectedAt: null,
      },
    });
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.tiendanube_conectado",
    entityType: "tiendanube_connection",
    details: { tienda: storeName.slice(0, 120) },
  });
  return { storeName };
}

async function connectionCredentials(organizationId: string): Promise<{
  id: string;
  storeId: string;
  accessToken: string;
}> {
  const connection = await prisma.tiendanubeConnection.findUnique({
    where: { organizationId },
    select: { id: true, storeId: true, status: true, encryptedAccessToken: true, grantedScopes: true },
  });
  if (
    !connection ||
    connection.status !== "CONNECTED" ||
    !connection.encryptedAccessToken ||
    !hasRequiredTiendanubeScopes(connection.grantedScopes)
  ) {
    throw new TiendanubeIntegrationError("not_connected", "Conectá o reconectá Tiendanube antes de continuar.");
  }
  return {
    id: connection.id,
    storeId: connection.storeId,
    accessToken: decryptAccessToken(connection.encryptedAccessToken),
  };
}

async function upsertProduct(organizationId: string, remote: TiendanubeProductRemote, now: Date) {
  const product = await prisma.tiendanubeProduct.upsert({
    where: { organizationId_externalId: { organizationId, externalId: remote.id } },
    create: {
      organizationId,
      externalId: remote.id,
      name: (localized(remote.name) ?? "Producto sin nombre").slice(0, 300),
      description: plainText(localized(remote.description)),
      handle: localized(remote.handle)?.slice(0, 300) ?? null,
      published: remote.published,
      remoteCreatedAt: date(remote.created_at),
      remoteUpdatedAt: date(remote.updated_at),
      lastSyncedAt: now,
    },
    update: {
      name: (localized(remote.name) ?? "Producto sin nombre").slice(0, 300),
      description: plainText(localized(remote.description)),
      handle: localized(remote.handle)?.slice(0, 300) ?? null,
      published: remote.published,
      remoteCreatedAt: date(remote.created_at),
      remoteUpdatedAt: date(remote.updated_at),
      lastSyncedAt: now,
    },
    select: { id: true },
  });
  const externalVariants: string[] = [];
  for (const variant of remote.variants) {
    externalVariants.push(variant.id);
    const stock = typeof variant.stock === "number"
      ? variant.stock
      : typeof variant.stock === "string" && /^-?\d+$/.test(variant.stock)
        ? Number(variant.stock)
        : null;
    await prisma.tiendanubeProductVariant.upsert({
      where: { organizationId_externalId: { organizationId, externalId: variant.id } },
      create: {
        organizationId,
        productId: product.id,
        externalId: variant.id,
        sku: variant.sku?.slice(0, 160) ?? null,
        price: decimal(variant.price),
        promotionalPrice: decimal(variant.promotional_price),
        stock: Number.isSafeInteger(stock) ? stock : null,
        stockManaged: variant.stock_management,
        values: variant.values as Prisma.InputJsonValue,
        lastSyncedAt: now,
      },
      update: {
        productId: product.id,
        sku: variant.sku?.slice(0, 160) ?? null,
        price: decimal(variant.price),
        promotionalPrice: decimal(variant.promotional_price),
        stock: Number.isSafeInteger(stock) ? stock : null,
        stockManaged: variant.stock_management,
        values: variant.values as Prisma.InputJsonValue,
        lastSyncedAt: now,
      },
    });
  }
  await prisma.tiendanubeProductVariant.deleteMany({
    where: {
      organizationId,
      productId: product.id,
      ...(externalVariants.length > 0 ? { externalId: { notIn: externalVariants } } : {}),
    },
  });
}

async function upsertCustomer(organizationId: string, remote: TiendanubeCustomerRemote, now: Date) {
  const data = {
    name: remote.name?.slice(0, 200) ?? null,
    email: remote.email?.toLowerCase().slice(0, 254) ?? null,
    phone: remote.phone?.slice(0, 40) ?? null,
    totalSpent: decimal(remote.total_spent),
    currency: remote.total_spent_currency?.slice(0, 8) ?? null,
    active: remote.active ?? null,
    remoteCreatedAt: date(remote.created_at),
    remoteUpdatedAt: date(remote.updated_at),
    lastSyncedAt: now,
  };
  await prisma.tiendanubeCustomer.upsert({
    where: { organizationId_externalId: { organizationId, externalId: remote.id } },
    create: { organizationId, externalId: remote.id, ...data },
    update: data,
  });
}

async function upsertOrder(organizationId: string, remote: TiendanubeOrderRemote, now: Date) {
  const items = remote.products.map((item) => ({
    name: item.name?.slice(0, 300) ?? "Producto",
    quantity: item.quantity ?? 0,
    price: decimal(item.price)?.toString() ?? null,
    sku: item.sku?.slice(0, 160) ?? null,
  }));
  const data = {
    orderNumber: remote.number?.slice(0, 80) ?? null,
    status: remote.status.slice(0, 80),
    paymentStatus: remote.payment_status?.slice(0, 80) ?? null,
    shippingStatus: remote.shipping_status?.slice(0, 80) ?? null,
    currency: remote.currency?.slice(0, 8) ?? null,
    total: decimal(remote.total),
    customerExternalId: remote.customer?.id?.slice(0, 64) ?? null,
    customerName: remote.customer?.name?.slice(0, 200) ?? null,
    lineItems: items as Prisma.InputJsonValue,
    remoteCreatedAt: date(remote.created_at),
    remoteUpdatedAt: date(remote.updated_at),
    lastSyncedAt: now,
  };
  await prisma.tiendanubeOrder.upsert({
    where: { organizationId_externalId: { organizationId, externalId: remote.id } },
    create: { organizationId, externalId: remote.id, ...data },
    update: data,
  });
}

export async function syncTiendanube(input: {
  organizationId: string;
  userId: string;
  idempotencyKey: string;
}, fetchImpl?: typeof fetch): Promise<{
  repeated: boolean;
  counts: { products: number; variants: number; customers: number; orders: number };
}> {
  const connection = await connectionCredentials(input.organizationId);
  const key = { organizationId_idempotencyKey: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey } };
  let run = await prisma.tiendanubeSyncRun.findUnique({ where: key });
  if (run?.status === "SUCCEEDED") {
    return {
      repeated: true,
      counts: { products: run.productsCount, variants: run.variantsCount, customers: run.customersCount, orders: run.ordersCount },
    };
  }
  if (run?.status === "RUNNING") throw new ActionError("Ya hay una sincronización en curso.");
  if (run?.status === "FAILED") {
    const claimed = await prisma.tiendanubeSyncRun.updateMany({
      where: { id: run.id, organizationId: input.organizationId, status: "FAILED" },
      data: { status: "RUNNING", attempts: { increment: 1 }, lastError: null, completedAt: null },
    });
    if (claimed.count !== 1) throw new ActionError("Ya hay una sincronización en curso.");
  } else {
    try {
      run = await prisma.tiendanubeSyncRun.create({
        data: { organizationId: input.organizationId, connectionId: connection.id, idempotencyKey: input.idempotencyKey },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ActionError("Ya hay una sincronización en curso.");
      }
      throw error;
    }
  }
  try {
    const [products, customers, orders] = await Promise.all([
      listTiendanubeProducts(connection.accessToken, connection.storeId, fetchImpl),
      listTiendanubeCustomers(connection.accessToken, connection.storeId, fetchImpl),
      listTiendanubeOrders(connection.accessToken, connection.storeId, fetchImpl),
    ]);
    const now = new Date();
    for (const product of products) await upsertProduct(input.organizationId, product, now);
    for (const customer of customers) await upsertCustomer(input.organizationId, customer, now);
    for (const order of orders) await upsertOrder(input.organizationId, order, now);
    const productIds = products.map((item) => item.id);
    const customerIds = customers.map((item) => item.id);
    const orderIds = orders.map((item) => item.id);
    await prisma.$transaction([
      prisma.tiendanubeProduct.deleteMany({ where: { organizationId: input.organizationId, ...(productIds.length ? { externalId: { notIn: productIds } } : {}) } }),
      prisma.tiendanubeCustomer.deleteMany({ where: { organizationId: input.organizationId, ...(customerIds.length ? { externalId: { notIn: customerIds } } : {}) } }),
      prisma.tiendanubeOrder.deleteMany({ where: { organizationId: input.organizationId, ...(orderIds.length ? { externalId: { notIn: orderIds } } : {}) } }),
    ]);
    const counts = {
      products: products.length,
      variants: products.reduce((sum, product) => sum + product.variants.length, 0),
      customers: customers.length,
      orders: orders.length,
    };
    await prisma.$transaction([
      prisma.tiendanubeSyncRun.update({
        where: { id: run!.id },
        data: {
          status: "SUCCEEDED",
          productsCount: counts.products,
          variantsCount: counts.variants,
          customersCount: counts.customers,
          ordersCount: counts.orders,
          completedAt: now,
        },
      }),
      prisma.tiendanubeConnection.updateMany({
        where: { id: connection.id, organizationId: input.organizationId },
        data: { status: "CONNECTED", lastSyncedAt: now, lastError: null },
      }),
    ]);
    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "integraciones.tiendanube_sincronizado",
      entityType: "tiendanube_sync_run",
      entityId: run!.id,
      details: counts,
    });
    return { repeated: false, counts };
  } catch (error) {
    const message = sanitizeError(error);
    await prisma.$transaction([
      prisma.tiendanubeSyncRun.updateMany({ where: { id: run!.id, status: "RUNNING" }, data: { status: "FAILED", lastError: message, completedAt: new Date() } }),
      prisma.tiendanubeConnection.updateMany({ where: { id: connection.id, organizationId: input.organizationId }, data: { status: error instanceof TiendanubeApiError && error.code === "authorization_expired" ? "ERROR" : undefined, lastError: message } }),
    ]);
    throw error;
  }
}

export async function syncTiendanubeWebhookResource(input: {
  organizationId: string;
  event: string;
  resourceId: string | null;
}, fetchImpl?: typeof fetch): Promise<void> {
  const now = new Date();
  if (input.event === "app/uninstalled" || input.event === "app/suspended") {
    await prisma.tiendanubeConnection.updateMany({
      where: { organizationId: input.organizationId },
      data: {
        status: input.event === "app/uninstalled" ? "DISCONNECTED" : "ERROR",
        encryptedAccessToken: input.event === "app/uninstalled" ? null : undefined,
        disconnectedAt: input.event === "app/uninstalled" ? now : undefined,
        lastError: input.event === "app/suspended" ? "El acceso a Tiendanube está suspendido." : null,
        lastWebhookAt: now,
      },
    });
    return;
  }
  if (input.event === "app/resumed") {
    await prisma.tiendanubeConnection.updateMany({
      where: { organizationId: input.organizationId, encryptedAccessToken: { not: null } },
      data: { status: "CONNECTED", lastError: null, lastWebhookAt: now },
    });
    return;
  }
  const connection = await connectionCredentials(input.organizationId);
  if (input.event === "product/deleted" && input.resourceId) {
    await prisma.tiendanubeProduct.deleteMany({ where: { organizationId: input.organizationId, externalId: input.resourceId } });
  } else if (input.event.startsWith("product/") && input.resourceId) {
    await upsertProduct(input.organizationId, await getTiendanubeProduct(connection.accessToken, connection.storeId, input.resourceId, fetchImpl), now);
  } else if (input.event.startsWith("order/") && input.resourceId) {
    await upsertOrder(input.organizationId, await getTiendanubeOrder(connection.accessToken, connection.storeId, input.resourceId, fetchImpl), now);
  }
  await prisma.tiendanubeConnection.updateMany({ where: { organizationId: input.organizationId }, data: { lastWebhookAt: now } });
}

export async function disconnectTiendanube(input: { organizationId: string; userId: string }): Promise<{ ok: boolean }> {
  const updated = await prisma.tiendanubeConnection.updateMany({
    where: { organizationId: input.organizationId, status: { not: "DISCONNECTED" } },
    data: { status: "DISCONNECTED", encryptedAccessToken: null, disconnectedAt: new Date(), lastError: null },
  });
  if (updated.count === 0) return { ok: false };
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.tiendanube_desconectado",
    entityType: "tiendanube_connection",
  });
  return { ok: true };
}

export async function getTiendanubeAgentReadiness(organizationId: string): Promise<boolean> {
  const [entitlement, connection] = await Promise.all([
    getOrganizationEntitlement(organizationId),
    prisma.tiendanubeConnection.findUnique({
      where: { organizationId },
      select: { status: true, encryptedAccessToken: true, grantedScopes: true },
    }),
  ]);
  return Boolean(
    entitlement.accessAllowed &&
    hasPlanFeature(entitlement, "tiendanube") &&
    connection?.status === "CONNECTED" &&
    connection.encryptedAccessToken &&
    hasRequiredTiendanubeScopes(connection.grantedScopes)
  );
}
