import assert from "node:assert/strict";
import test from "node:test";
import { convertUsdToArs, roundArsCommercial } from "@/lib/plans-pricing";
import {
  getPlansExchangeRate,
  parseDolarHoyBlueSellRate,
  resetPlansExchangeRateCacheForTests,
} from "./exchange-rate";

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/html;charset=UTF-8" },
  });
}

test.beforeEach(() => {
  resetPlansExchangeRateCacheForTests();
});

test("convierte USD a ARS y redondea comercialmente al millar superior", () => {
  assert.equal(roundArsCommercial(135_450), 136_000);
  assert.equal(convertUsdToArs(90, 1_505), 136_000);
  assert.equal(convertUsdToArs(179, 1_505), 270_000);
});

test("extrae la venta de Dólar Blue sin depender de selectores CSS", () => {
  const rate = parseDolarHoyBlueSellRate(`
    <main><h1>Dólar Blue</h1><p>Compra $ 1.485,00</p><p>Venta $ 1.505,00</p></main>
  `);
  assert.equal(rate, 1_505);
  assert.equal(
    parseDolarHoyBlueSellRate(
      "<h1>D&#xF3;lar Blue</h1><p>1510,00 Compra</p><p>1530,00 Venta</p>"
    ),
    1_530
  );
});

test("rechaza una respuesta inválida del proveedor", async () => {
  const result = await getPlansExchangeRate({
    fetchImpl: async () => htmlResponse("<p>contenido inesperado</p>"),
    env: {},
    now: Date.UTC(2026, 6, 18, 12),
  });

  assert.deepEqual(result, { rate: null, updatedAt: null, source: null });
});

test("corta por timeout y devuelve una respuesta pública sin errores internos", async () => {
  const result = await getPlansExchangeRate({
    fetchImpl: (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("token-interno", "AbortError"))
        );
      }),
    env: {},
    timeoutMs: 5,
  });

  assert.deepEqual(result, { rate: null, updatedAt: null, source: null });
  assert.equal(JSON.stringify(result).includes("token-interno"), false);
});

test("usa la variable configurada cuando DolarHoy no está disponible", async () => {
  const result = await getPlansExchangeRate({
    fetchImpl: async () => htmlResponse("falló", 503),
    env: {
      PLANS_USD_ARS_RATE: "1500",
      PLANS_USD_ARS_UPDATED_AT: "2026-07-18T12:00:00.000Z",
    },
  });

  assert.deepEqual(result, {
    rate: 1_500,
    updatedAt: "2026-07-18T12:00:00.000Z",
    source: "Configuración",
  });
});

test("conserva el último valor válido después del fallback configurado", async () => {
  const first = await getPlansExchangeRate({
    fetchImpl: async () =>
      htmlResponse("<h1>Dólar Blue</h1><p>Venta $ 1.510,00</p>"),
    env: {},
    now: 1_000,
  });
  assert.equal(first.source, "DolarHoy");

  const stale = await getPlansExchangeRate({
    fetchImpl: async () => htmlResponse("falló", 503),
    env: {},
    now: 1_000 + 31 * 60 * 1_000,
  });
  assert.deepEqual(stale, { ...first, source: "Último valor válido" });
});

test("si no existe ninguna cotización mantiene ARS no disponible", async () => {
  const result = await getPlansExchangeRate({
    fetchImpl: async () => {
      throw new Error("detalle privado del proveedor");
    },
    env: { PLANS_USD_ARS_RATE: "no-es-un-numero" },
  });

  assert.deepEqual(result, { rate: null, updatedAt: null, source: null });
  assert.equal(JSON.stringify(result).includes("detalle privado"), false);
});
