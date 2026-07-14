import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DATABASE_CANDIDATES = [
  "DIRECT_URL",
  "DATABASE_URL",
  "PRISMA_DATABASE_URL",
];

const LOCAL_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "::",
  "::1",
  "host.docker.internal",
]);

export function isProductionVercelBuild(env) {
  return env.VERCEL === "1" && env.VERCEL_ENV === "production";
}

function isLocalDatabaseHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return (
    LOCAL_HOSTS.has(host) ||
    host.startsWith("127.") ||
    host.startsWith("::ffff:127.") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  );
}

export function resolveMigrationDatabaseUrl(env) {
  const rejected = [];

  for (const name of DATABASE_CANDIDATES) {
    const value = env[name]?.trim();
    if (!value) continue;

    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      rejected.push(`${name}: formato inválido`);
      continue;
    }

    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      rejected.push(`${name}: protocolo no compatible con Prisma Migrate`);
      continue;
    }

    if (isLocalDatabaseHost(parsed.hostname)) {
      rejected.push(`${name}: host local rechazado`);
      continue;
    }

    return { name, value };
  }

  const reason = rejected.length > 0 ? ` (${rejected.join("; ")})` : "";
  throw new Error(
    `No hay una conexión PostgreSQL remota segura para ejecutar migraciones${reason}.`
  );
}

export function sanitizeCommandOutput(output) {
  return output
    .replace(
      /(?:postgresql|postgres|prisma\+postgres):\/\/[^\s"']+/gi,
      "<redacted-database-url>"
    )
    .replace(/at "[^"]+"/g, 'at "<redacted-host>"');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: options.env ?? process.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (options.capture) {
    const output = sanitizeCommandOutput(
      `${result.stdout ?? ""}${result.stderr ?? ""}`
    ).trim();
    if (output) console.log(output);
  }

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} terminó con código ${result.status ?? "desconocido"}.`);
  }
}

function runProductionMigration() {
  const connection = resolveMigrationDatabaseUrl(process.env);
  console.log(
    `[VantixApp build] Ejecutando prisma migrate deploy con ${connection.name}; credenciales ocultas.`
  );

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  run(npx, ["prisma", "migrate", "deploy"], {
    capture: true,
    env: {
      ...process.env,
      // El mapeo existe únicamente durante el subproceso de Prisma Migrate.
      DATABASE_URL: connection.value,
    },
  });
}

export function main() {
  if (isProductionVercelBuild(process.env)) {
    runProductionMigration();
  } else {
    console.log(
      "[VantixApp build] Migraciones omitidas: no es un build Production de Vercel."
    );
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  run(npm, ["run", "build:next"]);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (entrypoint === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(
      "[VantixApp build] Build detenido de forma segura:",
      error instanceof Error ? error.message : "error desconocido"
    );
    process.exitCode = 1;
  }
}
