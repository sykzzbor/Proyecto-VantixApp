import assert from "node:assert/strict";
import test from "node:test";
import {
  findPasswordIssue,
  MIN_PASSWORD_LENGTH,
  validatePassword,
} from "./password-policy";
import {
  decideVerificationToken,
  generateVerificationToken,
  hashVerificationToken,
  verificationHashesMatch,
  EMAIL_VERIFICATION_TTL_MS,
} from "./verification-token";
import { decideThrottle, throttleKey } from "./throttle";
import { resolveClientIp, clientIpKey } from "./request-ip";
import { describeUserAgent } from "./notifications";

// ============================================================
// Política de contraseñas
// ============================================================

test("rechaza contraseñas cortas, comunes o sin variedad", () => {
  assert.equal(findPasswordIssue("Abc12345"), "too_short");
  assert.equal(findPasswordIssue("password123"), "too_common");
  assert.equal(findPasswordIssue("solamenteletras"), "needs_variety");
  assert.equal(findPasswordIssue("1234567890123"), "needs_variety");
  assert.equal(findPasswordIssue("aaaaaaaaa1"), "too_common");
});

test("rechaza una contraseña que contiene el correo", () => {
  assert.equal(
    findPasswordIssue("martina2026!", "martina@empresa.com"),
    "contains_email"
  );
});

test("acepta una contraseña razonable", () => {
  assert.equal(findPasswordIssue("brisa-tormenta-42", "ana@empresa.com"), null);
  assert.equal(validatePassword("brisa-tormenta-42").ok, true);
});

test("el mínimo es más exigente que el de Better Auth por defecto", () => {
  assert.ok(MIN_PASSWORD_LENGTH >= 10);
});

test("el mensaje de error no revela la regla interna que falló", () => {
  const result = validatePassword("password123");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.message.includes("COMMON_PASSWORDS"), false);
    assert.ok(result.message.length > 0);
  }
});

// ============================================================
// Tokens de verificación de correo
// ============================================================

test("cada token es distinto y no se guarda en claro", () => {
  const first = generateVerificationToken();
  const second = generateVerificationToken();

  assert.notEqual(first, second);
  assert.ok(first.length >= 40, "el token debe tener entropía suficiente");

  const hash = hashVerificationToken(first);
  assert.notEqual(hash, first);
  assert.equal(hash, hashVerificationToken(first), "el hash debe ser estable");
  assert.notEqual(hash, hashVerificationToken(second));
});

test("la comparación de hashes rechaza largos distintos sin romper", () => {
  const hash = hashVerificationToken("token");
  assert.equal(verificationHashesMatch(hash, hash), true);
  assert.equal(verificationHashesMatch(hash, "ab"), false);
  assert.equal(verificationHashesMatch("", ""), false);
});

test("un token válido se acepta una sola vez", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const stored = {
    id: "tok_1",
    userId: "user_1",
    email: "ana@empresa.com",
    expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
    consumedAt: null as Date | null,
  };

  const first = decideVerificationToken({
    stored,
    currentEmail: "ana@empresa.com",
    now,
  });
  assert.equal(first.ok, true);

  // Ya consumido: el segundo intento se rechaza.
  const second = decideVerificationToken({
    stored: { ...stored, consumedAt: now },
    currentEmail: "ana@empresa.com",
    now,
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, "already_used");
});

test("un token vencido se rechaza", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const decision = decideVerificationToken({
    stored: {
      id: "tok_1",
      userId: "user_1",
      email: "ana@empresa.com",
      expiresAt: new Date(now.getTime() - 1),
      consumedAt: null,
    },
    currentEmail: "ana@empresa.com",
    now,
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, "expired");
});

test("un token inexistente se rechaza sin distinguirse de uno inválido", () => {
  const decision = decideVerificationToken({
    stored: null,
    currentEmail: "ana@empresa.com",
    now: new Date(),
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, "invalid");
});

test("un token deja de servir si el correo de la cuenta cambió", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const decision = decideVerificationToken({
    stored: {
      id: "tok_1",
      userId: "user_1",
      email: "vieja@empresa.com",
      expiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
      consumedAt: null,
    },
    currentEmail: "nueva@empresa.com",
    now,
  });

  assert.equal(decision.ok, false);
  if (!decision.ok) assert.equal(decision.reason, "email_changed");
});

// ============================================================
// Rate limiting persistido
// ============================================================

test("deja pasar hasta el límite y luego responde con espera", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const windowEnd = new Date(now.getTime() + 60_000);

  assert.equal(decideThrottle({ count: 1, windowEnd, limit: 3, now }).allowed, true);
  assert.equal(decideThrottle({ count: 3, windowEnd, limit: 3, now }).allowed, true);

  const blocked = decideThrottle({ count: 4, windowEnd, limit: 3, now });
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.retryAfterSeconds, 60);
});

test("el tiempo de reintento nunca es cero", () => {
  const now = new Date("2026-07-24T12:00:00.000Z");
  const decision = decideThrottle({
    count: 99,
    windowEnd: now, // ventana justo terminada
    limit: 3,
    now,
  });

  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.ok(decision.retryAfterSeconds >= 1);
});

test("la clave del contador no guarda el correo en claro", () => {
  const key = throttleKey("password-reset-email", "ana@empresa.com");

  assert.equal(key.includes("ana"), false);
  assert.equal(key.includes("empresa.com"), false);
  // Estable y sensible al ámbito, para que dos flujos no compartan cupo.
  assert.equal(key, throttleKey("password-reset-email", "ANA@empresa.com"));
  assert.notEqual(key, throttleKey("verification-resend-email", "ana@empresa.com"));
});

// ============================================================
// IP del cliente detrás del proxy
// ============================================================

test("acepta la IP que escribe el proxy de Vercel", () => {
  const headers = new Headers({ "x-vercel-forwarded-for": "203.0.113.10" });
  assert.equal(resolveClientIp(headers), "203.0.113.10");
});

test("descarta una cadena reenviada porque el cliente controla el frente", () => {
  // Un atacante manda "1.2.3.4" y el proxy le agrega la real detrás.
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.10" });
  assert.equal(resolveClientIp(headers), null);
  // Sin IP confiable el límite se aplica igual, no se saltea.
  assert.equal(clientIpKey(headers), "ip-desconocida");
});

test("prefiere la cabecera del proxy sobre la que puede falsear el cliente", () => {
  const headers = new Headers({
    "x-forwarded-for": "1.2.3.4, 9.9.9.9",
    "x-vercel-forwarded-for": "203.0.113.10",
  });
  assert.equal(resolveClientIp(headers), "203.0.113.10");
});

test("rechaza valores que no son una IP", () => {
  assert.equal(resolveClientIp(new Headers({ "x-real-ip": "no-una-ip" })), null);
  assert.equal(resolveClientIp(new Headers({ "x-real-ip": "999.1.1.1" })), null);
  assert.equal(resolveClientIp(new Headers()), null);
});

test("colapsa IPv6 a su prefijo para que un bloque no rinda cupos infinitos", () => {
  const first = resolveClientIp(
    new Headers({ "x-real-ip": "2001:db8:1234:5678:1::1" })
  );
  const second = resolveClientIp(
    new Headers({ "x-real-ip": "2001:db8:1234:5678:9::9" })
  );

  assert.equal(first, second, "dos IP del mismo /64 comparten cupo");
});

// ============================================================
// Aviso de nuevo inicio de sesión
// ============================================================

test("describe el dispositivo sin guardar la huella completa", () => {
  const chrome = describeUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  assert.equal(chrome, "Chrome · Mac");

  const iphone = describeUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
  );
  assert.equal(iphone, "Safari · iPhone");

  assert.equal(describeUserAgent(null), null);
  assert.equal(describeUserAgent("curl/8.0"), null);
});
