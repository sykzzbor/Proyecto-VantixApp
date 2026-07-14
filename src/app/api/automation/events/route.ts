import {
  automationEventQuerySchema,
  searchParamsToObject,
} from "@/lib/validations/automation";
import {
  listAutomationEventTypes,
  listAutomationEvents,
} from "@/server/automation/dashboard";
import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "automation.view");
  if (!authorization.ok) return authorization.response;
  const url = new URL(request.url);
  const parsed = automationEventQuerySchema.safeParse(
    searchParamsToObject(url.searchParams)
  );
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_query", message: "Los filtros no son válidos." },
      { status: 400 }
    );
  }
  const [events, types] = await Promise.all([
    listAutomationEvents(authorization.ctx.organizationId, parsed.data),
    listAutomationEventTypes(authorization.ctx.organizationId),
  ]);
  return automationJson({ events, types });
}
