import { randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/server/audit";
import { getOrganizationEntitlement } from "@/server/billing/entitlement";
import { hasPlanFeature, requirePlanFeature } from "@/server/billing/rules";
import { ActionError } from "@/server/errors";
import {
  WooCommerceApiError,
  ensureWooCommerceWebhooks,
  getWooCommerceCustomer,
  getWooCommerceOrder,
  getWooCommerceProduct,
  listWooCommerceCustomers,
  listWooCommerceOrders,
  listWooCommerceProducts,
  normalizeWooCommerceStoreUrl,
  validateWooCommerceConnection,
  type WooCommerceCredentials,
  type WooCommerceCustomerRemote,
  type WooCommerceOrderRemote,
  type WooCommerceProductRemote,
} from "@/server/integrations/woocommerce/api";
import {
  getWooCommerceConfigurationStatus,
  type WooCommerceConfigurationIssue,
} from "@/server/integrations/woocommerce/config";
import {
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";

export class WooCommerceIntegrationError extends ActionError {
  constructor(
    readonly code: "store_in_use" | "not_connected",
    message: string
  ) {
    super(message);
    this.name = "WooCommerceIntegrationError";
  }
}

export type WooCommerceView = {
  planAccess: boolean;
  planMessage: string | null;
  configured: boolean;
  configurationIssue: WooCommerceConfigurationIssue | null;
  configurationMessage: string | null;
  connected: boolean;
  reconnectionRequired: boolean;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | null;
  storeName: string | null;
  storeUrl: string | null;
  lastSyncedAt: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
  counts: {
    products: number;
    variants: number;
    customers: number;
    orders: number;
  };
};

function plainText(value: string | null | undefined, max = 4000): string | null {
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

function decimal(
  value: string | number | null | undefined
): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed < 0 ||
    parsed > 999_999_999_999
  ) {
    return null;
  }
  return new Prisma.Decimal(parsed.toFixed(2));
}

function date(value: string | null | undefined): Date | null {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value);
}

function safeError(error: unknown): string {
  if (error instanceof WooCommerceApiError) {
    return error.safeMessage.slice(0, 500);
  }
  if (error instanceof WooCommerceIntegrationError) {
    return error.message.slice(0, 500);
  }
  return "No se pudo completar la operación con WooCommerce.";
}

export async function getWooCommerceView(
  organizationId: string
): Promise<WooCommerceView> {
  const configuration = getWooCommerceConfigurationStatus();
  const [connection, entitlement, products, variants, customers, orders] =
    await Promise.all([
      prisma.wooCommerceConnection.findUnique({
        where: { organizationId },
        select: {
          status: true,
          storeName: true,
          storeUrl: true,
          encryptedConsumerKey: true,
          encryptedConsumerSecret: true,
          encryptedWebhookSecret: true,
          lastSyncedAt: true,
          lastWebhookAt: true,
          lastError: true,
        },
      }),
      getOrganizationEntitlement(organizationId),
      prisma.wooCommerceProduct.count({ where: { organizationId } }),
      prisma.wooCommerceProductVariant.count({ where: { organizationId } }),
      prisma.wooCommerceCustomer.count({ where: { organizationId } }),
      prisma.wooCommerceOrder.count({ where: { organizationId } }),
    ]);
  const planAccess =
    entitlement.accessAllowed && hasPlanFeature(entitlement, "woocommerce");
  const credentialsReady = Boolean(
    connection?.encryptedConsumerKey &&
      connection.encryptedConsumerSecret &&
      connection.encryptedWebhookSecret
  );
  return {
    planAccess,
    planMessage: planAccess
      ? null
      : "WooCommerce está disponible en los planes Profesional y Empresarial.",
    configured: configuration.configured,
    configurationIssue: configuration.issue,
    configurationMessage: configuration.message,
    connected: Boolean(
      connection?.status === "CONNECTED" && credentialsReady
    ),
    reconnectionRequired: Boolean(
      connection &&
        (connection.status === "ERROR" ||
          (connection.status === "CONNECTED" && !credentialsReady))
    ),
    status: connection?.status ?? null,
    storeName: connection?.storeName ?? null,
    storeUrl: connection?.storeUrl ?? null,
    lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
    lastWebhookAt: connection?.lastWebhookAt?.toISOString() ?? null,
    lastError: connection?.lastError ?? null,
    counts: { products, variants, customers, orders },
  };
}

export async function connectWooCommerce(
  input: {
    organizationId: string;
    userId: string;
    storeUrl: string;
    consumerKey: string;
    consumerSecret: string;
  },
  fetchImpl?: typeof fetch
): Promise<{ storeName: string; storeUrl: string }> {
  await requirePlanFeature(input.organizationId, "woocommerce");
  const credentials: WooCommerceCredentials = {
    storeUrl: normalizeWooCommerceStoreUrl(input.storeUrl),
    consumerKey: input.consumerKey.trim(),
    consumerSecret: input.consumerSecret.trim(),
  };
  const validated = await validateWooCommerceConnection(credentials, fetchImpl);
  const occupied = await prisma.wooCommerceConnection.findUnique({
    where: { storeUrl: validated.storeUrl },
    select: { organizationId: true },
  });
  if (occupied && occupied.organizationId !== input.organizationId) {
    throw new WooCommerceIntegrationError(
      "store_in_use",
      "Esa tienda ya está vinculada a otra organización."
    );
  }
  const previous = await prisma.wooCommerceConnection.findUnique({
    where: { organizationId: input.organizationId },
    select: {
      storeUrl: true,
      webhookKey: true,
      encryptedWebhookSecret: true,
    },
  });
  const sameStore = previous?.storeUrl === validated.storeUrl;
  const webhookKey = sameStore ? previous.webhookKey : randomUUID();
  const webhookSecret =
    sameStore && previous.encryptedWebhookSecret
      ? decryptAccessToken(previous.encryptedWebhookSecret)
      : randomBytes(32).toString("base64url");

  // La conexión anterior se conserva intacta hasta que WooCommerce valide
  // credenciales y registre todos los webhooks firmados.
  await ensureWooCommerceWebhooks(
    credentials,
    webhookKey,
    webhookSecret,
    fetchImpl
  );
  const replacingStore = Boolean(previous && !sameStore);
  await prisma.$transaction(async (tx) => {
    if (replacingStore) {
      await tx.wooCommerceProductVariant.deleteMany({
        where: { organizationId: input.organizationId },
      });
      await tx.wooCommerceProduct.deleteMany({
        where: { organizationId: input.organizationId },
      });
      await tx.wooCommerceCustomer.deleteMany({
        where: { organizationId: input.organizationId },
      });
      await tx.wooCommerceOrder.deleteMany({
        where: { organizationId: input.organizationId },
      });
    }
    await tx.wooCommerceConnection.upsert({
      where: { organizationId: input.organizationId },
      create: {
        organizationId: input.organizationId,
        storeUrl: validated.storeUrl,
        webhookKey,
        status: "CONNECTED",
        storeName: validated.storeName,
        encryptedConsumerKey: encryptAccessToken(credentials.consumerKey),
        encryptedConsumerSecret: encryptAccessToken(
          credentials.consumerSecret
        ),
        encryptedWebhookSecret: encryptAccessToken(webhookSecret),
        connectedByUserId: input.userId,
      },
      update: {
        storeUrl: validated.storeUrl,
        webhookKey,
        status: "CONNECTED",
        storeName: validated.storeName,
        encryptedConsumerKey: encryptAccessToken(credentials.consumerKey),
        encryptedConsumerSecret: encryptAccessToken(
          credentials.consumerSecret
        ),
        encryptedWebhookSecret: encryptAccessToken(webhookSecret),
        connectedByUserId: input.userId,
        lastError: null,
        disconnectedAt: null,
      },
    });
  });
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.woocommerce_conectado",
    entityType: "woocommerce_connection",
    details: { tienda: validated.storeName.slice(0, 120) },
  });
  return validated;
}

async function connectionCredentials(
  organizationId: string
): Promise<
  WooCommerceCredentials & {
    id: string;
    webhookKey: string;
    webhookSecret: string;
  }
> {
  await requirePlanFeature(organizationId, "woocommerce");
  const connection = await prisma.wooCommerceConnection.findUnique({
    where: { organizationId },
    select: {
      id: true,
      storeUrl: true,
      webhookKey: true,
      status: true,
      encryptedConsumerKey: true,
      encryptedConsumerSecret: true,
      encryptedWebhookSecret: true,
    },
  });
  if (
    !connection ||
    connection.status !== "CONNECTED" ||
    !connection.encryptedConsumerKey ||
    !connection.encryptedConsumerSecret ||
    !connection.encryptedWebhookSecret
  ) {
    throw new WooCommerceIntegrationError(
      "not_connected",
      "Conectá o reconectá WooCommerce antes de continuar."
    );
  }
  return {
    id: connection.id,
    storeUrl: connection.storeUrl,
    webhookKey: connection.webhookKey,
    consumerKey: decryptAccessToken(connection.encryptedConsumerKey),
    consumerSecret: decryptAccessToken(connection.encryptedConsumerSecret),
    webhookSecret: decryptAccessToken(connection.encryptedWebhookSecret),
  };
}

function variantExternalId(
  product: WooCommerceProductRemote,
  variantId: string
): string {
  return `${product.type === "variable" ? "v" : "p"}:${variantId}`;
}

async function upsertProduct(
  organizationId: string,
  remote: WooCommerceProductRemote,
  now: Date
) {
  const product = await prisma.wooCommerceProduct.upsert({
    where: {
      organizationId_externalId: {
        organizationId,
        externalId: remote.id,
      },
    },
    create: {
      organizationId,
      externalId: remote.id,
      name: remote.name.slice(0, 300),
      description: plainText(remote.description || remote.short_description),
      handle: remote.slug?.slice(0, 300) ?? null,
      published: remote.status === "publish",
      productType: remote.type.slice(0, 40),
      remoteCreatedAt: date(remote.date_created_gmt),
      remoteUpdatedAt: date(remote.date_modified_gmt),
      lastSyncedAt: now,
    },
    update: {
      name: remote.name.slice(0, 300),
      description: plainText(remote.description || remote.short_description),
      handle: remote.slug?.slice(0, 300) ?? null,
      published: remote.status === "publish",
      productType: remote.type.slice(0, 40),
      remoteCreatedAt: date(remote.date_created_gmt),
      remoteUpdatedAt: date(remote.date_modified_gmt),
      lastSyncedAt: now,
    },
    select: { id: true },
  });
  const externalVariants: string[] = [];
  for (const variant of remote.resolvedVariants) {
    const externalId = variantExternalId(remote, variant.id);
    externalVariants.push(externalId);
    await prisma.wooCommerceProductVariant.upsert({
      where: {
        organizationId_externalId: { organizationId, externalId },
      },
      create: {
        organizationId,
        productId: product.id,
        externalId,
        sku: variant.sku?.slice(0, 160) ?? null,
        price: decimal(variant.price),
        regularPrice: decimal(variant.regular_price),
        salePrice: decimal(variant.sale_price),
        stock: variant.stock_quantity ?? null,
        stockManaged: variant.manage_stock,
        attributes: variant.attributes as Prisma.InputJsonValue,
        lastSyncedAt: now,
      },
      update: {
        productId: product.id,
        sku: variant.sku?.slice(0, 160) ?? null,
        price: decimal(variant.price),
        regularPrice: decimal(variant.regular_price),
        salePrice: decimal(variant.sale_price),
        stock: variant.stock_quantity ?? null,
        stockManaged: variant.manage_stock,
        attributes: variant.attributes as Prisma.InputJsonValue,
        lastSyncedAt: now,
      },
    });
  }
  await prisma.wooCommerceProductVariant.deleteMany({
    where: {
      organizationId,
      productId: product.id,
      ...(externalVariants.length
        ? { externalId: { notIn: externalVariants } }
        : {}),
    },
  });
}

async function upsertCustomer(
  organizationId: string,
  remote: WooCommerceCustomerRemote,
  now: Date
) {
  const name = `${remote.first_name} ${remote.last_name}`.trim() || null;
  const data = {
    name: name?.slice(0, 200) ?? null,
    email: remote.email?.toLowerCase().slice(0, 254) ?? null,
    phone: remote.billing?.phone?.slice(0, 40) ?? null,
    totalSpent: decimal(remote.total_spent),
    ordersCount: remote.orders_count ?? null,
    remoteCreatedAt: date(remote.date_created_gmt),
    remoteUpdatedAt: date(remote.date_modified_gmt),
    lastSyncedAt: now,
  };
  await prisma.wooCommerceCustomer.upsert({
    where: {
      organizationId_externalId: {
        organizationId,
        externalId: remote.id,
      },
    },
    create: { organizationId, externalId: remote.id, ...data },
    update: data,
  });
}

async function upsertOrder(
  organizationId: string,
  remote: WooCommerceOrderRemote,
  now: Date
) {
  const customerName =
    `${remote.billing.first_name} ${remote.billing.last_name}`.trim() || null;
  const lineItems = remote.line_items.map((item) => ({
    name: item.name?.slice(0, 300) ?? "Producto",
    quantity: item.quantity ?? 0,
    total: decimal(item.total)?.toString() ?? null,
    price: decimal(item.price)?.toString() ?? null,
    sku: item.sku?.slice(0, 160) ?? null,
  }));
  const data = {
    orderNumber: remote.number.slice(0, 80),
    status: remote.status.slice(0, 80),
    currency: remote.currency?.slice(0, 8) ?? null,
    total: decimal(remote.total),
    customerExternalId:
      remote.customer_id === "0" ? null : remote.customer_id.slice(0, 64),
    customerName: customerName?.slice(0, 200) ?? null,
    customerEmail: remote.billing.email?.toLowerCase().slice(0, 254) ?? null,
    customerPhone: remote.billing.phone?.slice(0, 40) ?? null,
    lineItems: lineItems as Prisma.InputJsonValue,
    remoteCreatedAt: date(remote.date_created_gmt),
    remoteUpdatedAt: date(remote.date_modified_gmt),
    lastSyncedAt: now,
  };
  await prisma.wooCommerceOrder.upsert({
    where: {
      organizationId_externalId: {
        organizationId,
        externalId: remote.id,
      },
    },
    create: { organizationId, externalId: remote.id, ...data },
    update: data,
  });
}

export async function syncWooCommerce(
  input: {
    organizationId: string;
    userId: string;
    idempotencyKey: string;
  },
  fetchImpl?: typeof fetch
): Promise<{
  repeated: boolean;
  counts: {
    products: number;
    variants: number;
    customers: number;
    orders: number;
  };
}> {
  const connection = await connectionCredentials(input.organizationId);
  const key = {
    organizationId_idempotencyKey: {
      organizationId: input.organizationId,
      idempotencyKey: input.idempotencyKey,
    },
  };
  let run = await prisma.wooCommerceSyncRun.findUnique({ where: key });
  if (run?.status === "SUCCEEDED") {
    return {
      repeated: true,
      counts: {
        products: run.productsCount,
        variants: run.variantsCount,
        customers: run.customersCount,
        orders: run.ordersCount,
      },
    };
  }
  if (run?.status === "RUNNING") {
    throw new ActionError("Ya hay una sincronización en curso.");
  }
  if (run?.status === "FAILED") {
    const claimed = await prisma.wooCommerceSyncRun.updateMany({
      where: {
        id: run.id,
        organizationId: input.organizationId,
        status: "FAILED",
      },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        lastError: null,
        completedAt: null,
      },
    });
    if (claimed.count !== 1) {
      throw new ActionError("Ya hay una sincronización en curso.");
    }
  } else {
    try {
      run = await prisma.wooCommerceSyncRun.create({
        data: {
          organizationId: input.organizationId,
          connectionId: connection.id,
          idempotencyKey: input.idempotencyKey,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ActionError("Ya hay una sincronización en curso.");
      }
      throw error;
    }
  }
  try {
    const [products, customers, orders] = await Promise.all([
      listWooCommerceProducts(connection, fetchImpl),
      listWooCommerceCustomers(connection, fetchImpl),
      listWooCommerceOrders(connection, fetchImpl),
    ]);
    const now = new Date();
    for (const product of products) {
      await upsertProduct(input.organizationId, product, now);
    }
    for (const customer of customers) {
      await upsertCustomer(input.organizationId, customer, now);
    }
    for (const order of orders) {
      await upsertOrder(input.organizationId, order, now);
    }
    const productIds = products.map((item) => item.id);
    const customerIds = customers.map((item) => item.id);
    const orderIds = orders.map((item) => item.id);
    await prisma.$transaction([
      prisma.wooCommerceProduct.deleteMany({
        where: {
          organizationId: input.organizationId,
          ...(productIds.length
            ? { externalId: { notIn: productIds } }
            : {}),
        },
      }),
      prisma.wooCommerceCustomer.deleteMany({
        where: {
          organizationId: input.organizationId,
          ...(customerIds.length
            ? { externalId: { notIn: customerIds } }
            : {}),
        },
      }),
      prisma.wooCommerceOrder.deleteMany({
        where: {
          organizationId: input.organizationId,
          ...(orderIds.length ? { externalId: { notIn: orderIds } } : {}),
        },
      }),
    ]);
    const counts = {
      products: products.length,
      variants: products.reduce(
        (sum, product) => sum + product.resolvedVariants.length,
        0
      ),
      customers: customers.length,
      orders: orders.length,
    };
    await prisma.$transaction([
      prisma.wooCommerceSyncRun.update({
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
      prisma.wooCommerceConnection.updateMany({
        where: {
          id: connection.id,
          organizationId: input.organizationId,
        },
        data: { status: "CONNECTED", lastSyncedAt: now, lastError: null },
      }),
    ]);
    await recordAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "integraciones.woocommerce_sincronizado",
      entityType: "woocommerce_sync_run",
      entityId: run!.id,
      details: counts,
    });
    return { repeated: false, counts };
  } catch (error) {
    const message = safeError(error);
    await prisma.$transaction([
      prisma.wooCommerceSyncRun.updateMany({
        where: { id: run!.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          lastError: message,
          completedAt: new Date(),
        },
      }),
      prisma.wooCommerceConnection.updateMany({
        where: {
          id: connection.id,
          organizationId: input.organizationId,
        },
        data: {
          status:
            error instanceof WooCommerceApiError &&
            ["authorization_expired", "permission_denied"].includes(error.code)
              ? "ERROR"
              : undefined,
          lastError: message,
        },
      }),
    ]);
    throw error;
  }
}

export async function syncWooCommerceWebhookResource(
  input: {
    organizationId: string;
    topic: string;
    resourceId: string | null;
  },
  fetchImpl?: typeof fetch
): Promise<void> {
  const now = new Date();
  if (!input.resourceId) {
    throw new WooCommerceApiError(
      "invalid_request",
      "El evento no identifica un recurso."
    );
  }
  const connection = await connectionCredentials(input.organizationId);
  const [resource, event] = input.topic.split(".");
  if (event === "deleted") {
    if (resource === "product") {
      await prisma.wooCommerceProduct.deleteMany({
        where: {
          organizationId: input.organizationId,
          externalId: input.resourceId,
        },
      });
    } else if (resource === "customer") {
      await prisma.wooCommerceCustomer.deleteMany({
        where: {
          organizationId: input.organizationId,
          externalId: input.resourceId,
        },
      });
    } else if (resource === "order") {
      await prisma.wooCommerceOrder.deleteMany({
        where: {
          organizationId: input.organizationId,
          externalId: input.resourceId,
        },
      });
    }
  } else if (resource === "product") {
    await upsertProduct(
      input.organizationId,
      await getWooCommerceProduct(connection, input.resourceId, fetchImpl),
      now
    );
  } else if (resource === "customer") {
    await upsertCustomer(
      input.organizationId,
      await getWooCommerceCustomer(connection, input.resourceId, fetchImpl),
      now
    );
  } else if (resource === "order") {
    await upsertOrder(
      input.organizationId,
      await getWooCommerceOrder(connection, input.resourceId, fetchImpl),
      now
    );
  }
  await prisma.wooCommerceConnection.updateMany({
    where: { organizationId: input.organizationId },
    data: { lastWebhookAt: now, lastError: null },
  });
}

export async function disconnectWooCommerce(input: {
  organizationId: string;
  userId: string;
}): Promise<{ ok: boolean }> {
  const updated = await prisma.wooCommerceConnection.updateMany({
    where: {
      organizationId: input.organizationId,
      status: { not: "DISCONNECTED" },
    },
    data: {
      status: "DISCONNECTED",
      encryptedConsumerKey: null,
      encryptedConsumerSecret: null,
      disconnectedAt: new Date(),
      lastError: null,
    },
  });
  if (updated.count === 0) return { ok: false };
  await recordAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "integraciones.woocommerce_desconectado",
    entityType: "woocommerce_connection",
  });
  return { ok: true };
}

export async function getWooCommerceAgentReadiness(
  organizationId: string
): Promise<boolean> {
  const [entitlement, connection] = await Promise.all([
    getOrganizationEntitlement(organizationId),
    prisma.wooCommerceConnection.findUnique({
      where: { organizationId },
      select: {
        status: true,
        encryptedConsumerKey: true,
        encryptedConsumerSecret: true,
      },
    }),
  ]);
  return Boolean(
    entitlement.accessAllowed &&
      hasPlanFeature(entitlement, "woocommerce") &&
      connection?.status === "CONNECTED" &&
      connection.encryptedConsumerKey &&
      connection.encryptedConsumerSecret
  );
}

export async function getWooCommerceWebhookConnection(webhookKey: string) {
  const connection = await prisma.wooCommerceConnection.findUnique({
    where: { webhookKey },
    select: {
      organizationId: true,
      status: true,
      encryptedWebhookSecret: true,
    },
  });
  if (!connection?.encryptedWebhookSecret) return null;
  return {
    organizationId: connection.organizationId,
    connected: connection.status === "CONNECTED",
    webhookSecret: decryptAccessToken(connection.encryptedWebhookSecret),
  };
}
