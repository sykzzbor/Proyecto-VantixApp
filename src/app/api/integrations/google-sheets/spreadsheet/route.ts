import { z } from "zod";
import { authorizeAutomationRequest, automationJson, readLimitedRawBody } from "@/server/automation/http";
import { GoogleSheetsApiError } from "@/server/integrations/google-sheets/oauth";
import { chooseGoogleSpreadsheet, createAndChooseGoogleSpreadsheet } from "@/server/integrations/google-sheets/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("create"), name: z.string().trim().min(3).max(120) }).strict(),
  z.object({ mode: z.literal("select"), reference: z.string().trim().min(20).max(1000) }).strict(),
]);

export async function POST(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "integrations.manage", "google_sheets");
  if (!authorization.ok) return authorization.response;
  const body = await readLimitedRawBody(request, 2048);
  if (!body.ok) return automationJson({ error: "invalid_body", message: "La solicitud no es válida." }, { status: body.reason === "too_large" ? 413 : 400 });
  let raw: unknown;
  try { raw = JSON.parse(body.rawBody); } catch { raw = null; }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return automationJson({ error: "invalid_body", message: "Revisá los datos de la hoja." }, { status: 400 });
  try {
    const base = { organizationId: authorization.ctx.organizationId, userId: authorization.ctx.userId };
    const result = parsed.data.mode === "create"
      ? await createAndChooseGoogleSpreadsheet({ ...base, name: parsed.data.name })
      : await chooseGoogleSpreadsheet({ ...base, reference: parsed.data.reference });
    if (!result.ok) return automationJson({ error: result.code, message: "Ingresá una URL o ID válido de Google Sheets." }, { status: 400 });
    return automationJson({ ok: true, name: result.name });
  } catch (error) {
    if (error instanceof GoogleSheetsApiError) return automationJson({ error: error.code, message: error.safeMessage }, { status: 502 });
    console.error("[VantixApp] Google Sheets spreadsheet:", error instanceof Error ? error.name : "unknown_error");
    return automationJson({ error: "internal_error", message: "No se pudo preparar la hoja." }, { status: 500 });
  }
}
