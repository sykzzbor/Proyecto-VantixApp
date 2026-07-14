import { automationPeriodSchema } from "@/lib/validations/automation";
import { getAutomationOverview } from "@/server/automation/dashboard";
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
  const period = automationPeriodSchema.safeParse(url.searchParams.get("period") ?? "7d");
  if (!period.success) {
    return automationJson(
      { error: "invalid_query", message: "El período no es válido." },
      { status: 400 }
    );
  }
  const overview = await getAutomationOverview(
    authorization.ctx.organizationId,
    period.data
  );
  return automationJson({ overview });
}
