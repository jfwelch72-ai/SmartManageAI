import { Router } from "express";
import jwt from "jsonwebtoken";
import * as keyService from "./apiKeyService";
import crypto from "crypto";

const router = Router();

// Use a dedicated public-API signing secret if provided; otherwise derive a
// distinct, namespaced key from SESSION_SECRET to keep token domains separated.
const sessionSecret = process.env.SESSION_SECRET;
if (!process.env.PUBLIC_API_JWT_SECRET && !sessionSecret) {
  throw new Error("PUBLIC_API_JWT_SECRET or SESSION_SECRET is required for public API OAuth token signing");
}
const JWT_SECRET = process.env.PUBLIC_API_JWT_SECRET
  || crypto.createHash("sha256").update(`public_api_v1:${sessionSecret}`).digest("hex");
const JWT_AUDIENCE = "smartmanage:public_api";
const JWT_ISSUER = "smartmanage";
const TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

interface PublicApiTokenClaims {
  sub: string;
  org: string;
  scopes: string[];
  type: "public_api";
}

export function signPublicApiToken(claims: PublicApiTokenClaims): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS, audience: JWT_AUDIENCE, issuer: JWT_ISSUER });
}

export function verifyPublicApiToken(token: string): PublicApiTokenClaims | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { audience: JWT_AUDIENCE, issuer: JWT_ISSUER }) as any;
    if (decoded?.type !== "public_api") return null;
    return decoded as PublicApiTokenClaims;
  } catch {
    return null;
  }
}

/**
 * @swagger
 * /api/v1/public/oauth/token:
 *   post:
 *     tags: [Public API]
 *     summary: OAuth 2.0 token endpoint (client_credentials)
 *     description: |
 *       Exchange an API key for a short-lived (1 hour) bearer token.
 *       Pass `grant_type=client_credentials` and either:
 *         * `client_id=ckp_xxxx` and `client_secret=yyyy` (split form), or
 *         * `client_id=ckp_xxxx.yyyy` (full key as client_id), or
 *         * HTTP Basic auth header `Authorization: Basic base64(client_id:client_secret)`.
 *       Optionally include `scope` (space-delimited subset of the key's granted scopes).
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             properties:
 *               grant_type: { type: string, enum: [client_credentials] }
 *               client_id: { type: string }
 *               client_secret: { type: string }
 *               scope: { type: string }
 *     responses:
 *       200:
 *         description: Bearer access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token: { type: string }
 *                 token_type: { type: string, example: Bearer }
 *                 expires_in: { type: integer, example: 3600 }
 *                 scope: { type: string }
 *       400: { description: invalid_request / invalid_scope / unsupported_grant_type }
 *       401: { description: invalid_client }
 */
router.post("/token", async (req, res) => {
  // Per RFC 6749 §2.3.1, credentials must come from the request body or HTTP Basic.
  // Query params are explicitly NOT accepted to avoid credential leakage via logs/proxies.
  const grantType = req.body?.grant_type as string | undefined;
  if (grantType !== "client_credentials") {
    return res.status(400).json({ error: "unsupported_grant_type", error_description: "Only 'client_credentials' is supported." });
  }

  let clientId = req.body?.client_id as string | undefined;
  let clientSecret = req.body?.client_secret as string | undefined;
  const requestedScope = (req.body?.scope as string | undefined) || "";

  // Also support HTTP Basic auth per RFC 6749
  const authHeader = req.headers.authorization;
  if (!clientId && authHeader?.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
      const idx = decoded.indexOf(":");
      if (idx > 0) {
        clientId = decoded.slice(0, idx);
        clientSecret = decoded.slice(idx + 1);
      }
    } catch {}
  }

  if (!clientId) {
    return res.status(400).json({ error: "invalid_request", error_description: "Missing client_id." });
  }
  // We accept either a full key (`ckp_xxxx.yyyy`) as client_id (no secret needed),
  // or a split form: client_id = "ckp_xxxx" (prefix), client_secret = "yyyy".
  let fullKey: string;
  if (clientId.includes(".")) {
    fullKey = clientId;
  } else {
    if (!clientSecret) {
      return res.status(400).json({ error: "invalid_request", error_description: "Missing client_secret." });
    }
    fullKey = `${clientId}.${clientSecret}`;
  }

  const apiKey = await keyService.authenticateApiKey(fullKey);
  if (!apiKey) {
    return res.status(401).json({ error: "invalid_client", error_description: "Invalid client credentials." });
  }

  const grantedScopes = (apiKey.scopes as string[]) || [];
  let scopes = grantedScopes;
  if (requestedScope.trim()) {
    const requested = requestedScope.trim().split(/\s+/);
    const invalid = requested.filter(s => !grantedScopes.includes(s));
    if (invalid.length > 0) {
      return res.status(400).json({ error: "invalid_scope", error_description: `Scope(s) not granted: ${invalid.join(", ")}` });
    }
    scopes = requested;
  }

  const accessToken = signPublicApiToken({
    sub: apiKey.id,
    org: apiKey.organizationId,
    scopes,
    type: "public_api",
  });

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: TOKEN_TTL_SECONDS,
    scope: scopes.join(" "),
  });
});

export default router;
