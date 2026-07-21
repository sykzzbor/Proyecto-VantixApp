import assert from "node:assert/strict";
import { test } from "node:test";
import { planHasFeature } from "@/lib/billing/plans";
import { can } from "@/lib/permissions";
import {
  GOOGLE_SHEETS_SCOPES,
  GoogleSheetsConfigurationError,
  getGoogleSheetsRedirectUri,
} from "@/server/integrations/google-sheets/config";
import { safeSheetCell } from "@/server/integrations/google-sheets/export-data";
import {
  GoogleSheetsApiError,
  buildGoogleSheetsAuthUrl,
  createGoogleSpreadsheet,
  exchangeGoogleSheetsCode,
  getGoogleSpreadsheet,
  googleSheetsFetch,
  refreshGoogleSheetsAccessToken,
} from "@/server/integrations/google-sheets/oauth";
import {
  consumeGoogleSheetsOAuthState,
  createGoogleSheetsOAuthState,
  hashGoogleSheetsState,
  type GoogleSheetsStateStore,
} from "@/server/integrations/google-sheets/state";
import { parseSpreadsheetReference } from "@/server/integrations/google-sheets/service";
import { decryptAccessToken, encryptAccessToken } from "@/server/whatsapp/crypto";

const KEY = "55".repeat(32);

function withEnv<T>(run: () => T): T {
  const previous = {
    id: process.env.GOOGLE_SHEETS_CLIENT_ID,
    secret: process.env.GOOGLE_SHEETS_CLIENT_SECRET,
    url: process.env.BETTER_AUTH_URL,
  };
  process.env.GOOGLE_SHEETS_CLIENT_ID = "sheets-client.apps.googleusercontent.com";
  process.env.GOOGLE_SHEETS_CLIENT_SECRET = "sheets-client-secret-value";
  process.env.BETTER_AUTH_URL = "https://app.example";
  try { return run(); } finally {
    if (previous.id === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_ID; else process.env.GOOGLE_SHEETS_CLIENT_ID = previous.id;
    if (previous.secret === undefined) delete process.env.GOOGLE_SHEETS_CLIENT_SECRET; else process.env.GOOGLE_SHEETS_CLIENT_SECRET = previous.secret;
    if (previous.url === undefined) delete process.env.BETTER_AUTH_URL; else process.env.BETTER_AUTH_URL = previous.url;
  }
}

function stateStore() {
  const rows = new Map<string, { id: string; organizationId: string; userId: string; expiresAt: Date; usedAt: Date | null }>();
  const store: GoogleSheetsStateStore = {
    async create(data) { rows.set(data.stateHash, { id: "state-1", organizationId: data.organizationId, userId: data.userId, expiresAt: data.expiresAt, usedAt: null }); },
    async find(hash) { return rows.get(hash) ?? null; },
    async markUsed(id, now) {
      const row = [...rows.values()].find((item) => item.id === id && !item.usedAt);
      if (!row) return 0;
      row.usedAt = now;
      return 1;
    },
  };
  return { store, rows };
}

test("Sheets usa OAuth y permisos separados de Login y Calendar", () => {
  const url = withEnv(() => buildGoogleSheetsAuthUrl("state-sheets"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("scope"), GOOGLE_SHEETS_SCOPES.join(" "));
  assert.equal(parsed.searchParams.get("include_granted_scopes"), "false");
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://app.example/api/integrations/google-sheets/callback");
  assert.doesNotMatch(parsed.searchParams.get("scope") ?? "", /calendar|openid|userinfo/);
});

test("callback exige HTTPS fuera de localhost", () => {
  withEnv(() => {
    process.env.BETTER_AUTH_URL = "http://app.example";
    assert.throws(() => getGoogleSheetsRedirectUri(), GoogleSheetsConfigurationError);
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    assert.equal(getGoogleSheetsRedirectUri(), "http://localhost:3000/api/integrations/google-sheets/callback");
  });
});

test("state queda hasheado, ligado a organización/usuario y se consume una vez", async () => {
  const { store, rows } = stateStore();
  const state = await createGoogleSheetsOAuthState({ organizationId: "org-a", userId: "user-a" }, store);
  assert.equal(rows.has(state), false);
  assert.equal(rows.has(hashGoogleSheetsState(state)), true);
  assert.deepEqual(await consumeGoogleSheetsOAuthState({ state, organizationId: "org-b", userId: "user-a" }, store), { ok: false });
  assert.deepEqual(await consumeGoogleSheetsOAuthState({ state, organizationId: "org-a", userId: "user-a" }, store), { ok: true, organizationId: "org-a" });
  assert.deepEqual(await consumeGoogleSheetsOAuthState({ state, organizationId: "org-a", userId: "user-a" }, store), { ok: false });
});

test("OWNER/ADMIN administran y AGENT/VIEWER no", () => {
  assert.equal(can("OWNER", "integrations.manage"), true);
  assert.equal(can("ADMIN", "integrations.manage"), true);
  assert.equal(can("AGENT", "integrations.manage"), false);
  assert.equal(can("VIEWER", "integrations.manage"), false);
});

test("Sheets está bloqueado durante prueba y habilitado desde Standard", () => {
  assert.equal(planHasFeature("STANDARD", "TRIALING", "google_sheets"), false);
  assert.equal(planHasFeature("STANDARD", "ACTIVE", "google_sheets"), true);
});

test("tokens se cifran y no quedan en texto plano", () => {
  const token = "google-sheets-refresh-token-sensitive";
  const encrypted = encryptAccessToken(token, KEY);
  assert.notEqual(encrypted, token);
  assert.doesNotMatch(encrypted, /sensitive/);
  assert.equal(decryptAccessToken(encrypted, KEY), token);
});

test("intercambio y refresh usan credenciales server-side y respuesta segura", async () => {
  const requests: string[] = [];
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(String(init?.body));
    return new Response(JSON.stringify({ access_token: "access-token-sheets-valid-123", refresh_token: "refresh-token-sheets-valid-123", expires_in: 3600, scope: GOOGLE_SHEETS_SCOPES[0] }), { status: 200 });
  }) as typeof fetch;
  await withEnv(() => exchangeGoogleSheetsCode("authorization-code", fakeFetch));
  await withEnv(() => refreshGoogleSheetsAccessToken("stored-refresh-token", fakeFetch));
  assert.match(requests[0], /grant_type=authorization_code/);
  assert.match(requests[1], /grant_type=refresh_token/);
});

test("crear y consultar hoja validan la respuesta oficial", async () => {
  const fakeFetch = (async () => new Response(JSON.stringify({ spreadsheetId: "spreadsheet_123456789012345", properties: { title: "Vantix" }, sheets: [{ properties: { title: "Hoja 1" } }] }), { status: 200 })) as typeof fetch;
  const created = await createGoogleSpreadsheet("access-token-value-long", "Vantix", fakeFetch);
  const selected = await getGoogleSpreadsheet("access-token-value-long", created.id, fakeFetch);
  assert.deepEqual(selected, { id: "spreadsheet_123456789012345", name: "Vantix", sheetNames: ["Hoja 1"] });
});

test("selección acepta URL/ID válidos y rechaza otros hosts", () => {
  const id = "abcDEF_12345678901234567890";
  assert.equal(parseSpreadsheetReference(id), id);
  assert.equal(parseSpreadsheetReference(`https://docs.google.com/spreadsheets/d/${id}/edit`), id);
  assert.equal(parseSpreadsheetReference(`https://evil.example/spreadsheets/d/${id}`), null);
});

test("exportación neutraliza fórmulas sin alterar texto normal", () => {
  assert.equal(safeSheetCell("=IMPORTXML(\"x\")"), "'=IMPORTXML(\"x\")");
  assert.equal(safeSheetCell("@SUM(A1:A2)"), "'@SUM(A1:A2)");
  assert.equal(safeSheetCell("Cliente normal"), "Cliente normal");
});

test("errores de Google quedan sanitizados", async () => {
  const fakeFetch = (async () => new Response("access_token=secret", { status: 403 })) as typeof fetch;
  await assert.rejects(
    () => getGoogleSpreadsheet("secret-token", "spreadsheet_123456789012345", fakeFetch),
    (error) => error instanceof GoogleSheetsApiError && error.code === "permission_denied" && !error.message.includes("secret")
  );
});

test("reintenta respuestas temporales y se recupera", async () => {
  let calls = 0;
  const fakeFetch = (async () => {
    calls += 1;
    if (calls < 3) return new Response("unavailable", { status: 503 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  const result = await googleSheetsFetch({ url: "https://sheets.googleapis.com/test", context: "retry_test", retries: 2 }, fakeFetch);
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 3);
});

test("no reintenta errores permanentes", async () => {
  let calls = 0;
  const fakeFetch = (async () => { calls += 1; return new Response("forbidden", { status: 403 }); }) as typeof fetch;
  await assert.rejects(() => googleSheetsFetch({ url: "https://sheets.googleapis.com/test", context: "no_retry", retries: 2 }, fakeFetch), GoogleSheetsApiError);
  assert.equal(calls, 1);
});
