import { logError } from "./utils/logger";
import { Router, type Request, type Response, NextFunction } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
type AuthenticatorTransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
import { db } from "./db";
import { passkeyCredentials, users, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  generateToken,
  setAuthCookie,
  requireAuth,
  type AuthRequest,
} from "./auth";
import crypto from "crypto";

const router = Router();

const challenges = new Map<string, { challenge: string; expires: number }>();

function storeChallenge(key: string, challenge: string) {
  challenges.set(key, { challenge, expires: Date.now() + 5 * 60 * 1000 });
}

function getAndDeleteChallenge(key: string): string | null {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of challenges) {
    if (entry.expires < now) challenges.delete(key);
  }
}, 60 * 1000);

const RP_NAME = "SmartManageAI";

/**
 * Task #2190 — Per-request WebAuthn relying-party config.
 *
 * The browser permanently binds a passkey to the rpID it was registered
 * under. Hard-coding rpID from a single env var at boot breaks login any
 * time the runtime hostname doesn't match (new Replit dev URL, deployed
 * `*.replit.app` domain, custom domain). We therefore derive rpID + origin
 * from the inbound request and validate the host against an allowlist
 * built from the env vars we trust.
 */
function buildAllowedHosts(): Set<string> {
  const hosts = new Set<string>();
  const add = (host: string | null | undefined) => {
    if (!host) return;
    const trimmed = host.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  };

  add(process.env.REPLIT_DEV_DOMAIN);
  add(process.env.WEBAUTHN_RP_ID);

  if (process.env.WEBAUTHN_ORIGIN) {
    try {
      add(new URL(process.env.WEBAUTHN_ORIGIN).hostname);
    } catch {
      // ignore malformed override
    }
  }

  if (process.env.REPLIT_DOMAINS) {
    for (const d of process.env.REPLIT_DOMAINS.split(",")) {
      add(d);
    }
  }

  // Local development convenience. We never accept localhost in production
  // because it can't reach a deployed app and shouldn't satisfy the
  // allowlist there even by accident.
  if (process.env.NODE_ENV !== "production") {
    add("localhost");
    add("127.0.0.1");
  }

  return hosts;
}

interface RpConfig {
  rpName: string;
  rpID: string;
  origin: string;
}

/**
 * Derive the RP ID + expected origin from the incoming request. Prefer the
 * `Origin` header (set by the browser on fetch/XHR with credentials) and
 * fall back to `X-Forwarded-Host` and finally `Host`. Validates the
 * derived host against `buildAllowedHosts()` and returns `null` (with a
 * reason) when the host isn't on the allowlist — callers respond 400.
 */
function getRpConfigForRequest(req: Request): RpConfig | { error: string; host: string } {
  const allowedHosts = buildAllowedHosts();

  const originHeader = req.get("origin");
  let host: string | null = null;
  let scheme = "https";

  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      host = parsed.hostname.toLowerCase();
      // Honour the scheme the browser actually used so localhost dev
      // (http) works without us forcing https.
      scheme = parsed.protocol.replace(":", "");
    } catch {
      // fall through
    }
  }

  if (!host) {
    const fwd = req.get("x-forwarded-host");
    const rawHost = (fwd ? fwd.split(",")[0] : req.get("host")) || "";
    host = rawHost.split(":")[0].trim().toLowerCase() || null;
    const fwdProto = req.get("x-forwarded-proto");
    if (fwdProto) {
      scheme = fwdProto.split(",")[0].trim().toLowerCase();
    } else if (host === "localhost" || host === "127.0.0.1") {
      scheme = "http";
    }
  }

  if (!host) {
    return { error: "Could not determine request host", host: "" };
  }

  if (!allowedHosts.has(host)) {
    return {
      error: `Host '${host}' is not on the WebAuthn allowlist. Add it to REPLIT_DOMAINS or WEBAUTHN_RP_ID/WEBAUTHN_ORIGIN.`,
      host,
    };
  }

  // For localhost dev the port matters in `origin` (browser sends e.g.
  // http://localhost:5000), but the RP ID is always just the hostname.
  let originPort = "";
  if (originHeader) {
    try {
      const parsed = new URL(originHeader);
      if (parsed.port) originPort = `:${parsed.port}`;
    } catch {
      // ignore
    }
  }

  return {
    rpName: RP_NAME,
    rpID: host,
    origin: `${scheme}://${host}${originPort}`,
  };
}

router.post(
  "/api/auth/passkey/register-options",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const rp = getRpConfigForRequest(req);
      if ("error" in rp) {
        res.status(400).json({ error: rp.error });
        return;
      }

      // Only exclude credentials registered for THIS rpID — credentials
      // registered on another domain wouldn't be offered by the browser
      // anyway, and the unique credential_id constraint still prevents
      // re-registering the exact same authenticator twice.
      const existingCreds = await db
        .select()
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, user.id));

      const sameDomainCreds = existingCreds.filter((c) => c.rpId === rp.rpID);

      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: user.email,
        userDisplayName: `${user.firstName} ${user.lastName}`,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: sameDomainCreds.map((c) => ({
          id: c.credentialId,
          type: "public-key" as const,
          transports: (c.transports as AuthenticatorTransportFuture[]) || [],
        })),
        authenticatorSelection: {
          residentKey: "required",
          requireResidentKey: true,
          userVerification: "preferred",
        },
      });

      const regSessionId = crypto.randomBytes(16).toString("hex");
      storeChallenge(`reg:${regSessionId}`, options.challenge);

      res.json({ ...options, regSessionId });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/auth/passkey/register-verify",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const rp = getRpConfigForRequest(req);
      if ("error" in rp) {
        res.status(400).json({ error: rp.error });
        return;
      }
      const { response, deviceName, regSessionId } = req.body || {};

      if (!response || !response.id || !response.response || !regSessionId) {
        res.status(400).json({ error: "Invalid registration response" });
        return;
      }

      const expectedChallenge = getAndDeleteChallenge(`reg:${regSessionId}`);
      if (!expectedChallenge) {
        res.status(400).json({ error: "Challenge expired or not found. Please try again." });
        return;
      }

      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
      });

      if (!verification.verified || !verification.registrationInfo) {
        res.status(400).json({ error: "Passkey registration verification failed" });
        return;
      }

      const { credential } = verification.registrationInfo;

      const publicKeyBase64 = Buffer.from(credential.publicKey).toString("base64");

      const existingCred = await db
        .select({ id: passkeyCredentials.id })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.credentialId, credential.id))
        .limit(1);

      if (existingCred.length > 0) {
        res.status(409).json({ error: "This passkey is already registered" });
        return;
      }

      await db.insert(passkeyCredentials).values({
        userId: user.id,
        credentialId: credential.id,
        publicKey: publicKeyBase64,
        counter: credential.counter,
        transports: (credential.transports as string[]) || [],
        deviceName: typeof deviceName === "string" ? deviceName.slice(0, 100) : "Passkey",
        rpId: rp.rpID,
      });

      res.json({ verified: true });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/auth/passkey/auth-options",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const rp = getRpConfigForRequest(req);
      if ("error" in rp) {
        res.status(400).json({ error: rp.error });
        return;
      }

      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "preferred",
      });

      const sessionId = crypto.randomBytes(16).toString("hex");
      storeChallenge(`auth:${sessionId}`, options.challenge);

      res.json({ ...options, sessionId });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/auth/passkey/auth-verify",
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const rp = getRpConfigForRequest(req);
      if ("error" in rp) {
        res.status(400).json({ error: rp.error });
        return;
      }
      const { response, sessionId } = req.body || {};

      if (!response || !response.id || !sessionId) {
        res.status(400).json({ error: "Invalid authentication request" });
        return;
      }

      const expectedChallenge = getAndDeleteChallenge(`auth:${sessionId}`);
      if (!expectedChallenge) {
        res.status(400).json({ error: "Challenge expired or not found. Please try again." });
        return;
      }

      const credentialId = response.id;
      const [cred] = await db
        .select()
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.credentialId, credentialId))
        .limit(1);

      if (!cred) {
        res.status(400).json({
          error: "No passkey is registered for this domain — please sign in another way and register a new passkey.",
          code: "NO_PASSKEY_FOR_DOMAIN",
        });
        return;
      }

      // Task #2190 — refuse to verify a credential against a different
      // rpID than the one it was registered with. WebAuthn would reject
      // the assertion anyway, but failing fast with a specific code lets
      // the login form show a clear "register a new passkey" message
      // instead of a generic "authentication failed". Legacy rows with
      // NULL rpId predate per-credential tracking and are forced into
      // re-registration too.
      if (!cred.rpId || cred.rpId !== rp.rpID) {
        res.status(400).json({
          error: "No passkey is registered for this domain — please sign in another way and register a new passkey.",
          code: "RPID_MISMATCH",
          registeredOn: cred.rpId ?? null,
        });
        return;
      }

      const publicKeyBytes = Buffer.from(cred.publicKey, "base64");

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: rp.origin,
          expectedRPID: cred.rpId,
          credential: {
            id: cred.credentialId,
            publicKey: new Uint8Array(publicKeyBytes),
            counter: cred.counter,
            transports: (cred.transports as AuthenticatorTransportFuture[]) || [],
          },
        });
      } catch (verifyErr: any) {
        // Task #2190 — simplewebauthn throws when the assertion's RP ID
        // hash or origin doesn't match what we expect. Map those to the
        // explicit RPID_MISMATCH code so the client can show the
        // domain-specific message instead of a generic 500.
        const msg = String(verifyErr?.message || "");
        if (/RP ID|rpId|origin|RPIDHash/i.test(msg)) {
          res.status(400).json({
            error: "No passkey is registered for this domain — please sign in another way and register a new passkey.",
            code: "RPID_MISMATCH",
            registeredOn: cred.rpId ?? null,
          });
          return;
        }
        throw verifyErr;
      }

      if (!verification.verified) {
        res.status(400).json({ error: "Passkey authentication failed" });
        return;
      }

      await db
        .update(passkeyCredentials)
        .set({ counter: verification.authenticationInfo.newCounter })
        .where(eq(passkeyCredentials.id, cred.id));

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, cred.userId))
        .limit(1);

      if (!user || !user.isActive) {
        res.status(403).json({ error: "Account is disabled" });
        return;
      }

      if (user.role !== "SUPER_ADMIN" && user.organizationId) {
        const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
        if (org && !org.isActive) {
          res.status(403).json({ error: "Your organization has been suspended. Please contact support.", suspended: true });
          return;
        }
      }

      const token = generateToken(user.id, user.tokenVersion ?? 0);
      setAuthCookie(res, token);

      const redirectPath = user.role === "SUPER_ADMIN"
        ? "/admin"
        : user.role === "HUSTLER"
        ? "/hustler"
        : !user.organizationId
        ? "/onboarding"
        : "/dashboard";

      res.json({
        verified: true,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        },
        redirectTo: redirectPath,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/api/auth/passkey/credentials",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const creds = await db
        .select({
          id: passkeyCredentials.id,
          deviceName: passkeyCredentials.deviceName,
          rpId: passkeyCredentials.rpId,
          createdAt: passkeyCredentials.createdAt,
        })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, user.id));

      // Surface the rpID this request is being served on so the settings
      // panel can call out which credentials are usable on the current
      // domain vs. stale ones from an old dev URL.
      const rp = getRpConfigForRequest(req);
      const currentRpId = "error" in rp ? null : rp.rpID;

      res.json({
        credentials: creds.map((c) => ({
          ...c,
          isCurrentDomain: c.rpId !== null && c.rpId === currentRpId,
        })),
        currentRpId,
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/api/auth/passkey/credentials/:id",
  requireAuth,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const [cred] = await db
        .select()
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.id, id))
        .limit(1);

      if (!cred || cred.userId !== user.id) {
        res.status(404).json({ error: "Passkey not found" });
        return;
      }

      await db.delete(passkeyCredentials).where(eq(passkeyCredentials.id, id));

      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
