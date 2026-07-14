import { after } from "next/server";
import { automationEventIdSchema } from "@/lib/validations/automation";
import {
  authorizeAutomationRequest,
  automationJson,
} from "@/server/automation/http";
import { retryAutomationEvent } from "@/server/automation/operations";
import { processAutomationEventNow } from "@/server/automation/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAutomationRequest(request, "automation.manage");
  if (!authorization.ok) return authorization.response;
  const parsed = automationEventIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    return automationJson(
      { error: "invalid_id", message: "El identificador no es válido." },
      { status: 400 }
    );
  }
  const result = await retryAutomationEvent({
    id: parsed.data,
    organizationId: authorization.ctx.organizationId,
    userId: authorization.ctx.userId,
  });
  if (!result.ok) {
    return automationJson(
      { error: result.code, message: result.message },
      { status: result.code === "not_found" ? 404 : 409 }
    );
  }
  after(async () => {
    await processAutomationEventNow({
      eventId: parsed.data,
      organizationId: authorization.ctx.organizationId,
    });
  });
  return automationJson({ ok: true });
}
