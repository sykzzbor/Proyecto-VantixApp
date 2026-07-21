import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ZodError } from "zod";
import {
  createInitialOrganization,
  ONBOARDING_NEXT_PATH,
  toPublicOnboardingError,
  type InitialOrganizationDependencies,
  type InitialOrganizationTransaction,
} from "./onboarding";

type MemoryUser = { id: string; provider: "google" | "credential" };
type MemoryOrganization = { id: string; name: string; slug: string };

function memoryDependencies(options?: {
  users?: MemoryUser[];
  existingMembership?: { userId: string; organizationId: string };
  /** Prueba previa de la cuenta: simula que el usuario ya usó sus 5 días. */
  existingUserTrial?: { userId: string; startedAt: Date; endsAt: Date };
  failCreate?: boolean;
}) {
  const users = options?.users ?? [
    { id: "google-user", provider: "google" },
    { id: "email-user", provider: "credential" },
  ];
  const organizations: MemoryOrganization[] = [];
  const memberships: Array<{ userId: string; organizationId: string; role: string }> = [];
  const businessProfiles: Array<{ organizationId: string; name: string }> = [];
  const agentSettings: string[] = [];
  const subscriptions: Array<{
    organizationId: string;
    startedAt: Date;
    endsAt: Date;
  }> = [];
  const activeOrganizations: Array<{ organizationId: string; userId: string }> = [];
  const userTrials: Array<{ userId: string; startedAt: Date; endsAt: Date }> =
    options?.existingUserTrial ? [options.existingUserTrial] : [];
  let id = 0;
  let queue = Promise.resolve();

  if (options?.existingMembership) {
    organizations.push({
      id: options.existingMembership.organizationId,
      name: "Organización existente",
      slug: "organizacion-existente",
    });
    memberships.push({ ...options.existingMembership, role: "OWNER" });
  }

  const transaction: InitialOrganizationTransaction = {
    async userExists(userId) {
      return users.some((user) => user.id === userId);
    },
    async findMembership(userId) {
      const membership = memberships.find((item) => item.userId === userId);
      const organization = organizations.find(
        (item) => item.id === membership?.organizationId
      );
      return organization
        ? { id: organization.id, name: organization.name }
        : null;
    },
    async createOrganization(input) {
      if (options?.failCreate) throw new Error("database connection details");
      const organization = { id: `org-${++id}`, ...input };
      organizations.push(organization);
      return { id: organization.id, name: organization.name };
    },
    async createOwnerMembership(input) {
      memberships.push({ ...input, role: "OWNER" });
    },
    async createBusinessProfile(input) {
      businessProfiles.push(input);
    },
    async createAgentSettings(organizationId) {
      agentSettings.push(organizationId);
    },
    async createTrialSubscription(input) {
      subscriptions.push(input);
    },
    async findUserTrial(userId) {
      const trial = userTrials.find((item) => item.userId === userId);
      return trial ? { startedAt: trial.startedAt, endsAt: trial.endsAt } : null;
    },
    async createUserTrial(input) {
      userTrials.push(input);
    },
    async setActiveOrganization(input) {
      activeOrganizations.push(input);
    },
  };

  const dependencies: InitialOrganizationDependencies = {
    async runExclusive(_userId, operation) {
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation(transaction);
      } finally {
        release();
      }
    },
  };

  return {
    dependencies,
    organizations,
    memberships,
    businessProfiles,
    agentSettings,
    subscriptions,
    activeOrganizations,
    userTrials,
  };
}

test("un usuario de Google crea su primera organización como OWNER", async () => {
  const memory = memoryDependencies();
  const result = await createInitialOrganization(
    "google-user",
    { name: "  Estudio Google  " },
    memory.dependencies
  );

  assert.equal(result.created, true);
  assert.equal(result.organization.name, "Estudio Google");
  assert.equal(memory.memberships[0]?.role, "OWNER");
  assert.equal(memory.businessProfiles[0]?.name, "Estudio Google");
  assert.deepEqual(memory.agentSettings, [result.organization.id]);
  assert.equal(memory.subscriptions.length, 1);
  assert.equal(
    memory.subscriptions[0]!.endsAt.getTime() -
      memory.subscriptions[0]!.startedAt.getTime(),
    5 * 24 * 60 * 60 * 1_000
  );
  assert.deepEqual(memory.activeOrganizations, [
    { organizationId: result.organization.id, userId: "google-user" },
  ]);
  // La prueba queda registrada a nivel CUENTA, no de la organización.
  assert.equal(memory.userTrials.length, 1);
  assert.equal(memory.userTrials[0]?.userId, "google-user");
});

test("la prueba es única por cuenta: un segundo negocio hereda la ventana original", async () => {
  const startedAt = new Date("2026-07-01T00:00:00.000Z");
  const endsAt = new Date("2026-07-06T00:00:00.000Z");
  const memory = memoryDependencies({
    // La cuenta ya usó su prueba hace semanas.
    existingUserTrial: { userId: "google-user", startedAt, endsAt },
  });

  const result = await createInitialOrganization(
    "google-user",
    { name: "Segundo Negocio" },
    memory.dependencies
  );

  assert.equal(result.created, true);
  // La suscripción nueva NO estrena 5 días: reutiliza la ventana ya vencida.
  assert.equal(memory.subscriptions.length, 1);
  assert.equal(memory.subscriptions[0]!.startedAt.getTime(), startedAt.getTime());
  assert.equal(memory.subscriptions[0]!.endsAt.getTime(), endsAt.getTime());
  // Y no se creó una segunda prueba para la cuenta.
  assert.equal(memory.userTrials.length, 1);
});

test("la migración registra la prueba histórica de cada OWNER sin sobrescribirla", () => {
  const sql = readFileSync(
    new URL(
      "../../../prisma/migrations/20260721200000_user_trial_backfill/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /INSERT INTO "user_trials"/);
  assert.match(sql, /WHERE om\."role" = 'OWNER'/);
  assert.match(sql, /DISTINCT ON \(om\."userId"\)/);
  assert.match(sql, /ON CONFLICT \("userId"\) DO NOTHING/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE)\b/i);
});

test("la prueba no se reinicia al volver a entrar sin negocios nuevos", async () => {
  const memory = memoryDependencies();
  const first = await createInitialOrganization(
    "email-user",
    { name: "Negocio Uno" },
    memory.dependencies
  );
  const trialAfterFirst = memory.userTrials[0]!;

  // Segundo intento del mismo usuario: recupera la organización existente.
  const second = await createInitialOrganization(
    "email-user",
    { name: "Negocio Uno" },
    memory.dependencies
  );

  assert.equal(second.created, false);
  assert.equal(second.organization.id, first.organization.id);
  assert.equal(memory.userTrials.length, 1);
  assert.equal(
    memory.userTrials[0]!.endsAt.getTime(),
    trialAfterFirst.endsAt.getTime()
  );
});

test("un usuario con email crea su primera organización", async () => {
  const memory = memoryDependencies();
  const result = await createInitialOrganization(
    "email-user",
    { name: "Negocio Email" },
    memory.dependencies
  );

  assert.equal(result.created, true);
  assert.equal(memory.memberships[0]?.userId, "email-user");
});

test("rechaza un nombre vacío después de recortar espacios", async () => {
  const memory = memoryDependencies();
  await assert.rejects(
    createInitialOrganization("google-user", { name: "   " }, memory.dependencies),
    ZodError
  );
  assert.equal(memory.organizations.length, 0);
});

test("dos envíos concurrentes crean una sola organización", async () => {
  const memory = memoryDependencies();
  const [first, second] = await Promise.all([
    createInitialOrganization("google-user", { name: "Doble clic" }, memory.dependencies),
    createInitialOrganization("google-user", { name: "Doble clic" }, memory.dependencies),
  ]);

  assert.equal(memory.organizations.length, 1);
  assert.equal(memory.memberships.length, 1);
  assert.equal(memory.subscriptions.length, 1);
  assert.equal(first.organization.id, second.organization.id);
  assert.deepEqual([first.created, second.created].sort(), [false, true]);
});

test("recupera una organización ya creada y su membresía sin duplicar", async () => {
  const memory = memoryDependencies({
    existingMembership: { userId: "google-user", organizationId: "org-existing" },
  });
  const result = await createInitialOrganization(
    "google-user",
    { name: "Nombre ignorado" },
    memory.dependencies
  );

  assert.equal(result.created, false);
  assert.equal(result.organization.id, "org-existing");
  assert.equal(memory.organizations.length, 1);
  assert.equal(memory.memberships.length, 1);
  assert.equal(memory.subscriptions.length, 0);
});

test("rechaza una sesión cuyo usuario ya no existe", async () => {
  const memory = memoryDependencies({ users: [] });
  await assert.rejects(
    createInitialOrganization("missing-user", { name: "Negocio" }, memory.dependencies),
    /No encontramos tu usuario/
  );
});

test("propaga el fallo interno para que la acción lo sanitice", async () => {
  const memory = memoryDependencies({ failCreate: true });
  await assert.rejects(
    createInitialOrganization("google-user", { name: "Negocio" }, memory.dependencies),
    /database connection details/
  );
  assert.equal(memory.memberships.length, 0);
});

test("un error del servidor se convierte en un mensaje público sin detalles internos", () => {
  const publicError = toPublicOnboardingError(
    new Error("password=secret postgresql://user:password@database.local/app")
  );
  assert.equal(
    publicError,
    "No pudimos crear el negocio. Intentá nuevamente en unos segundos."
  );
  assert.equal(publicError.includes("password"), false);
  assert.equal(publicError.includes("postgresql"), false);
});

test("el siguiente paso del onboarding es Integraciones", () => {
  assert.equal(ONBOARDING_NEXT_PATH, "/dashboard/integraciones");
});
