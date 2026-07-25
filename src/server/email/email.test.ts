import assert from "node:assert/strict";
import test from "node:test";
import { getEmailProvider, isEmailDeliveryConfigured, maskEmail } from "./send";
import {
  emailChangedTemplate,
  escapeHtml,
  existingAccountSignUpTemplate,
  newSignInTemplate,
  passwordChangedTemplate,
  resendVerificationTemplate,
  resetPasswordTemplate,
  SECURITY_NOTICE,
  verifyEmailTemplate,
} from "./templates";

function withEnv(vars: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

// ============================================================
// Selección de proveedor
// ============================================================

test("con RESEND_API_KEY el proveedor es Resend", () => {
  withEnv(
    { EMAIL_PROVIDER: undefined, RESEND_API_KEY: "re_test_123" },
    () => {
      assert.equal(getEmailProvider(), "resend");
      assert.equal(isEmailDeliveryConfigured(), true);
    }
  );
});

test("EMAIL_PROVIDER explícito manda sobre la detección automática", () => {
  withEnv({ EMAIL_PROVIDER: "console", RESEND_API_KEY: "re_test_123" }, () => {
    assert.equal(getEmailProvider(), "console");
  });
});

test("sin configurar, en producción no hay entrega silenciosa", () => {
  withEnv(
    {
      EMAIL_PROVIDER: undefined,
      RESEND_API_KEY: undefined,
      NODE_ENV: "production",
    },
    () => {
      assert.equal(getEmailProvider(), "none");
      // Falso obliga a que el despliegue se dé cuenta antes de abrir registro.
      assert.equal(isEmailDeliveryConfigured(), false);
    }
  );
});

test("EMAIL_PROVIDER=resend sin API key no se considera configurado", () => {
  withEnv({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: undefined }, () => {
    assert.equal(isEmailDeliveryConfigured(), false);
  });
});

test("el correo se enmascara en los logs", () => {
  assert.equal(maskEmail("martina@empresa.com"), "ma***@empresa.com");
  assert.equal(maskEmail("a@b.com"), "a***@b.com");
  assert.equal(maskEmail("sin-arroba"), "***");
});

// ============================================================
// Plantillas
// ============================================================

const TEMPLATES = [
  ["verificación", verifyEmailTemplate({ name: "Ana", url: "https://vantixapp.com.ar/verificar-email?token=abc", expiresInMinutes: 30 })],
  ["reenvío", resendVerificationTemplate({ name: "Ana", url: "https://vantixapp.com.ar/verificar-email?token=abc", expiresInMinutes: 30 })],
  ["recuperación", resetPasswordTemplate({ name: "Ana", url: "https://vantixapp.com.ar/restablecer-password?token=abc", expiresInMinutes: 30 })],
  ["contraseña cambiada", passwordChangedTemplate({ name: "Ana", changedAt: new Date("2026-07-24T12:00:00Z") })],
  ["inicio sospechoso", newSignInTemplate({ name: "Ana", signedInAt: new Date("2026-07-24T12:00:00Z"), device: "Chrome · Mac" })],
  ["correo cambiado", emailChangedTemplate({ name: "Ana", newEmail: "nueva@empresa.com", changedAt: new Date("2026-07-24T12:00:00Z") })],
  ["registro duplicado", existingAccountSignUpTemplate({ name: "Ana" })],
] as const;

test("todas las plantillas llevan asunto, HTML y texto plano", () => {
  for (const [nombre, message] of TEMPLATES) {
    assert.ok(message.subject.length > 0, `${nombre}: falta asunto`);
    assert.ok(message.html.includes("<!doctype html>"), `${nombre}: HTML inválido`);
    assert.ok(message.text.length > 0, `${nombre}: falta texto plano`);
  }
});

test("todas llevan el aviso de seguridad", () => {
  for (const [nombre, message] of TEMPLATES) {
    assert.ok(message.html.includes(SECURITY_NOTICE), `${nombre}: falta en HTML`);
    assert.ok(message.text.includes(SECURITY_NOTICE), `${nombre}: falta en texto`);
  }
});

test("todos los enlaces usan el dominio canónico", () => {
  for (const [nombre, message] of TEMPLATES) {
    const urls = message.html.match(/https?:\/\/[^"'\s<]+/g) ?? [];
    assert.ok(urls.length > 0, `${nombre}: sin enlaces`);
    for (const url of urls) {
      assert.ok(
        url.startsWith("https://vantixapp.com.ar"),
        `${nombre}: enlace fuera del dominio canónico → ${url}`
      );
      assert.equal(url.includes("localhost"), false, `${nombre}: localhost`);
      assert.equal(
        url.includes("www.vantixapp"),
        false,
        `${nombre}: www no es la URL canónica`
      );
      assert.equal(
        url.includes("vercel.app"),
        false,
        `${nombre}: dominio viejo`
      );
    }
  }
});

test("las plantillas son responsive y declaran viewport", () => {
  for (const [nombre, message] of TEMPLATES) {
    assert.ok(message.html.includes("width=device-width"), `${nombre}: sin viewport`);
    assert.ok(message.html.includes("max-width:560px"), `${nombre}: sin ancho máximo`);
  }
});

test("el nombre del usuario se escapa para que no inyecte HTML", () => {
  const message = verifyEmailTemplate({
    name: '<script>alert(1)</script>',
    url: "https://vantixapp.com.ar/verificar-email?token=abc",
    expiresInMinutes: 30,
  });
  assert.equal(message.html.includes("<script>"), false);
  assert.equal(escapeHtml("<b>&\"'"), "&lt;b&gt;&amp;&quot;&#39;");
});

test("el aviso de inicio de sesión no expone la IP ni el user agent crudo", () => {
  const message = newSignInTemplate({
    name: "Ana",
    signedInAt: new Date("2026-07-24T12:00:00Z"),
    device: "Chrome · Mac",
  });
  assert.equal(message.html.includes("Mozilla/"), false);
  assert.equal(/\d+\.\d+\.\d+\.\d+/.test(message.text), false);
  assert.ok(message.text.includes("Chrome · Mac"));
});

test("los correos de aviso no incluyen tokens", () => {
  for (const [nombre, message] of [
    ["contraseña cambiada", passwordChangedTemplate({ name: "Ana", changedAt: new Date() })],
    ["inicio sospechoso", newSignInTemplate({ name: "Ana", signedInAt: new Date(), device: null })],
  ] as const) {
    assert.equal(message.html.includes("token="), false, `${nombre}: lleva token`);
  }
});
