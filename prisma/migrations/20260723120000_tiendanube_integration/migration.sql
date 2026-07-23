-- Tiendanube se incorpora de forma aditiva. No modifica integraciones ni datos existentes.
CREATE TYPE "TiendanubeConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "TiendanubeSyncStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "tiendanube_connections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" VARCHAR(64) NOT NULL,
    "status" "TiendanubeConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "storeName" VARCHAR(160),
    "storeDomain" VARCHAR(255),
    "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "encryptedAccessToken" TEXT,
    "connectedByUserId" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiendanube_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_oauth_states" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tiendanube_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_sync_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "TiendanubeSyncStatus" NOT NULL DEFAULT 'RUNNING',
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
    CONSTRAINT "tiendanube_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_products" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(300) NOT NULL,
    "description" TEXT,
    "handle" VARCHAR(300),
    "published" BOOLEAN NOT NULL DEFAULT true,
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiendanube_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_product_variants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "sku" VARCHAR(160),
    "price" DECIMAL(14,2),
    "promotionalPrice" DECIMAL(14,2),
    "stock" INTEGER,
    "stockManaged" BOOLEAN NOT NULL DEFAULT false,
    "values" JSONB,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiendanube_product_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_customers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "name" VARCHAR(200),
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "totalSpent" DECIMAL(14,2),
    "currency" VARCHAR(8),
    "active" BOOLEAN,
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiendanube_customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "externalId" VARCHAR(64) NOT NULL,
    "orderNumber" VARCHAR(80),
    "status" VARCHAR(80) NOT NULL,
    "paymentStatus" VARCHAR(80),
    "shippingStatus" VARCHAR(80),
    "currency" VARCHAR(8),
    "total" DECIMAL(14,2),
    "customerExternalId" VARCHAR(64),
    "customerName" VARCHAR(200),
    "lineItems" JSONB,
    "remoteCreatedAt" TIMESTAMP(3),
    "remoteUpdatedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tiendanube_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tiendanube_webhook_receipts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storeId" VARCHAR(64) NOT NULL,
    "event" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(64),
    "dedupeKey" VARCHAR(64) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "lastError" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tiendanube_webhook_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tiendanube_connections_organizationId_key" ON "tiendanube_connections"("organizationId");
CREATE UNIQUE INDEX "tiendanube_connections_storeId_key" ON "tiendanube_connections"("storeId");
CREATE UNIQUE INDEX "tiendanube_connections_organizationId_id_key" ON "tiendanube_connections"("organizationId", "id");
CREATE INDEX "tiendanube_connections_organizationId_status_idx" ON "tiendanube_connections"("organizationId", "status");
CREATE UNIQUE INDEX "tiendanube_oauth_states_stateHash_key" ON "tiendanube_oauth_states"("stateHash");
CREATE INDEX "tiendanube_oauth_states_organizationId_expiresAt_idx" ON "tiendanube_oauth_states"("organizationId", "expiresAt");
CREATE UNIQUE INDEX "tiendanube_sync_runs_organizationId_idempotencyKey_key" ON "tiendanube_sync_runs"("organizationId", "idempotencyKey");
CREATE INDEX "tiendanube_sync_runs_organizationId_createdAt_idx" ON "tiendanube_sync_runs"("organizationId", "createdAt" DESC);
CREATE INDEX "tiendanube_sync_runs_connectionId_status_idx" ON "tiendanube_sync_runs"("connectionId", "status");
CREATE UNIQUE INDEX "tiendanube_products_organizationId_externalId_key" ON "tiendanube_products"("organizationId", "externalId");
CREATE UNIQUE INDEX "tiendanube_products_organizationId_id_key" ON "tiendanube_products"("organizationId", "id");
CREATE INDEX "tiendanube_products_organizationId_published_updatedAt_idx" ON "tiendanube_products"("organizationId", "published", "updatedAt" DESC);
CREATE UNIQUE INDEX "tiendanube_product_variants_organizationId_externalId_key" ON "tiendanube_product_variants"("organizationId", "externalId");
CREATE INDEX "tiendanube_product_variants_organizationId_productId_idx" ON "tiendanube_product_variants"("organizationId", "productId");
CREATE INDEX "tiendanube_product_variants_organizationId_sku_idx" ON "tiendanube_product_variants"("organizationId", "sku");
CREATE UNIQUE INDEX "tiendanube_customers_organizationId_externalId_key" ON "tiendanube_customers"("organizationId", "externalId");
CREATE INDEX "tiendanube_customers_organizationId_email_idx" ON "tiendanube_customers"("organizationId", "email");
CREATE UNIQUE INDEX "tiendanube_orders_organizationId_externalId_key" ON "tiendanube_orders"("organizationId", "externalId");
CREATE INDEX "tiendanube_orders_organizationId_orderNumber_idx" ON "tiendanube_orders"("organizationId", "orderNumber");
CREATE INDEX "tiendanube_orders_organizationId_status_updatedAt_idx" ON "tiendanube_orders"("organizationId", "status", "updatedAt" DESC);
CREATE INDEX "tiendanube_orders_organizationId_customerExternalId_idx" ON "tiendanube_orders"("organizationId", "customerExternalId");
CREATE UNIQUE INDEX "tiendanube_webhook_receipts_dedupeKey_key" ON "tiendanube_webhook_receipts"("dedupeKey");
CREATE INDEX "tiendanube_webhook_receipts_organizationId_createdAt_idx" ON "tiendanube_webhook_receipts"("organizationId", "createdAt" DESC);
CREATE INDEX "tiendanube_webhook_receipts_storeId_event_createdAt_idx" ON "tiendanube_webhook_receipts"("storeId", "event", "createdAt" DESC);

ALTER TABLE "tiendanube_connections" ADD CONSTRAINT "tiendanube_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_oauth_states" ADD CONSTRAINT "tiendanube_oauth_states_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_sync_runs" ADD CONSTRAINT "tiendanube_sync_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_sync_runs" ADD CONSTRAINT "tiendanube_sync_runs_organizationId_connectionId_fkey" FOREIGN KEY ("organizationId", "connectionId") REFERENCES "tiendanube_connections"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_products" ADD CONSTRAINT "tiendanube_products_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_product_variants" ADD CONSTRAINT "tiendanube_product_variants_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_product_variants" ADD CONSTRAINT "tiendanube_product_variants_organizationId_productId_fkey" FOREIGN KEY ("organizationId", "productId") REFERENCES "tiendanube_products"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_customers" ADD CONSTRAINT "tiendanube_customers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_orders" ADD CONSTRAINT "tiendanube_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tiendanube_webhook_receipts" ADD CONSTRAINT "tiendanube_webhook_receipts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
