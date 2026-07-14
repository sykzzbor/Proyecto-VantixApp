import { getAutomationInfrastructureStatus } from "@/server/automation/dashboard";
import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorization = await authorizeAutomationRequest(request, "automation.view");
  if (!authorization.ok) return authorization.response;
  const status = await getAutomationInfrastructureStatus(
    authorization.ctx.organizationId
  );
  return automationJson({ status });
}
