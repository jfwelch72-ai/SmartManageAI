import { Router, Request, Response } from "express";
import { db } from "./db";
import { clientPortalAccess, projects, organizations, subcontractorPortalTokens, vendorUsers, crmOrganisations } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcrypt";
import { logError } from "./utils/logger";

const router = Router();

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

router.post("/portal/auth/resolve", async (req: Request, res: Response) => {
  try {
    const { type, email, projectId, token } = req.body;

    if (type === "vendor") {
      const user = (req as any).user;
      if (!user || user.role !== "VENDOR") {
        return res.status(401).json({ error: "Vendor authentication required" });
      }

      const [vendorUser] = await db
        .select()
        .from(vendorUsers)
        .where(and(eq(vendorUsers.userId, user.id), eq(vendorUsers.isActive, true)))
        .limit(1);

      return res.json({
        role: "vendor",
        data: {
          userId: user.id,
          fullName: user.fullName,
          email: user.email,
          organizationName: user.organizationName || "",
          vendorOrgId: vendorUser?.crmOrganisationId || null,
        },
      });
    }

    if (type === "subcontractor") {
      if (!token) {
        return res.status(400).json({ error: "Token is required for subcontractor access" });
      }

      const activeTokens = await db
        .select()
        .from(subcontractorPortalTokens)
        .where(
          and(
            eq(subcontractorPortalTokens.status, "active"),
            gt(subcontractorPortalTokens.expiresAt, new Date())
          )
        );

      let matchedToken = null;
      for (const t of activeTokens) {
        const isMatch = await bcrypt.compare(token, t.tokenHash);
        if (isMatch) {
          matchedToken = t;
          break;
        }
      }

      if (!matchedToken) {
        return res.status(401).json({ error: "Invalid or expired portal access token" });
      }

      await db
        .update(subcontractorPortalTokens)
        .set({ lastAccessedAt: new Date() })
        .where(eq(subcontractorPortalTokens.id, matchedToken.id));

      const [project] = await db
        .select({ id: projects.id, name: projects.name, code: projects.code })
        .from(projects)
        .where(eq(projects.id, matchedToken.projectId))
        .limit(1);

      const [subCompany] = await db
        .select({ id: crmOrganisations.id, name: crmOrganisations.name })
        .from(crmOrganisations)
        .where(eq(crmOrganisations.id, matchedToken.crmOrganisationId))
        .limit(1);

      return res.json({
        role: "subcontractor",
        data: {
          project: project || null,
          subcontractor: subCompany || null,
          permissions: matchedToken.permissions || ["view"],
          contactName: matchedToken.contactName,
          contactEmail: matchedToken.contactEmail,
          tokenId: matchedToken.id,
          organizationId: matchedToken.organizationId,
          projectId: matchedToken.projectId,
        },
      });
    }

    if (type === "client") {
      if (!projectId || !email) {
        return res.status(400).json({ error: "Project ID and email are required for client access" });
      }

      const [access] = await db
        .select({
          access: clientPortalAccess,
          projectName: projects.name,
          projectStatus: projects.status,
          orgName: organizations.name,
        })
        .from(clientPortalAccess)
        .leftJoin(projects, eq(clientPortalAccess.projectId, projects.id))
        .leftJoin(organizations, eq(clientPortalAccess.organizationId, organizations.id))
        .where(
          and(
            eq(clientPortalAccess.projectId, projectId),
            eq(clientPortalAccess.email, email.trim().toLowerCase()),
            eq(clientPortalAccess.isActive, true)
          )
        )
        .limit(1);

      if (!access) {
        return res.status(403).json({ error: "No portal access found for this email" });
      }

      let permissions = {
        viewProgress: true,
        viewPhotos: true,
        viewSchedule: true,
        viewDocuments: false,
        viewChangeOrders: false,
        viewInvoices: false,
        submitRequests: false,
      };
      if (access.access.permissionsJson) {
        permissions = {
          ...permissions,
          ...(safeJsonParse<Record<string, boolean>>(access.access.permissionsJson, {}) || {}),
        };
      }

      await db
        .update(clientPortalAccess)
        .set({ lastAccessedAt: new Date() })
        .where(eq(clientPortalAccess.id, access.access.id));

      return res.json({
        role: "client",
        data: {
          verified: true,
          accessId: access.access.id,
          projectName: access.projectName || "Unknown Project",
          projectStatus: access.projectStatus || "ACTIVE",
          organizationName: access.orgName || "",
          accessType: access.access.accessType || "STAKEHOLDER",
          name: access.access.name || "",
          permissions,
          projectId,
          email: email.trim().toLowerCase(),
        },
      });
    }

    return res.status(400).json({ error: "Invalid portal type. Must be 'client', 'subcontractor', or 'vendor'." });
  } catch (error) {
    logError("Portal auth resolve error:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Portal authentication failed" });
  }
});

export default router;
