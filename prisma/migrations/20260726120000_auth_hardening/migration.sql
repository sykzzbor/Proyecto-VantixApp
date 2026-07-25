-- Endurecimiento de autenticación. Migración ADITIVA: solo crea tablas nuevas.
-- No altera ni borra columnas, índices ni datos existentes, así que se puede
-- aplicar en producción sin ventana de mantenimiento.

-- Almacenamiento compartido del rate limiting de Better Auth.
-- Reemplaza el contador en memoria, que en Vercel no limita nada porque cada
-- invocación serverless arranca con su propio mapa vacío.
CREATE TABLE "rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,
    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limits_key_key" ON "rate_limits"("key");

-- Contadores propios de la aplicación (reenvío de verificación, recuperación
-- de contraseña). La clave llega hasheada: nunca se persiste el correo ni la IP.
CREATE TABLE "auth_throttles" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "auth_throttles_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "auth_throttles_windowEnd_idx" ON "auth_throttles"("windowEnd");

-- Tokens de verificación de correo emitidos por VantixApp: aleatorios,
-- guardados solo como hash, de un solo uso y con vencimiento.
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_tokenHash_key" ON "email_verification_tokens"("tokenHash");
CREATE INDEX "email_verification_tokens_userId_idx" ON "email_verification_tokens"("userId");
CREATE INDEX "email_verification_tokens_expiresAt_idx" ON "email_verification_tokens"("expiresAt");

ALTER TABLE "email_verification_tokens"
    ADD CONSTRAINT "email_verification_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
