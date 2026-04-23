import jwt from "jsonwebtoken";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error(
    "CRITICAL SECURITY ERROR: SESSION_SECRET must be set to sign SWPPP mute tokens.",
  );
}

const SWPPP_MUTE_SCOPE = "mute_swppp_overdue";
const TOKEN_TTL = "30d";

export interface SwpppMuteTokenPayload {
  userId: string;
  scope: typeof SWPPP_MUTE_SCOPE;
}

export function signSwpppMuteToken(userId: string): string {
  return jwt.sign({ userId, scope: SWPPP_MUTE_SCOPE }, SECRET as string, {
    expiresIn: TOKEN_TTL,
  });
}

export function verifySwpppMuteToken(token: string): SwpppMuteTokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET as string) as Partial<SwpppMuteTokenPayload>;
    if (
      typeof decoded?.userId !== "string" ||
      decoded.userId.length === 0 ||
      decoded.scope !== SWPPP_MUTE_SCOPE
    ) {
      return null;
    }
    return { userId: decoded.userId, scope: SWPPP_MUTE_SCOPE };
  } catch {
    return null;
  }
}

export function buildSwpppMuteUrl(baseUrl: string, userId: string): string {
  const token = signSwpppMuteToken(userId);
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/api/notifications/mute/swppp-overdue?token=${encodeURIComponent(token)}`;
}
