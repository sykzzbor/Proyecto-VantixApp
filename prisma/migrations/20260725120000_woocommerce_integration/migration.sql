-- WooCommerce se incorpora de forma aditiva y no modifica integraciones existentes.
CREATE TYPE "WooCommerceConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "WooCommerceSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "woocommerce_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeUrl" VARCHAR(500) NOT NULL,
    "webhookKey" VARCHAR(64) NOT NULL,
    "status" "WooCommerceConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "storeName" VARCHAR(160),
    "encryptedConsumerKey" TEXT,
    "encryptedConsumerSecret" TEXT,
    "encryptedWebhookSecret" TEXT,
    "connectedByUserId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "woocommerce_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "woocommerce_sync_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "WooCommerceSyncStatus" NOT NULL DEFAULT 'RUNNING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "productsCount" INTEGER NOT NULL DEFAULT 0,
    "variantsCount" INTEGER NOT NULL DEFAULT 0,
    "customersCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" VARCHAR(500),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "woocommerce_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "woocommerce_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "handle" VARCHAR(300),
    "published" BOOLEAN NOT NULL DEFAULT true,
    "productType" VARCHAR(40),
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "woocommerce_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "woocommerce_product_variants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "sku" VARCHAR(160),
    "price" DECIMAL(14,2),
    "regularPrice" DECIMAL(14,2),
    "salePrice" DECIMAL(14,2),
    "stock" INTEGER,
    "stockManaged" BOOLEAN NOT NULL DEFAULT false,
    "attributes" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "woocommerce_product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "woocommerce_customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "totalSpent" DECIMAL(14,2),
    "ordersCount" INTEGER,
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "woocommerce_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "woocommerce_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "orderNumber" VARCHAR(80),
    "status" VARCHAR(80) NOT NULL,
    "currency" VARCHAR(8),
    "total" DECIMAL(14,2),
    "customerExternalId" VARCHAR(64),
    "customerName" VARCHAR(200),
    "customerEmail" VARCHAR(254),
    "customerPhone" VARCHAR(40),
    "lineItems" JSONB,
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "woocommerce_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "woocommerce_webhook_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "webhookKey" VARCHAR(64) NOT NULL,
    "topic" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(64),
    "deliveryId" VARCHAR(100),
    "dedupeKey" VARCHAR(64) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "woocommerce_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "woocommerce_connections_organizationId_key" ON "woocommerce_connections"("organizationId");
CREATE UNIQUE INDEX "woocommerce_connections_storeUrl_key" ON "woocommerce_connections"("storeUrl");
CREATE UNIQUE INDEX "woocommerce_connections_webhookKey_key" ON "woocommerce_connections"("webhookKey");
CREATE UNIQUE INDEX "woocommerce_connections_organizationId_id_key" ON "woocommerce_connections"("organizationId", "id");
CREATE INDEX "woocommerce_connections_organizationId_status_idx" ON "woocommerce_connections"("organizationId", "status");
CREATE UNIQUE INDEX "woocommerce_sync_runs_organizationId_idempotencyKey_key" ON "woocommerce_sync_runs"("organizationId", "idempotencyKey");
CREATE INDEX "woocommerce_sync_runs_organizationId_createdAt_idx" ON "woocommerce_sync_runs"("organizationId", "createdAt" DESC);
CREATE INDEX "woocommerce_sync_runs_connectionId_status_idx" ON "woocommerce_sync_runs"("connectionId", "status");
CREATE UNIQUE INDEX "woocommerce_products_organizationId_externalId_key" ON "woocommerce_products"("organizationId", "externalId");
CREATE UNIQUE INDEX "woocommerce_products_organizationId_id_key" ON "woocommerce_products"("organizationId", "id");
CREATE INDEX "woocommerce_products_organizationId_published_updatedAt_idx" ON "woocommerce_products"("organizationId", "published", "updatedAt" DESC);
CREATE UNIQUE INDEX "woocommerce_product_variants_organizationId_externalId_key" ON "woocommerce_product_variants"("organizationId", "externalId");
CREATE INDEX "woocommerce_product_variants_organizationId_productId_idx" ON "woocommerce_product_variants"("organizationId", "productId");
CREATE INDEX "woocommerce_product_variants_organizationId_sku_idx" ON "woocommerce_product_variants"("organizationId", "sku");
CREATE UNIQUE INDEX "woocommerce_customers_organizationId_externalId_key" ON "woocommerce_customers"("organizationId", "externalId");
CREATE INDEX "woocommerce_customers_organizationId_email_idx" ON "woocommerce_customers"("organizationId", "email");
CREATE UNIQUE INDEX "woocommerce_orders_organizationId_externalId_key" ON "woocommerce_orders"("organizationId", "externalId");
CREATE INDEX "woocommerce_orders_organizationId_orderNumber_idx" ON "woocommerce_orders"("organizationId", "orderNumber");
CREATE INDEX "woocommerce_orders_organizationId_status_updatedAt_idx" ON "woocommerce_orders"("organizationId", "status", "updatedAt" DESC);
CREATE INDEX "woocommerce_orders_organizationId_customerExternalId_idx" ON "woocommerce_orders"("organizationId", "customerExternalId");
CREATE UNIQUE INDEX "woocommerce_webhook_receipts_dedupeKey_key" ON "woocommerce_webhook_receipts"("dedupeKey");
CREATE INDEX "woocommerce_webhook_receipts_organizationId_createdAt_idx" ON "woocommerce_webhook_receipts"("organizationId", "createdAt" DESC);
CREATE INDEX "woocommerce_webhook_receipts_webhookKey_topic_createdAt_idx" ON "woocommerce_webhook_receipts"("webhookKey", "topic", "createdAt" DESC);

ALTER TABLE "woocommerce_connections" ADD CONSTRAINT "woocommerce_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_sync_runs" ADD CONSTRAINT "woocommerce_sync_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_sync_runs" ADD CONSTRAINT "woocommerce_sync_runs_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "woocommerce_connections"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_products" ADD CONSTRAINT "woocommerce_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_product_variants" ADD CONSTRAINT "woocommerce_product_variants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_product_variants" ADD CONSTRAINT "woocommerce_product_variants_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "woocommerce_products"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_customers" ADD CONSTRAINT "woocommerce_customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_orders" ADD CONSTRAINT "woocommerce_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "woocommerce_webhook_receipts" ADD CONSTRAINT "woocommerce_webhook_receipts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
