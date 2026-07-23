import { z } from "zod";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import { WooCommerceApiError } from "@/server/integrations/woocommerce/api";
import {
  WooCommerceIntegrationError,
  connectWooCommerce,
} from "@/server/integrations/woocommerce/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const schema = z
  .object({
    storeUrl: z.string().trim().min(8).max(500),
    consumerKey: z
      .string()
      .trim()
      .regex(/^ck_[A-Za-z0-9]{20,100}$/),
    consumerSecret: z
      .string()
      .trim()
      .regex(/^cs_[A-Za-z0-9]{20,100}$/),
  })
  .strict();

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    "integrations.manage",
    "woocommerce"
  );
  if (!authorization.ok) return authorization.response;
  const body = await readLimitedRawBody(request, 2048);
  if (!body.ok) {
    return automationJson(
      { error: "invalid_body", message: "La solicitud no es válida." },
      { status: body.reason === "too_large" ? 413 : 400 }
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(body.rawBody) as unknown;
  } catch {
    raw = null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return automationJson(
      {
        error: "invalid_body",
        message:
          "Revisá la URL, la Consumer Key y la Consumer Secret de WooCommerce.",
      },
      { status: 400 }
    );
  }
  try {
    const result = await connectWooCommerce({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      ...parsed.data,
    });
    return automationJson({
      ok: true,
      store: { name: result.storeName, url: result.storeUrl },
    });
  } catch (error) {
    if (error instanceof WooCommerceApiError) {
      return automationJson(
        { error: error.code, message: error.safeMessage },
        { status: 502 }
      );
    }
    if (error instanceof WooCommerceIntegrationError) {
      return automationJson(
        { error: error.code, message: error.message },
        { status: 409 }
      );
    }
    console.error(
      "[VantixApp] WooCommerce connect:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      {
        error: "internal_error",
        message: "No se pudo conectar WooCommerce.",
      },
      { status: 500 }
    );
  }
}
