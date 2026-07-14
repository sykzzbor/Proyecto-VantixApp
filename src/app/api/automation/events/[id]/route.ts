import { can } from "@/lib/permissions";
import { automationEventIdSchema } from "@/lib/validations/automation";
import { getAutomationEventDetail } from "@/server/automation/dashboard";
import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAutomationRequest(request, "automation.view");
  if (!authorization.ok) return authorization.response;
  const parsed = automationEventIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_id", message: "El identificador no es válido." },
      { status: 400 }
    );
  }
  const event = await getAutomationEventDetail(
    authorization.ctx.organizationId,
    parsed.data,
    can(authorization.ctx.role, "automation.manage")
  );
  if (!event) {
    return automationJson(
      { error: "not_found", message: "El evento no existe." },
      { status: 404 }
    );
  }
  return automationJson({ event });
}
