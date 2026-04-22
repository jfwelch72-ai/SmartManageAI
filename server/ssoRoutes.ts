import {logError, logWarn } from "./utils/logger";
import { Router, Response, NextFunction } from "express";
import { AuthRequest, requireAuth, requireRole, generateToken, setAuthCookie } from "./auth";
import { requireFeature } from "./middleware/requireFeature";
import { db } from "./db";
import { ssoConfigurations, organizations, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { logAudit } from "./auditLogger";
import { SAML } from "@node-saml/node-saml";

const router = Router();

router.get(
  "/config",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  requireFeature("SSO"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "No organization associated with user" });
      }

      const [config] = await db
        .select()
        .from(ssoConfigurations)
        .where(eq(ssoConfigurations.organizationId, orgId))
        .limit(1);

      const [org] = await db
        .select({ slug: organizations.slug })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);

      return res.json({ config: config || null, orgSlug: org?.slug || null });
    } catch (error: any) {
            return next(error);
    }
  }
);

router.put(
  "/config",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  requireFeature("SSO"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) {
        return res.status(400).json({ error: "No organization associated with user" });
      }

      const { provider, entityId, ssoLoginUrl, certificate, metadataUrl, enforceSSO, enabled } = req.body;

      if (!provider || !entityId || !ssoLoginUrl || !certificate) {
        return res.status(400).json({ error: "Missing required fields: provider, entityId, ssoLoginUrl, certificate" });
      }

      const [existing] = await db
        .select()
        .from(ssoConfigurations)
        .where(eq(ssoConfigurations.organizationId, orgId))
        .limit(1);

      let config;
      if (existing) {
        [config] = await db
          .update(ssoConfigurations)
          .set({
            provider,
            entityId,
            ssoLoginUrl,
            certificate,
            metadataUrl: metadataUrl || null,
            enforceSSO: enforceSSO ?? false,
            enabled: enabled ?? false,
            updatedAt: new Date(),
          })
          .where(eq(ssoConfigurations.organizationId, orgId))
          .returning();

        await logAudit(
          {
            userId: req.user!.id,
            entityType: "sso_configuration",
            entityId: config.id,
            action: "UPDATE",
            oldValue: JSON.stringify(existing),
            newValue: JSON.stringify(config),
          },
          req
        );
      } else {
        [config] = await db
          .insert(ssoConfigurations)
          .values({
            organizationId: orgId,
            provider,
            entityId,
            ssoLoginUrl,
            certificate,
            metadataUrl: metadataUrl || null,
            enforceSSO: enforceSSO ?? false,
            enabled: enabled ?? false,
          })
          .returning();

        await logAudit(
          {
            userId: req.user!.id,
            entityType: "sso_configuration",
            entityId: config.id,
            action: "CREATE",
            newValue: JSON.stringify(config),
          },
          req
        );
      }

      return res.json({ config });
    } catch (error: any) {
            return next(error);
    }
  }
);

router.post(
  "/test",
  requireAuth,
  requireRole("ADMIN", "SUPER_ADMIN"),
  requireFeature("SSO"),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { certificate, ssoLoginUrl } = req.body;
      const errors: string[] = [];

      if (certificate) {
        try {
          const cleaned = certificate
            .replace(/-----BEGIN CERTIFICATE-----/g, "")
            .replace(/-----END CERTIFICATE-----/g, "")
            .replace(/\s/g, "");
          const decoded = Buffer.from(cleaned, "base64");
          if (decoded.length === 0) {
            errors.push("Certificate is not valid base64");
          }
        } catch {
          logWarn("Non-critical operation failed");
          errors.push("Certificate is not valid base64");
        }
      } else {
        errors.push("Certificate is required");
      }

      if (ssoLoginUrl) {
        try {
          new URL(ssoLoginUrl);
        } catch {
          logWarn("Non-critical operation failed");
          errors.push("SSO Login URL is not a valid URL");
        }
      } else {
        errors.push("SSO Login URL is required");
      }

      if (errors.length > 0) {
        return res.status(400).json({ valid: false, errors });
      }

      return res.json({ valid: true, message: "SSO configuration appears valid" });
    } catch (error: any) {
            return next(error);
    }
  }
);

router.get("/:orgSlug/login", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgSlug } = req.params;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [ssoConfig] = await db
      .select()
      .from(ssoConfigurations)
      .where(eq(ssoConfigurations.organizationId, org.id))
      .limit(1);

    if (!ssoConfig || !ssoConfig.enabled) {
      return res.status(404).json({ error: "SSO is not configured or not enabled for this organization" });
    }

    const forwardedProto = (req.headers["x-forwarded-proto"] as string || "").split(",")[0].trim().toLowerCase();
    const protocol = (forwardedProto === "https" || forwardedProto === "http") ? forwardedProto : req.protocol;
    const host = req.get("host");
    const callbackUrl = `${protocol}://${host}/api/sso/${orgSlug}/callback`;

    const saml = new SAML({
      callbackUrl,
      entryPoint: ssoConfig.ssoLoginUrl,
      issuer: ssoConfig.entityId,
      cert: ssoConfig.certificate,
      nameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    });

    // Carry the optional `redirect` query param through to the callback via
    // SAML RelayState. Whitelist relative paths so the redirect cannot be
    // weaponised as an open-redirect into a third-party host.
    const requestedRedirect = String(req.query.redirect || "").trim();
    const relayState =
      requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")
        ? requestedRedirect
        : "";

    const loginUrl = await saml.getAuthorizeUrlAsync(relayState, req.headers.host || "", {});
    return res.redirect(loginUrl);
  } catch (error: any) {
        return next(error);
  }
});

router.post("/:orgSlug/callback", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgSlug } = req.params;

    const [org] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    if (!org) {
      return res.status(404).json({ error: "Organization not found" });
    }

    const [ssoConfig] = await db
      .select()
      .from(ssoConfigurations)
      .where(eq(ssoConfigurations.organizationId, org.id))
      .limit(1);

    if (!ssoConfig || !ssoConfig.enabled) {
      return res.status(404).json({ error: "SSO is not configured or not enabled for this organization" });
    }

    const forwardedProto = (req.headers["x-forwarded-proto"] as string || "").split(",")[0].trim().toLowerCase();
    const protocol = (forwardedProto === "https" || forwardedProto === "http") ? forwardedProto : req.protocol;
    const host = req.get("host");
    const callbackUrl = `${protocol}://${host}/api/sso/${orgSlug}/callback`;

    const saml = new SAML({
      callbackUrl,
      entryPoint: ssoConfig.ssoLoginUrl,
      issuer: ssoConfig.entityId,
      cert: ssoConfig.certificate,
      nameIDFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    });

    const { profile } = await saml.validatePostResponseAsync(req.body);

    if (!profile || !profile.nameID) {
      return res.status(400).json({ error: "Invalid SAML response: no nameID found" });
    }

    const email = profile.nameID.toLowerCase();

    let [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser && existingUser.organizationId !== org.id) {
      return res.status(403).json({ error: "User belongs to a different organization" });
    }

    if (!existingUser) {
      const firstName = (profile as any).firstName || (profile as any).givenName || email.split("@")[0];
      const lastName = (profile as any).lastName || (profile as any).surname || "";

      [existingUser] = await db
        .insert(users)
        .values({
          email,
          firstName,
          lastName,
          passwordHash: "",
          role: "FIELD_WORKER",
          organizationId: org.id,
          isActive: true,
        })
        .returning();

      await logAudit(
        {
          userId: existingUser.id,
          entityType: "user",
          entityId: existingUser.id,
          action: "CREATE",
          newValue: JSON.stringify({ email, ssoProvider: ssoConfig.provider, organizationId: org.id }),
        },
        req
      );
    }

    if (!existingUser.isActive) {
      return res.status(403).json({ error: "User account is deactivated" });
    }

    if (existingUser.role !== "SUPER_ADMIN" && existingUser.organizationId) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, existingUser.organizationId)).limit(1);
      if (org && !org.isActive) {
        return res.status(403).json({ error: "Your organization has been suspended. Please contact support.", suspended: true });
      }
    }

    const token = generateToken(existingUser.id, existingUser.tokenVersion ?? 0);
    setAuthCookie(res, token);

    // Honour the redirect carried via SAML RelayState (set by the
    // /:orgSlug/login handler). Validation: only allow same-origin paths
    // to prevent open-redirect abuse.
    const relay = typeof req.body?.RelayState === "string" ? req.body.RelayState : "";
    const safeRelay = relay && relay.startsWith("/") && !relay.startsWith("//") ? relay : null;
    return res.redirect(safeRelay ?? "/dashboard");
  } catch (error: any) {
        return next(error);
  }
});

export default router;
