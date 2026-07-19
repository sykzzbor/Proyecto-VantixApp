import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/server/context";
import {
  MAX_PROFILE_IMAGE_BYTES,
  PROFILE_IMAGE_TYPES,
  ProfileImageError,
  createProfileImageDataUrl,
  findGoogleProfileImage,
} from "@/server/profile/avatar";

const ERROR_MESSAGES: Record<ProfileImageError["code"], string> = {
  invalid_type: "Usá una imagen JPG, PNG o WEBP.",
  invalid_file: "El archivo no es una imagen válida.",
  too_large: "La imagen debe pesar como máximo 1 MB.",
};

function response(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_PROFILE_IMAGE_BYTES + 128_000) {
      return response({ ok: false, message: ERROR_MESSAGES.too_large }, 413);
    }

    const session = await getSession();
    if (!session) return response({ ok: false, message: "Iniciá sesión para continuar." }, 401);
    const user = session.user;
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return response({ ok: false, message: "Seleccioná una imagen." }, 400);
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      return response({ ok: false, message: ERROR_MESSAGES.too_large }, 413);
    }
    if (!PROFILE_IMAGE_TYPES.includes(file.type as (typeof PROFILE_IMAGE_TYPES)[number])) {
      return response({ ok: false, message: ERROR_MESSAGES.invalid_type }, 400);
    }

    const data = Buffer.from(await file.arrayBuffer());
    const image = createProfileImageDataUrl({
      data,
      type: file.type,
      size: file.size,
    });
    await prisma.user.update({ where: { id: user.id }, data: { image } });
    return response({ ok: true });
  } catch (error) {
    if (error instanceof ProfileImageError) {
      return response({ ok: false, message: ERROR_MESSAGES[error.code] }, 400);
    }
    return response(
      { ok: false, message: "No se pudo guardar la foto. Intentá de nuevo." },
      500
    );
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return response({ ok: false, message: "Iniciá sesión para continuar." }, 401);
    const user = session.user;
    const googleImage = await findGoogleProfileImage(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { image: googleImage },
    });
    return response({
      ok: true,
      restoredGoogleImage: Boolean(googleImage),
      image: googleImage,
    });
  } catch {
    return response(
      { ok: false, message: "No se pudo actualizar la foto. Intentá de nuevo." },
      500
    );
  }
}
