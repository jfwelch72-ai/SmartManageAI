import jwt from "jsonwebtoken";

// Task #1408 — Per-recipient mute link for the WAGE_DECISION_RATES_CHANGED
// email introduced by Task #1400. Mirrors the Davis-Bacon auto-sync
// failure mute token (`davisBaconMuteToken.ts`) and the SWPPP overdue
// mute token (`swpppMuteToken.ts`): signed with SESSION_SECRET, scope-
// locked, and bound to the recipient's userId so the endpoint can ONLY
// mute *their* preferences (no cross-tenant abuse).

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error(
    "CRITICAL SECURITY ERROR: SESSION_SECRET must be set to sign wage-decision rate-change mute tokens.",
  );
}

const WAGE_RATES_CHANGED_MUTE_SCOPE = "mute_wage_decision_rates_changed";
const TOKEN_TTL = "30d";

export interface WageDecisionRatesChangedMuteTokenPayload {
  userId: string;
  scope: typeof WAGE_RATES_CHANGED_MUTE_SCOPE;
}

export function signWageDecisionRatesChangedMuteToken(userId: string): string {
  return jwt.sign(
    { userId, scope: WAGE_RATES_CHANGED_MUTE_SCOPE },
    SECRET as string,
    { expiresIn: TOKEN_TTL },
  );
}

export function verifyWageDecisionRatesChangedMuteToken(
  token: string,
): WageDecisionRatesChangedMuteTokenPayload | null {
  try {
    const decoded = jwt.verify(
      token,
      SECRET as string,
    ) as Partial<WageDecisionRatesChangedMuteTokenPayload>;
    if (
      typeof decoded?.userId !== "string" ||
      decoded.userId.length === 0 ||
      decoded.scope !== WAGE_RATES_CHANGED_MUTE_SCOPE
    ) {
      return null;
    }
    return { userId: decoded.userId, scope: WAGE_RATES_CHANGED_MUTE_SCOPE };
  } catch {
    return null;
  }
}

export function buildWageDecisionRatesChangedMuteUrl(
  baseUrl: string,
  userId: string,
): string {
  const token = signWageDecisionRatesChangedMuteToken(userId);
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/api/notifications/mute/wage-decision-rates-changed?token=${encodeURIComponent(token)}`;
}
