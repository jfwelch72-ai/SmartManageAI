import jwt from "jsonwebtoken";

// Task #1361 — Per-recipient mute link for Davis-Bacon auto-sync failure
// emails. Mirrors the SWPPP overdue mute token (`swpppMuteToken.ts`):
// signed with SESSION_SECRET, scope-locked, and bound to the recipient's
// userId so the endpoint can only mute *their* preferences (no cross-tenant
// abuse).

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error(
    "CRITICAL SECURITY ERROR: SESSION_SECRET must be set to sign Davis-Bacon mute tokens.",
  );
}

const DAVIS_BACON_MUTE_SCOPE = "mute_davis_bacon_auto_sync_failed";
const TOKEN_TTL = "30d";

export interface DavisBaconMuteTokenPayload {
  userId: string;
  scope: typeof DAVIS_BACON_MUTE_SCOPE;
}

export function signDavisBaconMuteToken(userId: string): string {
  return jwt.sign(
    { userId, scope: DAVIS_BACON_MUTE_SCOPE },
    SECRET as string,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyDavisBaconMuteToken(
  token: string,
): DavisBaconMuteTokenPayload | null {
  try {
    const decoded = jwt.verify(
      token,
      SECRET as string,
    ) as Partial<DavisBaconMuteTokenPayload>;
    if (
      typeof decoded?.userId !== "string" ||
      decoded.userId.length === 0 ||
      decoded.scope !== DAVIS_BACON_MUTE_SCOPE
    ) {
      return null;
    }
    return { userId: decoded.userId, scope: DAVIS_BACON_MUTE_SCOPE };
  } catch {
    return null;
  }
}

export function buildDavisBaconMuteUrl(baseUrl: string, userId: string): string {
  const token = signDavisBaconMuteToken(userId);
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/api/notifications/mute/davis-bacon-auto-sync-failed?token=${encodeURIComponent(token)}`;
}
