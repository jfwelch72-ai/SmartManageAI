/**
 * Task #2948 — AES-256-GCM key vault for per-org BYOK AI provider keys.
 *
 * Keys are stored encrypted at rest in `org_ai_keys`. The master secret lives
 * in the `KEY_VAULT_SECRET` environment variable (32+ byte hex or passphrase).
 * A 256-bit AES key is derived from the secret via SHA-256.
 *
 * The encrypted payload format is:
 *   <16-byte IV (hex)>:<auth-tag (hex)>:<ciphertext (hex)>
 *
 * Never log or return plaintext keys outside this module.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { logWarn } from "../utils/logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 16;
const TAG_BYTES = 16;

function getDerivedKey(): Buffer {
  const secret = process.env.KEY_VAULT_SECRET;
  if (!secret) {
    throw new Error(
      "KEY_VAULT_SECRET environment variable is not set. " +
      "Add a random 32+ character secret to enable BYOK AI key storage.",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptKey(plaintext: string): string {
  const masterKey = getDerivedKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptKey(ciphertext: string): string {
  const masterKey = getDerivedKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted key format");
  }
  const [ivHex, tagHex, encHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(encHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

export function isKeyVaultConfigured(): boolean {
  return !!process.env.KEY_VAULT_SECRET;
}

export function warnIfKeyVaultUnconfigured(): void {
  if (!isKeyVaultConfigured()) {
    logWarn(
      "KEY_VAULT_SECRET is not set — BYOK AI key storage is unavailable. " +
      "Set this environment variable to enable per-org AI provider keys.",
    );
  }
}
