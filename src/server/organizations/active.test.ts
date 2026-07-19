import assert from "node:assert/strict";
import test from "node:test";
import { selectActiveMembership } from "./active";

const memberships = [
  {
    id: "member-a",
    organizationId: "org-a",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
  {
    id: "member-b",
    organizationId: "org-b",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  },
];

test("un usuario con varias organizaciones usa la selección activa", () => {
  assert.equal(
    selectActiveMembership(memberships, "org-b")?.organizationId,
    "org-b"
  );
});

test("una selección inválida cae de forma segura en la primera membresía", () => {
  assert.equal(
    selectActiveMembership(memberships, "org-ajena")?.organizationId,
    "org-a"
  );
  assert.equal(selectActiveMembership([], "org-a"), null);
});
