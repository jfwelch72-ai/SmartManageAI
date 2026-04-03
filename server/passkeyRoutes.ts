import { logError } from "./utils/logger";
import { Router, type Response } from "express";
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

function getRpConfig() {
  if (process.env.REPLIT_DEV_DOMAIN) {
    return {
      rpName: "SmartManageAI",
      rpID: process.env.REPLIT_DEV_DOMAIN,
      origin: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    };
  }

  if (process.env.WEBAUTHN_RP_ID && process.env.WEBAUTHN_ORIGIN) {
    return {
      rpName: "SmartManageAI",
      rpID: process.env.WEBAUTHN_RP_ID,
      origin: process.env.WEBAUTHN_ORIGIN,
    };
  }

  if (process.env.REPLIT_DOMAINS) {
    const primaryDomain = process.env.REPLIT_DOMAINS.split(",")[0].trim();
    return {
      rpName: "SmartManageAI",
      rpID: primaryDomain,
      origin: `https://${primaryDomain}`,
    };
  }

  return {
    rpName: "SmartManageAI",
    rpID: "localhost",
    origin: "http://localhost:5000",
  };
}

router.post(
  "/api/auth/passkey/register-options",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const { rpName, rpID } = getRpConfig();

      const existingCreds = await db
        .select()
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, user.id));

      const options = await generateRegistrationOptions({
        rpName,
        rpID,
        userName: user.email,
        userDisplayName: `${user.firstName} ${user.lastName}`,
        userID: new TextEncoder().encode(user.id),
        attestationType: "none",
        excludeCredentials: existingCreds.map((c) => ({
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
      logError("Passkey register-options error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to generate registration options" });
    }
  }
);

router.post(
  "/api/auth/passkey/register-verify",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const { rpID, origin } = getRpConfig();
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
        expectedOrigin: origin,
        expectedRPID: rpID,
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
      });

      res.json({ verified: true });
    } catch (error) {
      logError("Passkey register-verify error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to verify registration" });
    }
  }
);

router.post(
  "/api/auth/passkey/auth-options",
  async (req: AuthRequest, res: Response) => {
    try {
      const { rpID } = getRpConfig();

      const options = await generateAuthenticationOptions({
        rpID,
        userVerification: "preferred",
      });

      const sessionId = crypto.randomBytes(16).toString("hex");
      storeChallenge(`auth:${sessionId}`, options.challenge);

      res.json({ ...options, sessionId });
    } catch (error) {
      logError("Passkey auth-options error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to generate authentication options" });
    }
  }
);

router.post(
  "/api/auth/passkey/auth-verify",
  async (req: AuthRequest, res: Response) => {
    try {
      const { rpID, origin } = getRpConfig();
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
        res.status(400).json({ error: "Passkey not recognized. Please register a passkey first." });
        return;
      }

      const publicKeyBytes = Buffer.from(cred.publicKey, "base64");

      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: cred.credentialId,
          publicKey: new Uint8Array(publicKeyBytes),
          counter: cred.counter,
          transports: (cred.transports as AuthenticatorTransportFuture[]) || [],
        },
      });

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
      logError("Passkey auth-verify error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to verify authentication" });
    }
  }
);

router.get(
  "/api/auth/passkey/credentials",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = req.user!;
      const creds = await db
        .select({
          id: passkeyCredentials.id,
          deviceName: passkeyCredentials.deviceName,
          createdAt: passkeyCredentials.createdAt,
        })
        .from(passkeyCredentials)
        .where(eq(passkeyCredentials.userId, user.id));

      res.json(creds);
    } catch (error) {
      logError("Passkey credentials list error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to list passkeys" });
    }
  }
);

router.delete(
  "/api/auth/passkey/credentials/:id",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
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
      logError("Passkey delete error:", {}, error instanceof Error ? error : new Error(String(error)));
      res.status(500).json({ error: "Failed to delete passkey" });
    }
  }
);

export default router;
