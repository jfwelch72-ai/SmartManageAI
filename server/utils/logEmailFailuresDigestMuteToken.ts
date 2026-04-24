import jwt from "jsonwebtoken";

// Task #1746 — Per-recipient mute link for the daily project log email
// failures digest (`PROJECT_LOG_EMAIL_FAILURES_DIGEST`). Mirrors the
// SWPPP overdue (`swpppMuteToken.ts`) and Davis-Bacon
// (`davisBaconMuteToken.ts`) mute tokens: signed with SESSION_SECRET,
// scope-locked, and bound to the recipient's userId so the endpoint
// can only mute *their* preferences (no cross-tenant abuse).

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error(
    "CRITICAL SECURITY ERROR: SESSION_SECRET must be set to sign log-email-failures-digest mute tokens.",
  );
}

const LOG_EMAIL_FAILURES_DIGEST_MUTE_SCOPE = "mute_log_email_failures_digest";
const TOKEN_TTL = "30d";

export interface LogEmailFailuresDigestMuteTokenPayload {
  userId: string;
  scope: typeof LOG_EMAIL_FAILURES_DIGEST_MUTE_SCOPE;
}

export function signLogEmailFailuresDigestMuteToken(userId: string): string {
  return jwt.sign(
    { userId, scope: LOG_EMAIL_FAILURES_DIGEST_MUTE_SCOPE },
    SECRET as string,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyLogEmailFailuresDigestMuteToken(
  token: string,
): LogEmailFailuresDigestMuteTokenPayload | null {
  try {
    const decoded = jwt.verify(
      token,
      SECRET as string,
    ) as Partial<LogEmailFailuresDigestMuteTokenPayload>;
    if (
      typeof decoded?.userId !== "string" ||
      decoded.userId.length === 0 ||
      decoded.scope !== LOG_EMAIL_FAILURES_DIGEST_MUTE_SCOPE
    ) {
      return null;
    }
    return { userId: decoded.userId, scope: LOG_EMAIL_FAILURES_DIGEST_MUTE_SCOPE };
  } catch {
    return null;
  }
}

export function buildLogEmailFailuresDigestMuteUrl(
  baseUrl: string,
  userId: string,
): string {
  const token = signLogEmailFailuresDigestMuteToken(userId);
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/api/notifications/mute/log-email-failures-digest?token=${encodeURIComponent(token)}`;
}
