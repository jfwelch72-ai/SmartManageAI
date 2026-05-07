import { logError } from "./utils/logger";
import crypto from "crypto";
import bcrypt from "bcrypt";
import type { Request, Response, NextFunction } from "express";
import { db } from "./db";
import { withOrgContext } from "./dbContext";
import { subcontractorPortalTokens } from "@shared/schema";
import { eq, and, gt, isNull } from "drizzle-orm";

export interface PortalRequest extends Request {
  portalToken?: {
    id: string;
    organizationId: string;
    projectId: string;
    crmOrganisationId: string;
    contactEmail: string;
    contactName: string;
    permissions: string[];
  };
}

export function generatePortalToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function hashPortalToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

export async function verifyPortalToken(token: string, hash: string): Promise<boolean> {
  return bcrypt.compare(token, hash);
}

// Task #1614 — deterministic per-token lookup key so we can index-fetch
// the single candidate row instead of scanning every active token and
// bcrypt-comparing each one. HMAC-SHA256 (with a server secret) is used
// rather than a plain SHA-256 so an attacker who somehow leaks the
// `token_lookup_hash` column cannot offline-brute-force the raw 256-bit
// token without also stealing SESSION_SECRET. The bcrypt hash in
// `token_hash` remains the source of truth for verification — the
// lookup hash only narrows the candidate set to exactly one row.
//
// SECRET-ROTATION CAVEAT: because the lookup hash is keyed on
// SESSION_SECRET, rotating SESSION_SECRET will make all previously
// stamped `token_lookup_hash` values fail to match. The bcrypt hash in
// `token_hash` itself is unaffected, so existing tokens won't be
// "broken" cryptographically, but they will fall through to the legacy
// NULL-hash scan path in `resolvePortalTokenRow` — which currently
// only matches rows where `token_lookup_hash IS NULL`, NOT rows whose
// stamped hash was computed under the old secret. In practice this
// means a SESSION_SECRET rotation today would orphan all currently
// active portal links until they expire (90-day TTL). If that's not
// acceptable operationally, plan a dual-key lookup (try new secret,
// then old) before rotating, and run a one-shot job to restamp
// `token_lookup_hash` under the new secret.
function getPortalTokenLookupSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length > 0) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CRITICAL SECURITY ERROR: SESSION_SECRET must be set to compute portal token lookup hashes.",
    );
  }
  // Non-production fallback so dev/test environments (where SESSION_SECRET
  // may legitimately be unset) can still mint and verify portal tokens.
  // Production paths above always throw if the secret is missing.
  return "portal-token-lookup-dev-fallback-secret";
}

export function computePortalTokenLookupHash(rawToken: string): string {
  return crypto
    .createHmac("sha256", getPortalTokenLookupSecret())
    .update(rawToken)
    .digest("hex");
}

// Task #1614 — Resolve a raw portal token to its row in O(1) at typical
// scale. Strategy:
//   1. Compute the deterministic lookup hash and grab the single
//      matching active+unexpired row by index.
//   2. bcrypt-verify that one row's `token_hash` to defeat any (vanishing)
//      lookup-hash collision risk.
//   3. If no indexed match, fall back to scanning the legacy rows that
//      pre-date the `token_lookup_hash` column (i.e. NULL lookup hash)
//      so live tokens minted before the migration keep working.
//      On a successful legacy match we opportunistically backfill the
//      lookup hash so subsequent auths take the fast path.
//
// Returns the matched row, or null if no active+unexpired token matches.
export async function resolvePortalTokenRow(
  rawToken: string,
): Promise<typeof subcontractorPortalTokens.$inferSelect | null> {
  const lookupHash = computePortalTokenLookupHash(rawToken);

  const candidates = await db
    .select()
    .from(subcontractorPortalTokens)
    .where(
      and(
        eq(subcontractorPortalTokens.tokenLookupHash, lookupHash),
        eq(subcontractorPortalTokens.status, "active"),
        gt(subcontractorPortalTokens.expiresAt, new Date()),
      ),
    );

  for (const t of candidates) {
    if (await bcrypt.compare(rawToken, t.tokenHash)) {
      return t;
    }
  }

  // Legacy fallback: only scan rows that pre-date the lookup-hash
  // column. Once all legacy rows have either been re-authenticated
  // (and lazily backfilled below), expired, or been revoked, this
  // fallback set shrinks to zero and the auth path is purely O(1).
  const legacyRows = await db
    .select()
    .from(subcontractorPortalTokens)
    .where(
      and(
        isNull(subcontractorPortalTokens.tokenLookupHash),
        eq(subcontractorPortalTokens.status, "active"),
        gt(subcontractorPortalTokens.expiresAt, new Date()),
      ),
    );

  for (const t of legacyRows) {
    if (await bcrypt.compare(rawToken, t.tokenHash)) {
      // Opportunistic backfill so future requests for this token use
      // the fast indexed path. Best-effort: if the UPDATE fails (e.g.
      // unique-constraint race against a concurrent re-issue), we still
      // honor the successful auth — the next request will retry.
      try {
        await db
          .update(subcontractorPortalTokens)
          .set({ tokenLookupHash: lookupHash })
          .where(eq(subcontractorPortalTokens.id, t.id));
      } catch (err) {
        logError(
          "[portalAuth] Failed to backfill token_lookup_hash for legacy row",
          { tokenId: t.id },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
      return t;
    }
  }

  return null;
}

// Task #2478 — SSE bypass list (mirrors `server/middleware/orgContext.ts`).
// Long-lived streaming portal endpoints must not pin a pg pool client.
const PORTAL_SSE_BYPASS_PATHS: ReadonlyArray<string> = [
  "/portal/chat/events",
];

export async function requirePortalAuth(req: PortalRequest, res: Response, next: NextFunction): Promise<void> {
  const rawToken = (req.query.token as string) || req.headers["x-portal-token"] as string;

  if (!rawToken) {
    res.status(401).json({ error: "Portal access token required" });
    return;
  }

  try {
    const matchedToken = await resolvePortalTokenRow(rawToken);

    if (!matchedToken) {
      res.status(401).json({ error: "Invalid or expired portal access token" });
      return;
    }

    req.portalToken = {
      id: matchedToken.id,
      organizationId: matchedToken.organizationId,
      projectId: matchedToken.projectId,
      crmOrganisationId: matchedToken.crmOrganisationId,
      contactEmail: matchedToken.contactEmail,
      contactName: matchedToken.contactName,
      permissions: matchedToken.permissions || ["view"],
    };

    // Task #2478 — wrap subsequent route execution in a tenant-scoped DB
    // context so portal-token-authenticated routes get the same RLS
    // protection as `req.user`-authenticated routes. SSE endpoints
    // bypass to avoid pinning a pool client for the stream lifetime.
    const isSse = PORTAL_SSE_BYPASS_PATHS.includes(req.path);
    if (isSse) {
      await db
        .update(subcontractorPortalTokens)
        .set({ lastAccessedAt: new Date() })
        .where(eq(subcontractorPortalTokens.id, matchedToken.id));
      next();
      return;
    }

    await withOrgContext(
      {
        organizationId: matchedToken.organizationId,
        isSuperadmin: false,
        source: `portal:${req.method} ${req.path}`,
      },
      () =>
        new Promise<void>((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          res.on("finish", settle);
          res.on("close", settle);
          // The lastAccessedAt update now runs INSIDE the org context.
          db
            .update(subcontractorPortalTokens)
            .set({ lastAccessedAt: new Date() })
            .where(eq(subcontractorPortalTokens.id, matchedToken.id))
            .catch((err) => {
              logError(
                "[requirePortalAuth] lastAccessedAt update failed",
                { tokenId: matchedToken.id },
                err instanceof Error ? err : new Error(String(err)),
              );
            })
            .finally(() => next());
        }),
    );
  } catch (error) {
    next(error);
  }
}

export function requirePortalPermission(permission: string) {
  return (req: PortalRequest, res: Response, next: NextFunction): void => {
    if (!req.portalToken) {
      res.status(401).json({ error: "Portal access required" });
      return;
    }
    if (!req.portalToken.permissions.includes(permission)) {
      res.status(403).json({ error: `Permission '${permission}' is required for this action` });
      return;
    }
    next();
  };
}
