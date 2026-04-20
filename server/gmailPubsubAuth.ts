/**
 * Verifies Google Pub/Sub OIDC push JWTs for the Gmail webhook (Task #542).
 *
 * Pub/Sub signs each push delivery with a service-account-issued OIDC token
 * in the `Authorization: Bearer <jwt>` header. Verifying this token against
 * Google's published public keys hardens the webhook against URL leaks: even
 * if the shared-secret query token is exfiltrated, an attacker cannot mint
 * a token signed by Google.
 *
 * Configuration (env vars):
 *   GMAIL_PUBSUB_AUDIENCE          required to enable verification. Must
 *                                  match the `audience` configured on the
 *                                  Pub/Sub push subscription (typically the
 *                                  full webhook URL or a custom string).
 *   GMAIL_PUBSUB_SERVICE_ACCOUNT   optional. If set, the token's `email`
 *                                  claim must match this service-account
 *                                  address (e.g. gmail-pubsub@my-project.
 *                                  iam.gserviceaccount.com).
 */

import jwt, { type JwtHeader } from "jsonwebtoken";
import { logWarn } from "./utils/logger";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const ALLOWED_ISSUERS = new Set([
  "https://accounts.google.com",
  "accounts.google.com",
]);

interface CertCache {
  keys: Record<string, string>;
  expiresAt: number;
}

let certCache: CertCache | null = null;
// Exposed for tests so they can reset between runs.
export function __resetGmailPubsubCertCacheForTests(): void {
  certCache = null;
}

async function fetchGoogleCerts(): Promise<CertCache> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache;

  const resp = await fetch(GOOGLE_CERTS_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Google certs: ${resp.status}`);
  }
  const keys = (await resp.json()) as Record<string, string>;

  // Honour Cache-Control max-age so we don't hammer Google's endpoint, but
  // never cache for less than 5 minutes or longer than 24 hours.
  const cacheControl = resp.headers.get("cache-control") || "";
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const ttlMs = Math.max(5 * 60_000, Math.min(maxAgeSec * 1000, 24 * 60 * 60_000));

  certCache = { keys, expiresAt: Date.now() + ttlMs };
  return certCache;
}

export function getGmailPubsubAudience(): string {
  return process.env.GMAIL_PUBSUB_AUDIENCE || "";
}

export function isGmailPubsubJwtVerificationEnabled(): boolean {
  return !!getGmailPubsubAudience();
}

export interface GmailPubsubVerificationResult {
  ok: boolean;
  reason?: string;
  email?: string;
}

/**
 * Verify the bearer JWT delivered by Pub/Sub.
 *
 * Returns { ok: true } when the token is signed by Google, has not expired,
 * targets the configured audience and (optionally) was issued by the
 * configured service account. Otherwise returns { ok: false, reason }.
 */
export async function verifyGmailPubsubJwt(
  authorizationHeader: string | undefined,
  audience: string = getGmailPubsubAudience(),
  expectedEmail: string | undefined = process.env.GMAIL_PUBSUB_SERVICE_ACCOUNT,
): Promise<GmailPubsubVerificationResult> {
  if (!audience) return { ok: false, reason: "audience-not-configured" };
  if (!authorizationHeader) return { ok: false, reason: "missing-authorization-header" };

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return { ok: false, reason: "malformed-authorization-header" };
  const token = match[1].trim();

  let decoded: { header: JwtHeader; payload: Record<string, unknown> } | null;
  try {
    decoded = jwt.decode(token, { complete: true }) as
      | { header: JwtHeader; payload: Record<string, unknown> }
      | null;
  } catch {
    decoded = null;
  }
  if (!decoded?.header?.kid) return { ok: false, reason: "missing-kid" };

  let certs: CertCache;
  try {
    certs = await fetchGoogleCerts();
  } catch (err) {
    return { ok: false, reason: `cert-fetch-failed: ${String(err)}` };
  }
  let publicKey = certs.keys[decoded.header.kid];
  if (!publicKey) {
    // Force a refresh in case Google rotated keys mid-request.
    certCache = null;
    try {
      certs = await fetchGoogleCerts();
    } catch (err) {
      return { ok: false, reason: `cert-fetch-failed: ${String(err)}` };
    }
    publicKey = certs.keys[decoded.header.kid];
  }
  if (!publicKey) return { ok: false, reason: "unknown-kid" };

  let payload: Record<string, unknown>;
  try {
    payload = jwt.verify(token, publicKey, {
      algorithms: ["RS256"],
      audience,
    }) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, reason: `verify-failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const iss = typeof payload.iss === "string" ? payload.iss : "";
  if (!ALLOWED_ISSUERS.has(iss)) {
    return { ok: false, reason: `unexpected-issuer: ${iss}` };
  }

  const email = typeof payload.email === "string" ? payload.email : undefined;
  if (expectedEmail) {
    if (!email || email.toLowerCase() !== expectedEmail.toLowerCase()) {
      return { ok: false, reason: `unexpected-email: ${email ?? "(none)"}` };
    }
    const verified = payload.email_verified;
    if (verified !== true && verified !== "true") {
      return { ok: false, reason: "email-not-verified" };
    }
  }

  return { ok: true, email };
}

/**
 * Convenience wrapper that logs verification failures so operators can spot
 * misconfigurations or attacks.
 */
export async function verifyGmailPubsubJwtAndLog(
  authorizationHeader: string | undefined,
): Promise<boolean> {
  const result = await verifyGmailPubsubJwt(authorizationHeader);
  if (!result.ok) {
    logWarn("Gmail Pub/Sub JWT verification failed", { reason: result.reason });
    return false;
  }
  return true;
}
