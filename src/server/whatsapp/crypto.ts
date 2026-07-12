import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { getCredentialsEncryptionKey } from "@/server/whatsapp/config";

const FORMAT_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const MAX_TOKEN_LENGTH = 4096;
const MAX_ENCRYPTED_LENGTH = 8192;
const AAD = Buffer.from("vantix:whatsapp-access-token:v1", "utf8");
const HEX_KEY_PATTERN = /^[a-fA-F0-9]{64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]{43}=?$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type CredentialsEncryptionKey = string | Uint8Array;

export class CredentialsEncryptionError extends Error {
  constructor() {
    super("No se pudieron procesar las credenciales.");
    this.name = "CredentialsEncryptionError";
  }
}

function decodeConfiguredKey(value: string): Buffer {
  const encoded = value.trim();

  if (HEX_KEY_PATTERN.test(encoded)) {
    return Buffer.from(encoded, "hex");
  }

  if (!BASE64_PATTERN.test(encoded)) {
    throw new CredentialsEncryptionError();
  }

  const decoded = Buffer.from(encoded, "base64");
  const canonicalInput = encoded.replace(/=+$/, "");
  const canonicalDecoded = decoded.toString("base64").replace(/=+$/, "");
  if (decoded.length !== 32 || canonicalInput !== canonicalDecoded) {
    throw new CredentialsEncryptionError();
  }

  return decoded;
}

function resolveKey(key?: CredentialsEncryptionKey): Buffer {
  try {
    if (typeof key === "string") return decodeConfiguredKey(key);

    if (key instanceof Uint8Array) {
      if (key.byteLength !== 32) throw new CredentialsEncryptionError();
      return Buffer.from(key);
    }

    return decodeConfiguredKey(getCredentialsEncryptionKey());
  } catch {
    throw new CredentialsEncryptionError();
  }
}

function decodeBase64UrlSegment(value: string, expectedLength?: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new CredentialsEncryptionError();
  }

  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new CredentialsEncryptionError();
  }

  return decoded;
}

/**
 * Cifra el access token con AES-256-GCM. El resultado incluye una version,
 * un IV aleatorio y el tag de autenticacion; nunca contiene la clave.
 */
export function encryptAccessToken(
  token: string,
  key?: CredentialsEncryptionKey
): string {
  try {
    const plaintext = token.trim();
    if (!plaintext || plaintext.length > MAX_TOKEN_LENGTH) {
      throw new CredentialsEncryptionError();
    }

    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, resolveKey(key), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    cipher.setAAD(AAD);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      FORMAT_VERSION,
      iv.toString("base64url"),
      authTag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } catch {
    throw new CredentialsEncryptionError();
  }
}

/** Descifra un token previamente generado por encryptAccessToken. */
export function decryptAccessToken(
  encrypted: string,
  key?: CredentialsEncryptionKey
): string {
  try {
    if (!encrypted || encrypted.length > MAX_ENCRYPTED_LENGTH) {
      throw new CredentialsEncryptionError();
    }
    const parts = encrypted.split(".");
    if (parts.length !== 4 || parts[0] !== FORMAT_VERSION) {
      throw new CredentialsEncryptionError();
    }

    const iv = decodeBase64UrlSegment(parts[1] ?? "", IV_LENGTH);
    const authTag = decodeBase64UrlSegment(parts[2] ?? "", AUTH_TAG_LENGTH);
    const ciphertext = decodeBase64UrlSegment(parts[3] ?? "");
    const decipher = createDecipheriv(ALGORITHM, resolveKey(key), iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAAD(AAD);
    decipher.setAuthTag(authTag);

    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");

    if (!plaintext) throw new CredentialsEncryptionError();
    return plaintext;
  } catch {
    throw new CredentialsEncryptionError();
  }
}
