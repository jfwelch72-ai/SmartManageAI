import crypto from "crypto";
import { logInfo, logWarn } from "../utils/logger";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = "smartmanageai-integration-token-salt-v1";
const KEY_LENGTH = 32;
const ITERATIONS = 100000;
const DIGEST = "sha512";
const ENCRYPTED_PREFIX = "enc:";

let derivedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey;

  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY environment variable is not set");
  }

  derivedKey = crypto.pbkdf2Sync(secret, SALT, ITERATIONS, KEY_LENGTH, DIGEST);
  return derivedKey;
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");

  const authTag = cipher.getAuthTag();

  return `${ENCRYPTED_PREFIX}${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted}`;
}

export function decryptToken(encrypted: string): string {
  if (!encrypted) return encrypted;

  if (!encrypted.startsWith(ENCRYPTED_PREFIX)) {
    return encrypted;
  }

  const payload = encrypted.slice(ENCRYPTED_PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    logWarn("Invalid encrypted token format", { partsCount: parts.length });
    return encrypted;
  }

  const [ivB64, authTagB64, ciphertext] = parts;

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    logWarn("Token decryption failed — returning as-is", { error: String(err) });
    return encrypted;
  }
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptMetadata(metadata: Record<string, any>): Record<string, any> {
  if (!metadata) return metadata;

  const result = { ...metadata };

  if (result.accessToken && typeof result.accessToken === "string") {
    result.accessToken = encryptToken(result.accessToken);
  }
  if (result.refreshToken && typeof result.refreshToken === "string") {
    result.refreshToken = encryptToken(result.refreshToken);
  }

  return result;
}

export function decryptMetadata(metadata: Record<string, any>): Record<string, any> {
  if (!metadata) return metadata;

  const result = { ...metadata };

  if (result.accessToken && typeof result.accessToken === "string") {
    result.accessToken = decryptToken(result.accessToken);
  }
  if (result.refreshToken && typeof result.refreshToken === "string") {
    result.refreshToken = decryptToken(result.refreshToken);
  }

  return result;
}
