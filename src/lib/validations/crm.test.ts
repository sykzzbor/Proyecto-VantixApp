import assert from "node:assert/strict";
import test from "node:test";
import {
  createNoteSchema,
  createTagSchema,
  tagColorSchema,
  tagNameSchema,
  updateTagSchema,
} from "./crm";

test("el nombre de la etiqueta se recorta y valida", () => {
  assert.equal(tagNameSchema.parse("  Urgente  "), "Urgente");
  assert.equal(tagNameSchema.safeParse("a").success, false);
  assert.equal(tagNameSchema.safeParse("x".repeat(41)).success, false);
});

test("el nombre no admite < ni >", () => {
  // La etiqueta se muestra en muchas pantallas: cerrar la puerta desde la
  // validación evita depender de que todas escapen bien.
  assert.equal(tagNameSchema.safeParse("<script>").success, false);
  assert.equal(tagNameSchema.safeParse("Cliente <VIP>").success, false);
});

test("el color solo acepta #rrggbb", () => {
  assert.equal(tagColorSchema.parse("#3b82f6"), "#3b82f6");
  assert.equal(tagColorSchema.parse("#ABCDEF"), "#ABCDEF");
  for (const malo of [
    "rojo",
    "#fff",
    "#3b82f",
    "javascript:alert(1)",
    "url(x)",
    "#3b82f6; background:url(x)",
  ]) {
    assert.equal(
      tagColorSchema.safeParse(malo).success,
      false,
      `no debería aceptar ${JSON.stringify(malo)}`
    );
  }
});

test("crear una etiqueta exige nombre y color", () => {
  assert.equal(
    createTagSchema.safeParse({ name: "Urgente", color: "#ef4444" }).success,
    true
  );
  assert.equal(createTagSchema.safeParse({ name: "Urgente" }).success, false);
  assert.equal(
    createTagSchema.safeParse({ name: "", color: "#ef4444" }).success,
    false
  );
});

test("editar una etiqueta exige el id", () => {
  assert.equal(
    updateTagSchema.safeParse({ name: "Urgente", color: "#ef4444" }).success,
    false
  );
  assert.equal(
    updateTagSchema.safeParse({ id: "t1", name: "Urgente", color: "#ef4444" })
      .success,
    true
  );
});

test("la nota no puede estar vacía ni ser enorme", () => {
  assert.equal(
    createNoteSchema.safeParse({ conversationId: "c1", body: "  " }).success,
    false
  );
  assert.equal(
    createNoteSchema.safeParse({ conversationId: "c1", body: "x".repeat(2001) })
      .success,
    false
  );
  const ok = createNoteSchema.parse({
    conversationId: "c1",
    body: "  El cliente pidió factura A.  ",
  });
  assert.equal(ok.body, "El cliente pidió factura A.");
});

test("la nota exige una conversación", () => {
  assert.equal(createNoteSchema.safeParse({ body: "hola" }).success, false);
});
