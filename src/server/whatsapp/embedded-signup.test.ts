import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { whatsappEmbeddedSignupCompleteSchema } from "@/lib/validations/whatsapp-embedded-signup";
import {
  isSameOriginMutation,
  maskWhatsappPhone,
  sanitizeWhatsappIntegrationError,
  verifySignupNonce,
} from "@/server/whatsapp/embedded-signup";
import {
  exchangeMetaEmbeddedSignupCode,
  inspectMetaEmbeddedSignupToken,
  MetaApiError,
  resolveMetaEmbeddedSignupAsset,
  subscribeMetaAppToWaba,
} from "@/server/whatsapp/meta-client";
import { parseWhatsappWebhookPayload } from "@/server/whatsapp/parser";
import { handleWhatsappWebhookPost } from "@/server/whatsapp/webhook-http";

const TEST_APP_ID = "123456789012345";
const TEST_APP_SECRET = "test-only-meta-app-secret-long-enough";
const TEST_ACCESS_TOKEN = "test-only-embedded-access-token-long-enough";
const TEST_WABA_ID = "223456789012345";
const TEST_BUSINESS_ID = "323456789012345";
const TEST_PHONE_ID = "423456789012345";

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("Embedded Signup valida contrato, activos y respuestas seguras", async (t) => {
  const snapshot = {
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_GRAPH_API_VERSION: process.env.META_GRAPH_API_VERSION,
  };
  const originalFetch = globalThis.fetch;
  process.env.META_APP_ID = TEST_APP_ID;
  process.env.META_APP_SECRET = TEST_APP_SECRET;
  process.env.META_GRAPH_API_VERSION = "v23.0";

  try {
    await t.test("el body acepta solamente el código temporal", () => {
      assert.equal(
        whatsappEmbeddedSignupCompleteSchema.safeParse({
          code: "temporary-meta-code-1234567890",
        }).success,
        true
      );
      assert.equal(
        whatsappEmbeddedSignupCompleteSchema.safeParse({
          code: "temporary-meta-code-1234567890",
          wabaId: TEST_WABA_ID,
        }).success,
        false
      );
      assert.equal(
        whatsappEmbeddedSignupCompleteSchema.safeParse({
          code: "temporary-meta-code-1234567890",
          phoneNumberId: TEST_PHONE_ID,
        }).success,
        false
      );
    });

    await t.test("same-origin es exacto y nunca acepta un sufijo engañoso", () => {
      assert.equal(
        isSameOriginMutation(
          new Request("https://app.example/api/integrations/whatsapp/start", {
            headers: { origin: "https://app.example" },
          })
        ),
        true
      );
      assert.equal(
        isSameOriginMutation(
          new Request("https://app.example/api/integrations/whatsapp/start", {
            headers: { origin: "https://app.example.attacker.invalid" },
          })
        ),
        false
      );
      assert.equal(
        isSameOriginMutation(
          new Request("https://app.example/api/integrations/whatsapp/start")
        ),
        false
      );
    });

    await t.test("el DTO enmascara teléfono y elimina errores sospechosos", () => {
      assert.equal(maskWhatsappPhone("+54 9 351 123 4567"), "•••• 4567");
      assert.equal(
        sanitizeWhatsappIntegrationError(
          `Bearer ${"s".repeat(100)} https://private.example/path`
        ),
        "La integración requiere revisión."
      );
      assert.equal(verifySignupNonce("invalid nonce", "0".repeat(64)), false);
    });

    await t.test(
      "un change firmado que no es messages responde 200 sin exigir metadata",
      async () => {
        const payload = {
          object: "whatsapp_business_account",
          entry: [
            {
              changes: [
                {
                  field: "message_template_status_update",
                  value: { event: "APPROVED" },
                },
              ],
            },
          ],
        };
        assert.deepEqual(parseWhatsappWebhookPayload(payload), []);
        const rawBody = JSON.stringify(payload);
        const signature = `sha256=${createHmac("sha256", TEST_APP_SECRET)
          .update(rawBody)
          .digest("hex")}`;
        const response = await handleWhatsappWebhookPost(
          new Request("https://app.example/api/webhooks/whatsapp", {
            method: "POST",
            headers: { "x-hub-signature-256": signature },
            body: rawBody,
          }),
          () => undefined
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { received: true });
      }
    );

    await t.test("intercambia el código sin devolver datos adicionales", async () => {
      globalThis.fetch = async (input) => {
        const url = String(input);
        assert.match(url, /\/oauth\/access_token\?/);
        return Response.json({
          access_token: TEST_ACCESS_TOKEN,
          token_type: "bearer",
          expires_in: 3600,
        });
      };
      const result = await exchangeMetaEmbeddedSignupCode(
        "temporary-meta-code-1234567890"
      );
      assert.equal(result.accessToken, TEST_ACCESS_TOKEN);
      assert.ok(result.expiresAt instanceof Date);
      assert.deepEqual(Object.keys(result).sort(), ["accessToken", "expiresAt"]);
    });

    await t.test("un código rechazado devuelve un error sanitizado", async () => {
      globalThis.fetch = async () =>
        Response.json(
          {
            error: {
              code: 190,
              message: `remote-secret-${"x".repeat(80)}`,
            },
          },
          { status: 400 }
        );
      await assert.rejects(
        () => exchangeMetaEmbeddedSignupCode("invalid-temporary-code-123456"),
        (error: unknown) => {
          assert.ok(error instanceof MetaApiError);
          assert.equal(error.code, "authentication");
          assert.doesNotMatch(error.safeMessage, /remote-secret|xxx/);
          return true;
        }
      );
    });

    await t.test("debug_token exige app, permisos y WABA granular", async () => {
      globalThis.fetch = async () =>
        Response.json({
          data: {
            app_id: TEST_APP_ID,
            is_valid: true,
            expires_at: 0,
            data_access_expires_at: 0,
            scopes: [
              "whatsapp_business_management",
              "whatsapp_business_messaging",
            ],
            granular_scopes: [
              {
                scope: "whatsapp_business_management",
                target_ids: [TEST_WABA_ID],
              },
            ],
          },
        });
      assert.deepEqual(
        await inspectMetaEmbeddedSignupToken(TEST_ACCESS_TOKEN),
        {
          scopes: [
            "whatsapp_business_management",
            "whatsapp_business_messaging",
          ],
          wabaIds: [TEST_WABA_ID],
          expiresAt: null,
        }
      );

      globalThis.fetch = async () =>
        Response.json({
          data: {
            app_id: "999999999999999",
            is_valid: true,
            scopes: [],
            granular_scopes: [],
          },
        });
      await assert.rejects(
        () => inspectMetaEmbeddedSignupToken(TEST_ACCESS_TOKEN),
        (error: unknown) =>
          error instanceof MetaApiError && error.code === "authentication"
      );
    });

    await t.test("WABA y número se obtienen únicamente desde Meta", async () => {
      let call = 0;
      globalThis.fetch = async () => {
        call += 1;
        if (call === 1) {
          return Response.json({
            id: TEST_WABA_ID,
            owner_business_info: {
              id: TEST_BUSINESS_ID,
              name: "Negocio de prueba",
            },
          });
        }
        return Response.json({
          data: [
            {
              id: TEST_PHONE_ID,
              display_phone_number: "+54 9 351 123 4567",
              verified_name: "Negocio de prueba",
            },
          ],
        });
      };
      assert.deepEqual(
        await resolveMetaEmbeddedSignupAsset({
          accessToken: TEST_ACCESS_TOKEN,
          wabaId: TEST_WABA_ID,
        }),
        {
          wabaId: TEST_WABA_ID,
          businessId: TEST_BUSINESS_ID,
          phoneNumberId: TEST_PHONE_ID,
          displayPhoneNumber: "+54 9 351 123 4567",
          verifiedName: "Negocio de prueba",
        }
      );
    });

    await t.test("más de un número falla cerrado", async () => {
      let call = 0;
      globalThis.fetch = async () => {
        call += 1;
        return call === 1
          ? Response.json({
              id: TEST_WABA_ID,
              owner_business_info: { id: TEST_BUSINESS_ID },
            })
          : Response.json({
              data: [
                {
                  id: TEST_PHONE_ID,
                  display_phone_number: "+54 9 351 123 4567",
                  verified_name: "Uno",
                },
                {
                  id: "523456789012345",
                  display_phone_number: "+54 9 351 765 4321",
                  verified_name: "Dos",
                },
              ],
            });
      };
      await assert.rejects(
        () =>
          resolveMetaEmbeddedSignupAsset({
            accessToken: TEST_ACCESS_TOKEN,
            wabaId: TEST_WABA_ID,
          }),
        (error: unknown) =>
          error instanceof MetaApiError && error.code === "invalid_response"
      );
    });

    await t.test("rechaza una WABA distinta de la consultada", async () => {
      globalThis.fetch = async () =>
        Response.json({
          id: "999999999999999",
          owner_business_info: { id: TEST_BUSINESS_ID },
        });
      await assert.rejects(
        () =>
          resolveMetaEmbeddedSignupAsset({
            accessToken: TEST_ACCESS_TOKEN,
            wabaId: TEST_WABA_ID,
          }),
        (error: unknown) =>
          error instanceof MetaApiError && error.code === "invalid_response"
      );
    });

    await t.test("rechaza un Phone Number ID no válido", async () => {
      let call = 0;
      globalThis.fetch = async () => {
        call += 1;
        return call === 1
          ? Response.json({
              id: TEST_WABA_ID,
              owner_business_info: { id: TEST_BUSINESS_ID },
            })
          : Response.json({
              data: [
                {
                  id: "phone-id-manipulado",
                  display_phone_number: "+54 9 351 123 4567",
                  verified_name: "Negocio de prueba",
                },
              ],
            });
      };
      await assert.rejects(
        () =>
          resolveMetaEmbeddedSignupAsset({
            accessToken: TEST_ACCESS_TOKEN,
            wabaId: TEST_WABA_ID,
          }),
        (error: unknown) =>
          error instanceof MetaApiError && error.code === "invalid_response"
      );
    });

    await t.test("la suscripción usa solo el endpoint de la WABA", async () => {
      globalThis.fetch = async (input, init) => {
        assert.match(String(input), new RegExp(`${TEST_WABA_ID}/subscribed_apps$`));
        assert.equal(init?.method, "POST");
        assert.equal(init?.body, undefined);
        return Response.json({ success: true });
      };
      await subscribeMetaAppToWaba({
        accessToken: TEST_ACCESS_TOKEN,
        wabaId: TEST_WABA_ID,
      });
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(snapshot);
  }
});
