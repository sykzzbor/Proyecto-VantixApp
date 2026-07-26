import assert from "node:assert/strict";
import test from "node:test";
import {
  credentialRequirementFor,
  DELETE_ACCOUNT_PHRASE,
  isConfirmationPhraseValid,
  isSessionRecentEnough,
  planAccountDeletion,
  planOrganizationOnAccountDeletion,
} from "./account-deletion";

const t0 = new Date("2026-01-01T00:00:00Z");
const t1 = new Date("2026-02-01T00:00:00Z");
const t2 = new Date("2026-03-01T00:00:00Z");

// ============================================================
// Destino de cada organización
// ============================================================

test("si era la única persona, la organización se borra", () => {
  const plan = planOrganizationOnAccountDeletion({
    organizationId: "org1",
    leavingUserId: "u1",
    members: [{ userId: "u1", role: "OWNER", createdAt: t0 }],
  });
  assert.deepEqual(plan, { organizationId: "org1", action: "delete" });
});

test("si no era la dueña, solo se quita su membresía", () => {
  const plan = planOrganizationOnAccountDeletion({
    organizationId: "org1",
    leavingUserId: "u2",
    members: [
      { userId: "u1", role: "OWNER", createdAt: t0 },
      { userId: "u2", role: "AGENT", createdAt: t1 },
    ],
  });
  assert.deepEqual(plan, { organizationId: "org1", action: "leave" });
});

test("la dueña que se va con equipo le hereda la propiedad al ADMIN más antiguo", () => {
  const plan = planOrganizationOnAccountDeletion({
    organizationId: "org1",
    leavingUserId: "u1",
    members: [
      { userId: "u1", role: "OWNER", createdAt: t0 },
      { userId: "u3", role: "ADMIN", createdAt: t2 },
      { userId: "u2", role: "ADMIN", createdAt: t1 },
      { userId: "u4", role: "AGENT", createdAt: t0 },
    ],
  });
  assert.deepEqual(plan, {
    organizationId: "org1",
    action: "transfer",
    newOwnerUserId: "u2",
  });
});

test("sin ADMIN, hereda el integrante de mayor rol disponible", () => {
  const plan = planOrganizationOnAccountDeletion({
    organizationId: "org1",
    leavingUserId: "u1",
    members: [
      { userId: "u1", role: "OWNER", createdAt: t0 },
      { userId: "u2", role: "VIEWER", createdAt: t1 },
      { userId: "u3", role: "AGENT", createdAt: t2 },
    ],
  });
  // AGENT tiene prioridad sobre VIEWER aunque haya entrado después.
  assert.deepEqual(plan, {
    organizationId: "org1",
    action: "transfer",
    newOwnerUserId: "u3",
  });
});

test("si ya queda otra persona OWNER no hace falta transferir", () => {
  const plan = planOrganizationOnAccountDeletion({
    organizationId: "org1",
    leavingUserId: "u1",
    members: [
      { userId: "u1", role: "OWNER", createdAt: t0 },
      { userId: "u2", role: "OWNER", createdAt: t1 },
    ],
  });
  assert.deepEqual(plan, { organizationId: "org1", action: "leave" });
});

test("nunca se borra una organización que tenga a otra persona", () => {
  // Propiedad central: ninguna combinación puede terminar en "delete" si
  // queda alguien más adentro.
  const roles = ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const;
  for (const propio of roles) {
    for (const ajeno of roles) {
      const plan = planOrganizationOnAccountDeletion({
        organizationId: "org1",
        leavingUserId: "u1",
        members: [
          { userId: "u1", role: propio, createdAt: t0 },
          { userId: "u2", role: ajeno, createdAt: t1 },
        ],
      });
      assert.notEqual(
        plan.action,
        "delete",
        `no debería borrar con ${propio} saliendo y ${ajeno} adentro`
      );
    }
  }
});

// ============================================================
// Plan completo
// ============================================================

test("el plan combina borrar, salir y transferir", () => {
  const plan = planAccountDeletion({
    leavingUserId: "u1",
    organizations: [
      {
        organizationId: "sola",
        members: [{ userId: "u1", role: "OWNER", createdAt: t0 }],
      },
      {
        organizationId: "invitada",
        members: [
          { userId: "u9", role: "OWNER", createdAt: t0 },
          { userId: "u1", role: "AGENT", createdAt: t1 },
        ],
      },
      {
        organizationId: "con-equipo",
        members: [
          { userId: "u1", role: "OWNER", createdAt: t0 },
          { userId: "u5", role: "ADMIN", createdAt: t1 },
        ],
      },
    ],
  });

  assert.deepEqual(plan.organizationsToDelete, ["sola"]);
  assert.deepEqual(plan.organizationsToLeave, ["invitada"]);
  assert.deepEqual(plan.transfers, [
    { organizationId: "con-equipo", newOwnerUserId: "u5" },
  ]);
});

test("sin organizaciones el plan queda vacío", () => {
  const plan = planAccountDeletion({ leavingUserId: "u1", organizations: [] });
  assert.deepEqual(plan.organizationsToDelete, []);
  assert.deepEqual(plan.organizationsToLeave, []);
  assert.deepEqual(plan.transfers, []);
});

// ============================================================
// Confirmación y credenciales
// ============================================================

test("la frase de confirmación tolera espacios y minúsculas", () => {
  assert.equal(isConfirmationPhraseValid("ELIMINAR MI CUENTA", DELETE_ACCOUNT_PHRASE), true);
  assert.equal(isConfirmationPhraseValid("  eliminar mi cuenta  ", DELETE_ACCOUNT_PHRASE), true);
  assert.equal(isConfirmationPhraseValid("eliminar  mi   cuenta", DELETE_ACCOUNT_PHRASE), true);
});

test("una frase distinta no confirma", () => {
  for (const mala of ["", "eliminar", "borrar mi cuenta", "ELIMINAR MI CUENTA!", "si"]) {
    assert.equal(
      isConfirmationPhraseValid(mala, DELETE_ACCOUNT_PHRASE),
      false,
      `no debería aceptar ${JSON.stringify(mala)}`
    );
  }
});

test("con contraseña se pide contraseña; solo con Google se pide sesión reciente", () => {
  assert.equal(credentialRequirementFor({ hasCredentialAccount: true }), "password");
  assert.equal(credentialRequirementFor({ hasCredentialAccount: false }), "recent_session");
});

test("una sesión vieja no habilita el borrado", () => {
  const now = new Date("2026-07-01T12:00:00Z");
  assert.equal(
    isSessionRecentEnough({ sessionCreatedAt: new Date("2026-07-01T11:30:00Z"), now }),
    true
  );
  assert.equal(
    isSessionRecentEnough({ sessionCreatedAt: new Date("2026-07-01T10:00:00Z"), now }),
    false
  );
});
