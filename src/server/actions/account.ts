"use server";

import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/context";
import { recordAudit } from "@/server/audit";
import { toActionFailure, ActionError, type ActionResult } from "@/server/errors";
import { consumeThrottle } from "@/server/auth/throttle";
import { clientIpKey } from "@/server/auth/request-ip";
import { sendTransactionalEmail } from "@/server/email/send";
import { accountDeletedTemplate } from "@/server/email/templates";
import {
  credentialRequirementFor,
  DELETE_ACCOUNT_PHRASE,
  isConfirmationPhraseValid,
  isSessionRecentEnough,
  planAccountDeletion,
} from "@/server/auth/account-deletion";

/**
 * Eliminación definitiva de una cuenta.
 *
 * Reautenticación obligatoria: contraseña si la cuenta tiene una, y sesión
 * reciente si solo entra con Google (donde no hay contraseña que pedir). Se
 * suma una frase escrita a mano para que no se dispare por un clic distraído.
 *
 * El borrado corre en una transacción: o se va todo, o no se va nada. Las
 * organizaciones compartidas nunca se destruyen; si la persona era la
 * propietaria, la propiedad pasa a otro integrante antes de salir.
 */
export async function deleteAccount(input: {
  password?: string;
  confirmation: string;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session) throw new ActionError("Tenés que iniciar sesión para continuar.");

    const requestHeaders = await headers();

    // Un intento fallido no puede servir para adivinar la contraseña a fuerza
    // de repetir; el cupo es por IP y por cuenta.
    const quota = await consumeThrottle(
      "account-delete",
      `${session.user.id}:${clientIpKey(requestHeaders)}`
    );
    if (!quota.allowed) {
      throw new ActionError(
        `Demasiados intentos. Probá de nuevo en ${Math.ceil(quota.retryAfterSeconds / 60)} minutos.`
      );
    }

    if (!isConfirmationPhraseValid(input.confirmation, DELETE_ACCOUNT_PHRASE)) {
      throw new ActionError(
        `Escribí exactamente "${DELETE_ACCOUNT_PHRASE}" para confirmar.`
      );
    }

    const accounts = await prisma.account.findMany({
      where: { userId: session.user.id },
      select: { providerId: true },
    });
    const hasCredentialAccount = accounts.some(
      (account) => account.providerId === "credential"
    );
    const requirement = credentialRequirementFor({ hasCredentialAccount });

    if (requirement === "password") {
      if (!input.password) {
        throw new ActionError("Ingresá tu contraseña para confirmar.");
      }
      // Se valida contra Better Auth para no reimplementar el hash ni tocar
      // la contraseña almacenada.
      const verified = await auth.api
        .verifyPassword({
          body: { password: input.password },
          headers: requestHeaders,
        })
        .catch(() => null);
      if (!verified?.status) {
        throw new ActionError("La contraseña no es correcta.");
      }
    } else {
      const current = await prisma.session.findUnique({
        where: { token: session.session.token },
        select: { createdAt: true },
      });
      if (
        !current ||
        !isSessionRecentEnough({ sessionCreatedAt: current.createdAt, now: new Date() })
      ) {
        throw new ActionError(
          "Por seguridad, volvé a iniciar sesión con Google antes de eliminar la cuenta."
        );
      }
    }

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: session.user.id },
      select: { organizationId: true },
    });
    const organizationIds = memberships.map((m) => m.organizationId);

    const allMembers = organizationIds.length
      ? await prisma.organizationMember.findMany({
          where: { organizationId: { in: organizationIds } },
          select: {
            organizationId: true,
            userId: true,
            role: true,
            createdAt: true,
          },
        })
      : [];

    const plan = planAccountDeletion({
      leavingUserId: session.user.id,
      organizations: organizationIds.map((organizationId) => ({
        organizationId,
        members: allMembers.filter((m) => m.organizationId === organizationId),
      })),
    });

    // La auditoría se escribe ANTES de borrar: las filas de las
    // organizaciones que se eliminan se van con ellas, y las de las
    // organizaciones que sobreviven tienen que conservar el registro.
    // Nunca se guarda el correo ni nada que identifique por fuera del id.
    for (const organizationId of [
      ...plan.organizationsToLeave,
      ...plan.transfers.map((t) => t.organizationId),
    ]) {
      await recordAudit({
        organizationId,
        userId: session.user.id,
        action: "account.deleted",
        entityType: "user",
        entityId: session.user.id,
        details: {
          transferida: plan.transfers.some((t) => t.organizationId === organizationId),
        },
      });
    }

    await prisma.$transaction(async (tx) => {
      for (const transfer of plan.transfers) {
        await tx.organizationMember.updateMany({
          where: {
            organizationId: transfer.organizationId,
            userId: transfer.newOwnerUserId,
          },
          data: { role: "OWNER" },
        });
      }

      for (const organizationId of plan.organizationsToDelete) {
        await tx.organization.delete({ where: { id: organizationId } });
      }

      // Sesiones, cuentas de proveedor, tokens de verificación, prueba
      // gratuita, membresías restantes y selección de organización activa
      // caen por las claves foráneas en cascada del esquema.
      await tx.user.delete({ where: { id: session.user.id } });
    });

    // El aviso se manda después de que el borrado quedó firme.
    await sendTransactionalEmail(
      session.user.email,
      accountDeletedTemplate({ name: session.user.name, deletedAt: new Date() })
    );

    return { ok: true };
  } catch (error) {
    return toActionFailure(error);
  }
}
