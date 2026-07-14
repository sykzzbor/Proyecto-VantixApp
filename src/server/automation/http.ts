import { NextResponse } from "next/server";
import { can, type Permission } from "@/lib/permissions";
import { resolveAutomationRequestContext } from "@/server/automation/request-context";

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export function automationJson(
  body: unknown,
  init?: { status?: number }
) {
  return NextResponse.json(body, {
    ...init,
    headers: PRIVATE_NO_STORE_HEADERS,
  });
}

export async function authorizeAutomationRequest(
  request: Request,
  permission: Permission
) {
  const resolved = await resolveAutomationRequestContext(request);
  if (!resolved.ok) {
    return {
      ok: false as const,
      response: automationJson(
        { error: resolved.code, message: resolved.message },
        { status: resolved.status }
      ),
    };
  }
  if (!can(resolved.ctx.role, permission)) {
    return {
      ok: false as const,
      response: automationJson(
        { error: "forbidden", message: "No tenés permisos para continuar." },
        { status: 403 }
      ),
    };
  }
  return { ok: true as const, ctx: resolved.ctx };
}
