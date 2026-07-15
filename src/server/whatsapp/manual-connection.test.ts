import assert from "node:assert/strict";
import { test } from "node:test";
import { NextResponse } from "next/server";
import { can } from "@/lib/permissions";
import { whatsappIntegrationConfigSchema } from "@/lib/validations/whatsapp";
import { handleManualWhatsappConnectionRequest } from "@/app/api/integrations/whatsapp/manual/route";
import {
  ManualWhatsappConnectionError,
  toManualWhatsappConnectionError,
  validateManualWhatsappConnectionAgainstMeta,
} from "@/server/whatsapp/manual-connection";
import {
  MetaApiError,
  resolveMetaManualWhatsappAsset,
} from "@/server/whatsapp/meta-client";

const WABA_ID = "123456789012345";
const PHONE_NUMBER_ID = "223456789012345";
const BUSINESS_ID = "323456789012345";
const ACCESS_TOKEN = "test-only-manual-access-token-long-enough";

const asset = {
  wabaId: WABA_ID,
  businessId: BUSINESS_ID,
  phoneNumberId: PHONE_NUMBER_ID,
  displayPhoneNumber: "+54 9 351 555 0000",
  verifiedName: "Negocio Manual",
};

const grant = {
  scopes: [
    "whatsapp_business_management",
    "whatsapp_business_messaging",
  ],
  wabaIds: [WABA_ID],
  expiresAt: null,
};

function request(body: unknown) {
  return new Request(
    "https://app.example/api/integrations/whatsapp/manual",
    {
      method: "POST",
      headers: {
        origin: "https://app.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
}

test("conexión manual: permisos, contrato HTTP y validaciones Meta", async (t) => {
  await t.test("OWNER y ADMIN conectan; AGENT y VIEWER reciben 403", async () => {
    for (const role of ["OWNER", "ADMIN", "AGENT", "VIEWER"] as const) {
      let connected = 0;
      const response = await handleManualWhatsappConnectionRequest(
        request({
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          accessToken: ACCESS_TOKEN,
        }),
        {
          authorize: async (_request, permission) =>
            can(role, permission)
              ? {
                  ok: true as const,
                  ctx: {
                    userId: `user-${role}`,
                    organizationId: `org-${role}`,
                    role,
                  },
                }
              : {
                  ok: false as const,
                  response: NextResponse.json(
                    { error: "forbidden", message: "No autorizado." },
                    { status: 403 }
                  ),
                },
          connect: async () => {
            connected += 1;
            return { integrationId: "integration-safe" };
          },
        }
      );
      assert.equal(response.status, can(role, "whatsapp.manage") ? 200 : 403);
      assert.equal(connected, can(role, "whatsapp.manage") ? 1 : 0);
    }
  });

  await t.test("la respuesta nunca devuelve token, IDs privados ni credenciales", async () => {
    const response = await handleManualWhatsappConnectionRequest(
      request({
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        accessToken: ACCESS_TOKEN,
      }),
      {
        authorize: async () => ({
          ok: true as const,
          ctx: { userId: "owner", organizationId: "org", role: "OWNER" },
        }),
        connect: async () => ({ integrationId: "private-integration-id" }),
      }
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result, { ok: true, state: "connected" });
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(
      serialized,
      /accessToken|encrypted|wabaId|phoneNumberId|private-integration-id/i
    );
  });

  await t.test("rechaza IDs inválidos, tamaños y campos adicionales", async () => {
    for (const input of [
      { wabaId: "abc", phoneNumberId: PHONE_NUMBER_ID, accessToken: ACCESS_TOKEN },
      { wabaId: WABA_ID, phoneNumberId: "123", accessToken: ACCESS_TOKEN },
      { wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID, accessToken: "short" },
      {
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        accessToken: ACCESS_TOKEN,
        organizationId: "attacker-org",
      },
    ]) {
      assert.equal(whatsappIntegrationConfigSchema.safeParse(input).success, false);
    }
  });

  await t.test("valida token, WABA, número y confirma la suscripción", async () => {
    const calls: string[] = [];
    const validated = await validateManualWhatsappConnectionAgainstMeta(
      {
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        accessToken: ACCESS_TOKEN,
      },
      {
        inspectToken: async () => {
          calls.push("inspect");
          return grant;
        },
        resolveAsset: async () => {
          calls.push("asset");
          return asset;
        },
        subscribeWaba: async () => {
          calls.push("subscribe");
        },
        isSubscribed: async () => {
          calls.push("confirm");
          return true;
        },
      }
    );
    assert.deepEqual(calls, ["inspect", "asset", "subscribe", "confirm"]);
    assert.deepEqual(validated, { grant, asset });
  });

  await t.test("rechaza un token sin acceso a la WABA", async () => {
    await assert.rejects(
      validateManualWhatsappConnectionAgainstMeta(
        {
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          accessToken: ACCESS_TOKEN,
        },
        {
          inspectToken: async () => ({ ...grant, wabaIds: ["999999999999999"] }),
        }
      ),
      (error) =>
        error instanceof ManualWhatsappConnectionError &&
        error.code === "waba_not_authorized"
    );
  });

  await t.test("rechaza un Phone Number ID que no pertenece a la WABA", async () => {
    await assert.rejects(
      validateManualWhatsappConnectionAgainstMeta(
        {
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          accessToken: ACCESS_TOKEN,
        },
        {
          inspectToken: async () => grant,
          resolveAsset: async () => ({ ...asset, phoneNumberId: "999999999999999" }),
        }
      ),
      (error) =>
        error instanceof ManualWhatsappConnectionError &&
        error.code === "asset_mismatch"
    );
  });

  await t.test("token sin permisos y errores de Meta quedan sanitizados", () => {
    const meta = toManualWhatsappConnectionError(
      new MetaApiError({
        code: "authentication",
        safeMessage: "Meta no confirmó los permisos necesarios.",
      })
    );
    const unknown = toManualWhatsappConnectionError(
      new Error(`Bearer ${ACCESS_TOKEN} https://private.example/path`)
    );
    assert.equal(meta.code, "meta_authentication");
    assert.equal(meta.status, 422);
    assert.equal(unknown.code, "connection_unavailable");
    assert.doesNotMatch(JSON.stringify({ meta, unknown }), /Bearer|private\.example|test-only/);
  });

  await t.test("fallo o confirmación ausente del webhook no se declara éxito", async () => {
    await assert.rejects(
      validateManualWhatsappConnectionAgainstMeta(
        {
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          accessToken: ACCESS_TOKEN,
        },
        {
          inspectToken: async () => grant,
          resolveAsset: async () => asset,
          subscribeWaba: async () => undefined,
          isSubscribed: async () => false,
        }
      ),
      (error) =>
        error instanceof ManualWhatsappConnectionError &&
        error.code === "webhook_pending"
    );
    const failure = toManualWhatsappConnectionError(
      new MetaApiError({
        code: "meta_unavailable",
        safeMessage: "Meta no está disponible temporalmente.",
        retryable: true,
      })
    );
    assert.equal(failure.status, 503);
    assert.equal(failure.code, "meta_unavailable");
  });
});

test("cliente Meta: el número manual debe estar enumerado por la WABA", async () => {
  const previousFetch = global.fetch;
  const previousVersion = process.env.META_GRAPH_API_VERSION;
  process.env.META_GRAPH_API_VERSION = "v23.0";
  try {
    const responses = [
      {
        id: WABA_ID,
        owner_business_info: { id: BUSINESS_ID },
      },
      {
        data: [
          {
            id: PHONE_NUMBER_ID,
            display_phone_number: asset.displayPhoneNumber,
            verified_name: asset.verifiedName,
          },
        ],
      },
    ];
    const urls: string[] = [];
    global.fetch = (async (input) => {
      urls.push(String(input));
      return Response.json(responses.shift());
    }) as typeof fetch;
    assert.deepEqual(
      await resolveMetaManualWhatsappAsset({
        accessToken: ACCESS_TOKEN,
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
      }),
      asset
    );
    assert.equal(urls.length, 2);
    assert.match(urls[0]!, new RegExp(`/${WABA_ID}\\?`));
    assert.match(urls[1]!, new RegExp(`/${WABA_ID}/phone_numbers\\?`));

    const mismatchedResponses = [
      { id: WABA_ID, owner_business_info: { id: BUSINESS_ID } },
      {
        data: [
          {
            id: "999999999999999",
            display_phone_number: "+54 9 351 555 9999",
            verified_name: "Otro número",
          },
        ],
      },
    ];
    global.fetch = (async () => Response.json(mismatchedResponses.shift())) as typeof fetch;
    await assert.rejects(
      resolveMetaManualWhatsappAsset({
        accessToken: ACCESS_TOKEN,
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
      }),
      (error) =>
        error instanceof MetaApiError &&
        error.safeMessage === "El Phone Number ID no pertenece a la WABA indicada."
    );
  } finally {
    global.fetch = previousFetch;
    if (previousVersion === undefined) delete process.env.META_GRAPH_API_VERSION;
    else process.env.META_GRAPH_API_VERSION = previousVersion;
  }
});
