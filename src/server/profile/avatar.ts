import { prisma } from "@/lib/prisma";

export const MAX_PROFILE_IMAGE_BYTES = 1_000_000;
export const PROFILE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

type ProfileImageType = (typeof PROFILE_IMAGE_TYPES)[number];

export class ProfileImageError extends Error {
  constructor(
    public readonly code: "invalid_type" | "invalid_file" | "too_large"
  ) {
    super("No se pudo procesar la foto de perfil.");
    this.name = "ProfileImageError";
  }
}

function hasValidSignature(data: Buffer, type: ProfileImageType): boolean {
  if (type === "image/jpeg") {
    return data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (type === "image/png") {
    return (
      data.length >= 8 &&
      data.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      )
    );
  }
  return (
    data.length >= 12 &&
    data.subarray(0, 4).toString("ascii") === "RIFF" &&
    data.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

export function createProfileImageDataUrl(input: {
  data: Buffer;
  type: string;
  size: number;
}): string {
  if (input.size <= 0 || input.data.length !== input.size) {
    throw new ProfileImageError("invalid_file");
  }
  if (input.size > MAX_PROFILE_IMAGE_BYTES) {
    throw new ProfileImageError("too_large");
  }
  if (!PROFILE_IMAGE_TYPES.includes(input.type as ProfileImageType)) {
    throw new ProfileImageError("invalid_type");
  }
  const type = input.type as ProfileImageType;
  if (!hasValidSignature(input.data, type)) {
    throw new ProfileImageError("invalid_file");
  }
  return `data:${type};base64,${input.data.toString("base64")}`;
}

export function safeUserImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (
    value.length <= Math.ceil((MAX_PROFILE_IMAGE_BYTES * 4) / 3) + 64 &&
    /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)
  ) {
    return value;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function pictureFromGoogleIdToken(idToken: string): string | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { picture?: unknown };
    return typeof parsed.picture === "string"
      ? safeUserImageUrl(parsed.picture)
      : null;
  } catch {
    return null;
  }
}

/** Recupera la foto original del login de Google sin exponer el ID token. */
export async function findGoogleProfileImage(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, providerId: "google", idToken: { not: null } },
    orderBy: { updatedAt: "desc" },
    select: { idToken: true },
  });
  return account?.idToken ? pictureFromGoogleIdToken(account.idToken) : null;
}
