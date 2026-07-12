"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import {
  businessProfileSchema,
  type BusinessProfileInput,
} from "@/lib/validations/business";
import { recordAudit } from "@/server/audit";
import { getOrgContext, requirePermission } from "@/server/context";
import { toActionFailure, type ActionResult } from "@/server/errors";

export async function saveBusinessProfile(
  input: BusinessProfileInput
): Promise<ActionResult> {
  try {
    const { user, org, role } = await getOrgContext();
    requirePermission(role, "business.update");
    const data = businessProfileSchema.parse(input);

    const values = {
      name: data.name,
      description: data.description || null,
      industry: data.industry || null,
      phone: data.phone || null,
      email: data.email || null,
      website: data.website || null,
      address: data.address || null,
      city: data.city || null,
      country: data.country || null,
      openingHours: data.openingHours || null,
      paymentMethods: data.paymentMethods || null,
      shippingInfo: data.shippingInfo || null,
    };

    await prisma.businessProfile.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, ...values },
      update: values,
    });

    await recordAudit({
      organizationId: org.id,
      userId: user.id,
      action: "negocio.actualizado",
      entityType: "business_profile",
      details: { nombre: data.name },
    });

    revalidatePath("/dashboard/negocio");
    revalidatePath("/dashboard");
    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
