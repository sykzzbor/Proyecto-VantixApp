import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContentSecurityPolicy,
  getSecurityHeaders,
} from "./security-headers";

function headerMap(development = false): Record<string, string> {
  return Object.fromEntries(
    getSecurityHeaders({ development }).map((h) => [h.key, h.value])
  );
}

test("la app no se puede incrustar en un iframe", () => {
  const headers = headerMap();
  assert.match(headers["Content-Security-Policy"]!, /frame-ancestors 'none'/);
  assert.equal(headers["X-Frame-Options"], "DENY");
});

test("no se puede cambiar la URL base ni mandar formularios afuera", () => {
  const csp = buildContentSecurityPolicy();
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);
  assert.match(csp, /object-src 'none'/);
});

test("HSTS solo en producción", () => {
  // En desarrollo se sirve por HTTP: fijar HSTS dejaría el navegador
  // pegado a HTTPS en localhost para todos los proyectos.
  assert.ok(headerMap(false)["Strict-Transport-Security"]);
  assert.equal(headerMap(true)["Strict-Transport-Security"], undefined);
});

test("HSTS incluye subdominios y un plazo largo", () => {
  const hsts = headerMap(false)["Strict-Transport-Security"]!;
  assert.match(hsts, /includeSubDomains/);
  const maxAge = Number(hsts.match(/max-age=(\d+)/)?.[1] ?? 0);
  assert.ok(maxAge >= 31536000, "debería ser de al menos un año");
});

test("no se filtra la ruta completa a sitios externos", () => {
  assert.equal(
    headerMap()["Referrer-Policy"],
    "strict-origin-when-cross-origin"
  );
});

test("se bloquean permisos del navegador que la app no usa", () => {
  const permissions = headerMap()["Permissions-Policy"]!;
  for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
    assert.match(permissions, new RegExp(`${feature}=\\(\\)`));
  }
});

test("los archivos subidos no se reinterpretan por contenido", () => {
  assert.equal(headerMap()["X-Content-Type-Options"], "nosniff");
});

test("las imágenes admiten data URL y HTTPS", () => {
  // Los avatares se guardan como data URL y las fotos de Google llegan por
  // HTTPS: si esto se cierra, se rompen las fotos de perfil.
  const csp = buildContentSecurityPolicy();
  assert.match(csp, /img-src [^;]*data:/);
  assert.match(csp, /img-src [^;]*https:/);
});

test("desarrollo habilita lo que necesita Turbopack, producción no", () => {
  const dev = buildContentSecurityPolicy({ development: true });
  const prod = buildContentSecurityPolicy({ development: false });

  assert.match(dev, /script-src [^;]*'unsafe-eval'/);
  assert.match(dev, /connect-src [^;]*ws:/);

  // En producción no hay eval ni websockets sueltos.
  assert.equal(/script-src [^;]*'unsafe-eval'/.test(prod), false);
  assert.equal(/connect-src [^;]*ws:/.test(prod), false);
  assert.match(prod, /upgrade-insecure-requests/);
});

test("la política no queda vacía ni malformada", () => {
  const csp = buildContentSecurityPolicy();
  assert.ok(csp.length > 100);
  assert.equal(csp.includes(";;"), false);
  assert.match(csp, /^default-src 'self'/);
});
