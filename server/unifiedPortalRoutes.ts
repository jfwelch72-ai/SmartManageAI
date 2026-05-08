import { Router, Request, Response, NextFunction } from "express";
import { db } from "./db";
import { clientPortalAccess, projects, organizations, subcontractorPortalTokens, vendorUsers, crmOrganisations, organizationDocuments } from "@shared/schema";
import { eq, and, gt } from "drizzle-orm";
import { logError } from "./utils/logger";
// Task #1614 — share the indexed token resolver with `requirePortalAuth`
// so both portal-auth entry points get the O(1) lookup instead of the
// O(N) bcrypt-scan over every active row.
import { resolvePortalTokenRow } from "./portalAuth";
import { objectStorageClient } from "./objectStorage";
import { ObjectStorageService } from "./objectStorage";

const router = Router();
const portalObjectStorage = new ObjectStorageService();

router.get("/portal/branding", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query;
    if (!projectId || typeof projectId !== "string") {
      return res.json({
        organizationName: null,
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
      });
    }

    const [project] = await db
      .select({ organizationId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    if (!project?.organizationId) {
      return res.json({
        organizationName: null,
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
      });
    }

    const [org] = await db
      .select({
        name: organizations.name,
        logoUrl: organizations.logoUrl,
        primaryColor: organizations.primaryColor,
        accentColor: organizations.accentColor,
      })
      .from(organizations)
      .where(eq(organizations.id, project.organizationId))
      .limit(1);

    if (!org) {
      return res.json({
        organizationName: null,
        logoUrl: null,
        primaryColor: null,
        accentColor: null,
      });
    }

    const [primaryLogoDoc] = await db
      .select({ fileUrl: organizationDocuments.fileUrl })
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, project.organizationId),
          eq(organizationDocuments.type, "LOGO_PRIMARY" as any),
          eq(organizationDocuments.isActive, true)
        )
      )
      .limit(1);

    const hasLogo = !!(primaryLogoDoc?.fileUrl || org.logoUrl);
    const logoProxyUrl = hasLogo ? `/api/portal/org-logo/${project.organizationId}` : null;

    return res.json({
      organizationName: org.name || null,
      logoUrl: logoProxyUrl,
      primaryColor: org.primaryColor || null,
      accentColor: org.accentColor || null,
    });
  } catch (error) {
    logError("Portal branding fetch error:", {}, error instanceof Error ? error : new Error(String(error)));
    return res.json({
      organizationName: null,
      logoUrl: null,
      primaryColor: null,
      accentColor: null,
    });
  }
});

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

router.post("/portal/auth/resolve", async (req: Request, res: Response, next: NextFunction) => {
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

      // Task #1614 — was a linear bcrypt-compare loop over every active
      // unexpired row; now an indexed lookup via the shared resolver.
      const matchedToken = await resolvePortalTokenRow(token);

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

      let branding: { organizationName: string | null; logoUrl: string | null; primaryColor: string | null; accentColor: string | null } = {
        organizationName: null, logoUrl: null, primaryColor: null, accentColor: null,
      };
      if (matchedToken.organizationId) {
        const [org] = await db
          .select({ name: organizations.name, logoUrl: organizations.logoUrl, primaryColor: organizations.primaryColor, accentColor: organizations.accentColor })
          .from(organizations)
          .where(eq(organizations.id, matchedToken.organizationId))
          .limit(1);
        if (org) {
          const activeDocs = await db
            .select({ type: organizationDocuments.type, fileUrl: organizationDocuments.fileUrl })
            .from(organizationDocuments)
            .where(and(eq(organizationDocuments.organizationId, matchedToken.organizationId), eq(organizationDocuments.isActive, true)));
          const primaryLogo = activeDocs.find(d => d.type === "LOGO_PRIMARY");
          const hasLogo = !!(primaryLogo?.fileUrl || org.logoUrl);
          branding = {
            organizationName: org.name || null,
            logoUrl: hasLogo ? `/api/portal/org-logo/${matchedToken.organizationId}` : null,
            primaryColor: org.primaryColor || null,
            accentColor: org.accentColor || null,
          };
        }
      }

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
          branding,
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
          orgLogoUrl: organizations.logoUrl,
          orgPrimaryColor: organizations.primaryColor,
          orgAccentColor: organizations.accentColor,
          orgId: organizations.id,
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

      let clientBranding: { organizationName: string | null; logoUrl: string | null; primaryColor: string | null; accentColor: string | null } = {
        organizationName: access.orgName || null,
        logoUrl: null,
        primaryColor: access.orgPrimaryColor || null,
        accentColor: access.orgAccentColor || null,
      };
      if (access.orgId) {
        const activeDocs = await db
          .select({ type: organizationDocuments.type, fileUrl: organizationDocuments.fileUrl })
          .from(organizationDocuments)
          .where(and(eq(organizationDocuments.organizationId, access.orgId), eq(organizationDocuments.isActive, true)));
        const primaryLogo = activeDocs.find(d => d.type === "LOGO_PRIMARY");
        const hasClientLogo = !!(primaryLogo?.fileUrl || access.orgLogoUrl);
        if (hasClientLogo) {
          clientBranding.logoUrl = `/api/portal/org-logo/${access.orgId}`;
        }
      }

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
          branding: clientBranding,
        },
      });
    }

    return res.status(400).json({ error: "Invalid portal type. Must be 'client', 'subcontractor', or 'vendor'." });
  } catch (error) {
    next(error);
  }
});

router.get("/portal/org-logo/:orgId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { orgId } = req.params;

    const [logoDoc] = await db
      .select({ fileUrl: organizationDocuments.fileUrl })
      .from(organizationDocuments)
      .where(
        and(
          eq(organizationDocuments.organizationId, orgId),
          eq(organizationDocuments.type, "LOGO_PRIMARY" as any),
          eq(organizationDocuments.isActive, true)
        )
      )
      .limit(1);

    let fileUrl: string | null = logoDoc?.fileUrl ?? null;

    if (!fileUrl) {
      const [org] = await db
        .select({ logoUrl: organizations.logoUrl })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .limit(1);
      fileUrl = org?.logoUrl || null;
    }

    if (!fileUrl) return res.status(404).json({ error: "Logo not found" });

    let objectFile;

    if (fileUrl.startsWith("/objects/")) {
      objectFile = await portalObjectStorage.getObjectEntityFile(fileUrl);
    } else {
      const gcsPrefix = "https://storage.googleapis.com/";
      let bucketName: string;
      let objectName: string;

      if (fileUrl.startsWith(gcsPrefix)) {
        const pathAfterPrefix = fileUrl.slice(gcsPrefix.length);
        const slashIdx = pathAfterPrefix.indexOf("/");
        bucketName = pathAfterPrefix.slice(0, slashIdx);
        objectName = pathAfterPrefix.slice(slashIdx + 1);
      } else {
        const parts = fileUrl.startsWith("/") ? fileUrl.slice(1).split("/") : fileUrl.split("/");
        bucketName = parts[0];
        objectName = parts.slice(1).join("/");
      }

      const bucket = objectStorageClient.bucket(bucketName);
      objectFile = bucket.file(objectName);
    }

    await portalObjectStorage.downloadObject(objectFile, res, 86400);
  } catch (error) {
    logError("Portal org logo proxy error:", {}, error instanceof Error ? error : new Error(String(error)));
    if (!res.headersSent) next(error);
  }
});

export default router;
