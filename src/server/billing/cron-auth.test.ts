import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeBillingCron,
  getBillingCronSecret,
  readPresentedSecret,
  secretsMatch,
} from "./cron-auth";

const SECRETO = "un-secreto-de-cron-suficientemente-largo";

function withSecret(value: string | undefined, run: () => void) {
  const previo = process.env.CRON_SECRET;
  if (value === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = value;
  try {
    run();
  } finally {
    if (previo === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previo;
  }
}

test("sin CRON_SECRET no hay secreto configurado", () => {
  withSecret(undefined, () => assert.equal(getBillingCronSecret(), null));
  withSecret("   ", () => assert.equal(getBillingCronSecret(), null));
});

test("un secreto demasiado corto se rechaza", () => {
  // Un valor corto es tan fácil de adivinar que conviene tratarlo como
  // "sin configurar" antes que darlo por bueno.
  withSecret("corto", () => assert.equal(getBillingCronSecret(), null));
});

test("un secreto válido se acepta y se recorta", () => {
  withSecret(`  ${SECRETO}  `, () =>
    assert.equal(getBillingCronSecret(), SECRETO)
  );
});

test("la comparación de secretos distingue valores distintos", () => {
  assert.equal(secretsMatch(SECRETO, SECRETO), true);
  assert.equal(secretsMatch(SECRETO, SECRETO + "x"), false);
  assert.equal(secretsMatch(SECRETO, ""), false);
});

test("el secreto se lee del Bearer o de la cabecera propia", () => {
  assert.equal(
    readPresentedSecret(new Headers({ authorization: `Bearer ${SECRETO}` })),
    SECRETO
  );
  assert.equal(
    readPresentedSecret(new Headers({ authorization: `bearer ${SECRETO}` })),
    SECRETO
  );
  assert.equal(
    readPresentedSecret(new Headers({ "x-cron-secret": SECRETO })),
    SECRETO
  );
  assert.equal(readPresentedSecret(new Headers()), "");
});

test("sin configurar responde 503 y no 401", () => {
  // Distinguir los dos casos evita perseguir un problema de credenciales
  // cuando en realidad falta la variable en el entorno.
  withSecret(undefined, () => {
    const result = authorizeBillingCron(
      new Headers({ authorization: `Bearer ${SECRETO}` })
    );
    assert.deepEqual(result, { ok: false, status: 503, error: "not_configured" });
  });
});

test("un secreto incorrecto o ausente no autoriza", () => {
  withSecret(SECRETO, () => {
    for (const headers of [
      new Headers(),
      new Headers({ authorization: "Bearer otro-secreto-cualquiera-largo" }),
      new Headers({ authorization: "Bearer " }),
      new Headers({ "x-cron-secret": "otro" }),
    ]) {
      const result = authorizeBillingCron(headers);
      assert.deepEqual(result, {
        ok: false,
        status: 401,
        error: "unauthorized",
      });
    }
  });
});

test("el secreto correcto autoriza", () => {
  withSecret(SECRETO, () => {
    assert.deepEqual(
      authorizeBillingCron(new Headers({ authorization: `Bearer ${SECRETO}` })),
      { ok: true }
    );
    assert.deepEqual(
      authorizeBillingCron(new Headers({ "x-cron-secret": SECRETO })),
      { ok: true }
    );
  });
});
