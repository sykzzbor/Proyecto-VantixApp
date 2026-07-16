import assert from "node:assert/strict";
import { test } from "node:test";
import { can } from "@/lib/permissions";
import {
  decryptAccessToken,
  encryptAccessToken,
} from "@/server/whatsapp/crypto";
import {
  GoogleApiError,
  buildGoogleAuthUrl,
  exchangeAuthorizationCode,
  fetchCalendarList,
  refreshAccessToken,
} from "@/server/integrations/google-calendar/oauth";
import {
  consumeGoogleOAuthState,
  createGoogleOAuthState,
  hashOAuthState,
  resolveStateConsumption,
  type StateStore,
} from "@/server/integrations/google-calendar/state";

const KEY = "77".repeat(32);
const NOW = new Date("2026-07-16T12:00:00.000Z");
const REFRESH_TOKEN = "unit-test-google-refresh-token-000000000001";
const ACCESS_TOKEN = "unit-test-google-access-token-0000000000001";

function withGoogleEnv<T>(run: () => Promise<T> | T): Promise<T> | T {
  process.env.GOOGLE_CLIENT_ID = "unit-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "unit-client-secret-000001";
  process.env.BETTER_AUTH_URL = "https://app.example";
  return run();
}

function memoryStore() {
  const rows = new Map<
    string,
    {
      id: string;
      organizationId: string;
      userId: string;
      stateHash: string;
      expiresAt: Date;
      usedAt: Date | null;
    }
  >();
  let sequence = 0;
  const store: StateStore = {
    create: async (data) => {
      sequence += 1;
      rows.set(data.stateHash, { id: `state-${sequence}`, usedAt: null, ...data });
    },
    find: async (stateHash) => rows.get(stateHash) ?? null,
    markUsed: async (id, now) => {
      for (const row of rows.values()) {
        if (row.id === id && row.usedAt === null) {
          row.usedAt = now;
          return 1;
        }
      }
      return 0;
    },
  };
  return { store, rows };
}

// ============================================================
// Permisos
// ============================================================

test("integrations.manage: OWNER/ADMIN pueden, AGENT/VIEWER no", () => {
  assert.equal(can("OWNER", "integrations.manage"), true);
  assert.equal(can("ADMIN", "integrations.manage"), true);
  assert.equal(can("AGENT", "integrations.manage"), false);
  assert.equal(can("VIEWER", "integrations.manage"), false);
});

// ============================================================
// State OAuth: un solo uso, vencimiento y aislamiento
// ============================================================

test("state: se guarda solo el hash y se consume una única vez", async () => {
  const { store, rows } = memoryStore();
  const state = await withGoogleEnv(() =>
    createGoogleOAuthState({ organizationId: "org-a", userId: "user-1" }, store)
  );
  // En la base nunca queda el valor crudo.
  assert.equal(rows.has(state), false);
  assert.equal(rows.has(hashOAuthState(state)), true);

  const first = await consumeGoogleOAuthState(
    { state, sessionOrganizationId: "org-a", now: NOW },
    store
  );
  assert.deepEqual(first, { ok: true, organizationId: "org-a", userId: "user-1" });

  // Doble callback: el segundo consumo se rechaza.
  const second = await consumeGoogleOAuthState(
    { state, sessionOrganizationId: "org-a", now: NOW },
    store
  );
  assert.deepEqual(second, { ok: false, reason: "already_used" });
});

test("state: rechaza inválido, vencido y organización ajena", async () => {
  const { store } = memoryStore();
  const state = await withGoogleEnv(() =>
    createGoogleOAuthState({ organizationId: "org-a", userId: "user-1" }, store)
  );

  const missing = await consumeGoogleOAuthState(
    { state: "estado-inexistente", sessionOrganizationId: "org-a", now: NOW },
    store
  );
  assert.deepEqual(missing, { ok: false, reason: "not_found" });

  // Aislamiento multiempresa: otra organización no puede consumirlo.
  const foreign = await consumeGoogleOAuthState(
    { state, sessionOrganizationId: "org-b", now: NOW },
    store
  );
  assert.deepEqual(foreign, { ok: false, reason: "org_mismatch" });

  // Vencido (más de 10 minutos después).
  const expired = await consumeGoogleOAuthState(
    {
      state,
      sessionOrganizationId: "org-a",
      now: new Date(Date.now() + 11 * 60 * 1000),
    },
    store
  );
  assert.deepEqual(expired, { ok: false, reason: "expired" });
});

test("resolveStateConsumption cubre cada rechazo de forma pura", () => {
  const base = {
    organizationId: "org-a",
    userId: "user-1",
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
  };
  assert.equal(
    resolveStateConsumption({ record: base, sessionOrganizationId: "org-a", now: NOW }).ok,
    true
  );
  assert.deepEqual(
    resolveStateConsumption({ record: null, sessionOrganizationId: "org-a", now: NOW }),
    { ok: false, reason: "not_found" }
  );
  assert.deepEqual(
    resolveStateConsumption({
      record: { ...base, usedAt: NOW },
      sessionOrganizationId: "org-a",
      now: NOW,
    }),
    { ok: false, reason: "already_used" }
  );
  assert.deepEqual(
    resolveStateConsumption({
      record: { ...base, expiresAt: NOW },
      sessionOrganizationId: "org-a",
      now: NOW,
    }),
    { ok: false, reason: "expired" }
  );
});

// ============================================================
// Tokens cifrados
// ============================================================

test("los tokens se cifran con AES-256-GCM y no quedan en texto plano", () => {
  const encrypted = encryptAccessToken(REFRESH_TOKEN, KEY);
  assert.notEqual(encrypted, REFRESH_TOKEN);
  assert.doesNotMatch(encrypted, /unit-test-google/i);
  assert.equal(decryptAccessToken(encrypted, KEY), REFRESH_TOKEN);
});

// ============================================================
// Cliente OAuth: URL, intercambio, refresh y sanitización
// ============================================================

test("la URL de consentimiento pide scope mínimo, offline y state", async () => {
  const url = await withGoogleEnv(() => buildGoogleAuthUrl("estado-unit-1"));
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://accounts.google.com");
  assert.equal(
    parsed.searchParams.get("scope"),
    "https://www.googleapis.com/auth/calendar.readonly"
  );
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");
  assert.equal(parsed.searchParams.get("state"), "estado-unit-1");
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "https://app.example/api/integrations/google-calendar/callback"
  );
});

test("exchange y refresh envían el formulario correcto y parsean tokens", async () => {
  await withGoogleEnv(async () => {
    let exchangeBody = "";
    const tokens = await exchangeAuthorizationCode("codigo-unit", (async (
      _url: RequestInfo | URL,
      init?: RequestInit
    ) => {
      exchangeBody = String(init?.body);
      return Response.json({
        access_token: ACCESS_TOKEN,
        refresh_token: REFRESH_TOKEN,
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/calendar.readonly",
      });
    }) as typeof fetch);
    assert.match(exchangeBody, /grant_type=authorization_code/);
    assert.match(exchangeBody, /code=codigo-unit/);
    assert.equal(tokens.accessToken, ACCESS_TOKEN);
    assert.equal(tokens.refreshToken, REFRESH_TOKEN);
    assert.ok(tokens.expiresAt.getTime() > Date.now());

    let refreshBody = "";
    const refreshed = await refreshAccessToken(REFRESH_TOKEN, (async (
      _url: RequestInfo | URL,
      init?: RequestInit
    ) => {
      refreshBody = String(init?.body);
      return Response.json({ access_token: "nuevo-access-token-000001", expires_in: 3600 });
    }) as typeof fetch);
    assert.match(refreshBody, /grant_type=refresh_token/);
    assert.equal(refreshed.accessToken, "nuevo-access-token-000001");
  });
});

test("errores de Google quedan sanitizados (sin cuerpo crudo ni tokens)", async () => {
  const previousError = console.error;
  console.error = () => undefined;
  try {
    await withGoogleEnv(async () => {
      await assert.rejects(
        refreshAccessToken(REFRESH_TOKEN, (async () =>
          new Response(`{"error":"invalid_grant","secret":"${REFRESH_TOKEN}"}`, {
            status: 401,
          })) as typeof fetch),
        (error) =>
          error instanceof GoogleApiError &&
          error.code === "authorization_expired" &&
          !error.safeMessage.includes(REFRESH_TOKEN) &&
          !/invalid_grant/.test(error.safeMessage)
      );
      await assert.rejects(
        fetchCalendarList(ACCESS_TOKEN, (async () =>
          new Response("boom interno", { status: 500 })) as typeof fetch),
        (error) =>
          error instanceof GoogleApiError &&
          error.code === "google_unavailable" &&
          error.retryable === true &&
          !/boom/.test(error.safeMessage)
      );
    });
  } finally {
    console.error = previousError;
  }
});

test("fetchCalendarList normaliza items y marca el principal", async () => {
  await withGoogleEnv(async () => {
    const calendars = await fetchCalendarList(ACCESS_TOKEN, (async () =>
      Response.json({
        items: [
          { id: "demo@vantix.local", summary: "Cuenta Demo", primary: true },
          { id: "otro@grupo.calendar.google.com", summary: "Turnos" },
        ],
      })) as typeof fetch);
    assert.deepEqual(calendars, [
      { id: "demo@vantix.local", name: "Cuenta Demo", primary: true },
      { id: "otro@grupo.calendar.google.com", name: "Turnos", primary: false },
    ]);
  });
});
