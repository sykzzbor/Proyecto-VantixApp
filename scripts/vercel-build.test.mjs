import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isProductionVercelBuild,
  resolveMigrationDatabaseUrl,
  sanitizeCommandOutput,
} from "./vercel-build.mjs";

test("solo Production de Vercel habilita migrate deploy", () => {
  assert.equal(
    isProductionVercelBuild({ VERCEL: "1", VERCEL_ENV: "production" }),
    true
  );
  assert.equal(
    isProductionVercelBuild({ VERCEL: "1", VERCEL_ENV: "preview" }),
    false
  );
  assert.equal(isProductionVercelBuild({ NODE_ENV: "production" }), false);
});

test("prioriza DIRECT_URL y permite mapear variables alternativas", () => {
  const direct = "postgresql://user:password@db.example.com:5432/app";
  const selected = resolveMigrationDatabaseUrl({
    DIRECT_URL: direct,
    DATABASE_URL: "postgresql://user:password@other.example.com:5432/app",
  });
  assert.equal(selected.name, "DIRECT_URL");
  assert.equal(selected.value, direct);

  assert.equal(
    resolveMigrationDatabaseUrl({
      PRISMA_DATABASE_URL:
        "postgresql://user:password@prisma.example.com:5432/app",
    }).name,
    "PRISMA_DATABASE_URL"
  );
});

test("rechaza localhost, loopback y hosts locales sin exponer la URL", () => {
  for (const hostname of [
    "localhost",
    "127.0.0.1",
    "127.20.30.40",
    "[::1]",
    "postgres.local",
  ]) {
    const secret = `password-${hostname}`;
    assert.throws(
      () =>
        resolveMigrationDatabaseUrl({
          DATABASE_URL: `postgresql://user:${secret}@${hostname}:5432/app`,
        }),
      (error) => {
        assert.match(error.message, /host local rechazado/);
        assert.equal(error.message.includes(secret), false);
        return true;
      }
    );
  }
});

test("sanitiza URLs y hosts de la salida de Prisma", () => {
  const raw =
    'Datasource at "db.internal:5432" using postgresql://user:secret@db.internal/app';
  const sanitized = sanitizeCommandOutput(raw);
  assert.equal(sanitized.includes("secret"), false);
  assert.equal(sanitized.includes("db.internal"), false);
  assert.match(sanitized, /<redacted-database-url>/);
  assert.match(sanitized, /<redacted-host>/);
});
