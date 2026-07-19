import assert from "node:assert/strict";
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
