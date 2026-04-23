import jwt from "jsonwebtoken";

// Task #1404 — Per-recipient mute link for INTEGRATION_SYNC_RETRIES_EXHAUSTED
// emails. Mirrors the Davis-Bacon mute token (`davisBaconMuteToken.ts`):
// signed with SESSION_SECRET, scope-locked, and bound to the recipient's
// userId so the endpoint can only mute on behalf of *them* (the endpoint
// additionally re-checks the user's admin role + organization membership
// before inserting a mute row, so a non-admin whose email got forwarded
// can't silence alerts).
//
// Unlike the Davis-Bacon mute (which flips the recipient's notification
// type preference off), this mute is scoped to the *integration* — one
// admin clicking the link quiets the alert for their whole org so
// everyone else stops getting paged too.

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error(
    "CRITICAL SECURITY ERROR: SESSION_SECRET must be set to sign integration sync mute tokens.",
  );
}

const INTEGRATION_SYNC_MUTE_SCOPE = "mute_integration_sync_retries_exhausted";
const TOKEN_TTL = "30d";

export interface IntegrationSyncMuteTokenPayload {
  userId: string;
  connectionId: string;
  entityType: string | null;
  scope: typeof INTEGRATION_SYNC_MUTE_SCOPE;
}

export function signIntegrationSyncMuteToken(
  userId: string,
  connectionId: string,
  entityType: string | null,
): string {
  return jwt.sign(
    {
      userId,
      connectionId,
      entityType: entityType ?? null,
      scope: INTEGRATION_SYNC_MUTE_SCOPE,
    },
    SECRET as string,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyIntegrationSyncMuteToken(
  token: string,
): IntegrationSyncMuteTokenPayload | null {
  try {
    const decoded = jwt.verify(
      token,
      SECRET as string,
    ) as Partial<IntegrationSyncMuteTokenPayload>;
    if (
      typeof decoded?.userId !== "string" ||
      decoded.userId.length === 0 ||
      typeof decoded.connectionId !== "string" ||
      decoded.connectionId.length === 0 ||
      decoded.scope !== INTEGRATION_SYNC_MUTE_SCOPE
    ) {
      return null;
    }
    const entityType =
      typeof decoded.entityType === "string" && decoded.entityType.length > 0
        ? decoded.entityType
        : null;
    return {
      userId: decoded.userId,
      connectionId: decoded.connectionId,
      entityType,
      scope: INTEGRATION_SYNC_MUTE_SCOPE,
    };
  } catch {
    return null;
  }
}

export function buildIntegrationSyncMuteUrl(
  baseUrl: string,
  userId: string,
  connectionId: string,
  entityType: string | null,
): string {
  const token = signIntegrationSyncMuteToken(userId, connectionId, entityType);
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/api/integrations/mute-sync-alerts?token=${encodeURIComponent(token)}`;
}
