import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isSameOriginBillingMutation } from "@/server/billing/http";
import { readLimitedRawBody } from "@/server/automation/http";

const schema = z
  .object({ organizationId: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i) })
  .strict();

export async function POST(request: Request) {
  if (!isSameOriginBillingMutation(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const rawBody = await readLimitedRawBody(request, 4 * 1024);
  if (!rawBody.ok) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  let input: unknown;
  try {
    input = JSON.parse(rawBody.rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 422 });
  }
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: parsed.data.organizationId,
        userId: session.user.id,
      },
    },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  await prisma.activeOrganizationSelection.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      organizationId: parsed.data.organizationId,
    },
    update: { organizationId: parsed.data.organizationId },
  });
  return NextResponse.json({ ok: true });
}
