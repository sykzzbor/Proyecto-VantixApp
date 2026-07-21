import { z } from "zod";
import { authorizeAutomationRequest, automationJson, readLimitedRawBody } from "@/server/automation/http";
import { GOOGLE_SHEETS_DATASETS } from "@/server/integrations/google-sheets/export-data";
import { GoogleSheetsApiError } from "@/server/integrations/google-sheets/oauth";
import { syncGoogleSheets } from "@/server/integrations/google-sheets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  datasets: z.array(z.enum(GOOGLE_SHEETS_DATASETS)).min(1).max(3).transform((values) => [...new Set(values)]),
  idempotencyKey: z.uuid(),
}).strict();

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "integrations.manage", "google_sheets");
  if (!authorization.ok) return authorization.response;
  const body = await readLimitedRawBody(request, 2048);
  if (!body.ok) return automationJson({ error: "invalid_body", message: "La solicitud no es válida." }, { status: body.reason === "too_large" ? 413 : 400 });
  let raw: unknown;
  try { raw = JSON.parse(body.rawBody); } catch { raw = null; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return automationJson({ error: "invalid_body", message: "Elegí al menos un grupo de datos." }, { status: 400 });
  try {
    const result = await syncGoogleSheets({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      ...parsed.data,
    });
    if (!result.ok) return automationJson({ error: result.code, message: result.message }, { status: 409 });
    return automationJson({ ok: true, rows: result.rows, repeated: result.repeated });
  } catch (error) {
    if (error instanceof GoogleSheetsApiError) return automationJson({ error: error.code, message: error.safeMessage }, { status: 502 });
    console.error("[VantixApp] Google Sheets sync:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ error: "internal_error", message: "No se pudo completar la sincronización." }, { status: 500 });
  }
}
