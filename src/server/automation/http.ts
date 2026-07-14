import { NextResponse } from "next/server";
import { can, type Permission } from "@/lib/permissions";
import { resolveAutomationRequestContext } from "@/server/automation/request-context";

export const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

export type LimitedRawBodyResult =
  | { ok: true; rawBody: string }
  | { ok: false; reason: "too_large" | "invalid" };

/** Lee el stream con límite duro antes de alojar el body completo en memoria. */
export async function readLimitedRawBody(
  request: Request,
  maxBytes: number
): Promise<LimitedRawBodyResult> {
  const declared = request.headers.get("content-length");
  if (declared) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { ok: false, reason: "too_large" };
    }
  }

  if (!request.body) return { ok: true, rawBody: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
    const raw = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return {
      ok: true,
      rawBody: new TextDecoder("utf-8", { fatal: true }).decode(raw),
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

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
