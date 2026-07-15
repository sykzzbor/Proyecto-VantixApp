import { automationRuleUpdateSchema } from "@/lib/validations/automation-rules";
import { AUTOMATION_RULE_PERMISSIONS, can } from "@/lib/permissions";
import {
  authorizeAutomationRequest,
  automationJson,
  readLimitedRawBody,
} from "@/server/automation/http";
import {
  AutomationRuleConflictError,
  getAutomationRules,
  updateAutomationRule,
} from "@/server/automation/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RULE_BODY_BYTES = 8 * 1024;

export async function GET(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    AUTOMATION_RULE_PERMISSIONS.read
  );
  if (!authorization.ok) return authorization.response;
  const rules = await getAutomationRules(authorization.ctx.organizationId, {
    redactSensitiveConfig: !can(
      authorization.ctx.role,
      AUTOMATION_RULE_PERMISSIONS.manage
    ),
  });
  return automationJson({ rules });
}

export async function PATCH(request: Request) {
  const authorization = await authorizeAutomationRequest(
    request,
    AUTOMATION_RULE_PERMISSIONS.manage
  );
  if (!authorization.ok) return authorization.response;

  const bodyResult = await readLimitedRawBody(request, MAX_RULE_BODY_BYTES);
  if (!bodyResult.ok) {
    return automationJson(
      {
        error:
          bodyResult.reason === "too_large"
            ? "payload_too_large"
            : "invalid_body",
        message:
          bodyResult.reason === "too_large"
            ? "La configuración es demasiado grande."
            : "El cuerpo no es válido.",
      },
      { status: bodyResult.reason === "too_large" ? 413 : 400 }
    );
  }
  const rawBody = bodyResult.rawBody;

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return automationJson(
      { error: "invalid_body", message: "El cuerpo no es válido." },
      { status: 400 }
    );
  }
  const parsed = automationRuleUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return automationJson(
      {
        error: "invalid_rule",
        message:
          parsed.error.issues[0]?.message ??
          "La configuración de la regla no es válida.",
      },
      { status: 400 }
    );
  }

  try {
    const rule = await updateAutomationRule({
      organizationId: authorization.ctx.organizationId,
      userId: authorization.ctx.userId,
      rule: parsed.data,
    });
    return automationJson({ ok: true, rule });
  } catch (error) {
    if (error instanceof AutomationRuleConflictError) {
      return automationJson(
        {
          error: "conflict",
          message: "La regla cambió mientras la estabas editando. Recargá y volvé a intentar.",
        },
        { status: 409 }
      );
    }
    console.error(
      "[VantixApp] actualización de regla:",
      error instanceof Error ? error.name : "unknown_error"
    );
    return automationJson(
      {
        error: "internal_error",
        message: "No se pudo guardar la regla.",
      },
      { status: 500 }
    );
  }
}
