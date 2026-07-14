import {
  automationRunQuerySchema,
  searchParamsToObject,
} from "@/lib/validations/automation";
import {
  listAutomationEventTypes,
  listAutomationProviders,
  listAutomationRuns,
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
  const parsed = automationRunQuerySchema.safeParse(
    searchParamsToObject(new URL(request.url).searchParams)
  );
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_query", message: "Los filtros no son válidos." },
      { status: 400 }
    );
  }
  const [runs, providers, types] = await Promise.all([
    listAutomationRuns(authorization.ctx.organizationId, parsed.data),
    listAutomationProviders(authorization.ctx.organizationId),
    listAutomationEventTypes(authorization.ctx.organizationId),
  ]);
  return automationJson({ runs, providers, types });
}
