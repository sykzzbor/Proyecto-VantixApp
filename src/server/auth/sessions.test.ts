import assert from "node:assert/strict";
import test from "node:test";
import {
  describeBrowser,
  describeOs,
  maskIp,
  summarizeSessions,
  type RawSession,
} from "./sessions";

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0",
  firefoxLinux:
    "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0",
};

test("se reconoce el navegador", () => {
  assert.equal(describeBrowser(UA.chromeMac), "Chrome");
  assert.equal(describeBrowser(UA.safariIphone), "Safari");
  assert.equal(describeBrowser(UA.firefoxLinux), "Firefox");
  assert.equal(describeBrowser(null), "Navegador desconocido");
});

test("Edge no se confunde con Chrome", () => {
  // Edge incluye "Chrome/120" en su user agent: si el orden estuviera mal,
  // todas las sesiones de Edge dirían Chrome.
  assert.equal(describeBrowser(UA.edgeWindows), "Edge");
});

test("se reconoce el sistema operativo", () => {
  assert.equal(describeOs(UA.chromeMac), "macOS");
  assert.equal(describeOs(UA.safariIphone), "iOS");
  assert.equal(describeOs(UA.edgeWindows), "Windows");
  assert.equal(describeOs(UA.firefoxLinux), "Linux");
  assert.equal(describeOs(null), "Sistema desconocido");
});

test("la IP se muestra recortada, nunca completa", () => {
  assert.equal(maskIp("181.44.23.190"), "181.44.x.x");
  assert.equal(maskIp("2001:db8:85a3:0:0:8a2e:370:7334"), "2001:db8:x:x");
  assert.equal(maskIp(null), null);
  assert.equal(maskIp("  "), null);
  assert.equal(maskIp("no-es-una-ip"), null);
});

function raw(overrides: Partial<RawSession> = {}): RawSession {
  return {
    id: "s1",
    token: "tok-1",
    userAgent: UA.chromeMac,
    ipAddress: "181.44.23.190",
    createdAt: new Date("2026-07-01T10:00:00Z"),
    updatedAt: new Date("2026-07-02T10:00:00Z"),
    expiresAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
}

test("el token nunca sale en el resumen", () => {
  const [session] = summarizeSessions([raw()], "tok-1");
  assert.equal(JSON.stringify(session).includes("tok-1"), false);
});

test("la sesión actual queda marcada y va primero", () => {
  const resumen = summarizeSessions(
    [
      raw({ id: "otra", token: "tok-2", updatedAt: new Date("2026-07-05T10:00:00Z") }),
      raw({ id: "actual", token: "tok-1" }),
    ],
    "tok-1"
  );
  assert.equal(resumen[0]!.id, "actual");
  assert.equal(resumen[0]!.current, true);
  assert.equal(resumen[1]!.current, false);
});

test("las demás se ordenan por actividad más reciente", () => {
  const resumen = summarizeSessions(
    [
      raw({ id: "vieja", token: "a", updatedAt: new Date("2026-07-01T10:00:00Z") }),
      raw({ id: "nueva", token: "b", updatedAt: new Date("2026-07-09T10:00:00Z") }),
    ],
    "actual-no-listada"
  );
  assert.deepEqual(resumen.map((s) => s.id), ["nueva", "vieja"]);
});

test("un dispositivo sin datos se describe como desconocido", () => {
  const [session] = summarizeSessions(
    [raw({ userAgent: null, ipAddress: null })],
    "otro"
  );
  assert.equal(session!.deviceLabel, "Dispositivo desconocido");
  assert.equal(session!.approximateIp, null);
});

test("el resumen expone solo campos aptos para la pantalla", () => {
  const [session] = summarizeSessions([raw()], "tok-1");
  assert.deepEqual(Object.keys(session!).sort(), [
    "approximateIp",
    "browser",
    "createdAt",
    "current",
    "deviceLabel",
    "expiresAt",
    "id",
    "lastActiveAt",
    "os",
  ]);
});
