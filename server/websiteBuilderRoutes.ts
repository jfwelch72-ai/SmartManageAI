import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { 
  organizationWebsites, 
  organizationWebsitePages, 
  organizationSocialLinks,
  organizations,
  OrganizationWebsite,
  websiteDeployments
} from "@shared/schema";
import { requireAuth, AuthRequest, requireFeaturePermission } from "./auth";
import { logCreate, logUpdate } from "./auditLogger";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage";

import websitePageRoutes from "./websitePageRoutes";
import websiteBlogRoutes from "./websiteBlogRoutes";
import websiteContentRoutes from "./websiteContentRoutes";
import websiteAiSeoRoutes from "./websiteAiSeoRoutes";

const router = express.Router();
router.use(requireAuth, requireFeaturePermission('canManageWebsite'));

const objectStorage = new ObjectStorageService();

function validateOrgAccess(req: AuthRequest, res: Response): string | null {
  const user = req.user!;
  if (user.role === "SUPER_ADMIN") {
    return null;
  }
  if (!user.organizationId) {
    res.status(403).json({ error: "No organization access" });
    return null;
  }
  return user.organizationId;
}

function orgLogoProxyUrl(orgId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://storage.googleapis.com/")) {
    return `/api/website/org-logo/${orgId}`;
  }
  return url;
}

// Mount sub-routers
router.use(websitePageRoutes);
router.use(websiteBlogRoutes);
router.use(websiteContentRoutes);
router.use(websiteAiSeoRoutes);

// GET /api/website/org-logo/:orgId - Serve organization logo directly from GCS
router.get("/org-logo/:orgId", async (req: Request, res: Response) => {
  try {
    const { orgId } = req.params;
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { logoUrl: true },
    });

    if (!org?.logoUrl) {
      return res.status(404).json({ error: "Logo not found" });
    }

    const objectStorageService = new ObjectStorageService();
    const normalizedPath = objectStorageService.normalizeObjectEntityPath(org.logoUrl);

    if (!normalizedPath.startsWith("/objects/")) {
      try {
        const parsedLogoUrl = new URL(org.logoUrl);
        if (parsedLogoUrl.protocol !== "https:" ||
          (!parsedLogoUrl.hostname.endsWith("storage.googleapis.com") && !parsedLogoUrl.hostname.endsWith("googleusercontent.com"))) {
          return res.status(404).json({ error: "Logo not found" });
        }
      } catch {
        return res.status(404).json({ error: "Logo not found" });
      }
      return res.redirect(org.logoUrl);
    }

    const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);
    objectStorageService.downloadObject(objectFile, res);
  } catch (error: any) {
    console.error("Error serving org logo:", error);
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "Logo file not found" });
    }
    res.status(500).json({ error: "Failed to serve logo" });
  }
});

// ============================================
// WEBSITE SETUP & CONFIGURATION
// ============================================

// GET /api/website - Get organization's website
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.json({ hasWebsite: false, website: null });
    }

    res.json({ hasWebsite: true, website });
  } catch (error) {
    console.error("Error fetching website:", error);
    res.status(500).json({ error: "Failed to fetch website" });
  }
});

// POST /api/website - Create or update website configuration
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.role === "SUPER_ADMIN" ? req.body.organizationId : user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization ID required" });
    }

    const existing = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId),
    });

    const websiteData = {
      ...req.body,
      organizationId: orgId,
      updatedAt: new Date(),
    };

    let website: OrganizationWebsite;

    if (existing) {
      const [updated] = await db.update(organizationWebsites)
        .set(websiteData)
        .where(eq(organizationWebsites.id, existing.id))
        .returning();
      website = updated;

      await logUpdate(user.id, "organization_websites", website.id, existing, websiteData, req);
    } else {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId),
      });

      const [created] = await db.insert(organizationWebsites)
        .values({
          ...websiteData,
          subdomain: org?.slug || `org-${Date.now()}`,
        })
        .returning();
      website = created;

      await logCreate(user.id, "organization_websites", website.id, websiteData, req);
    }

    res.json(website);
  } catch (error) {
    console.error("Error saving website:", error);
    res.status(500).json({ error: "Failed to save website" });
  }
});

// POST /api/website/publish - Publish the website
router.post("/publish", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const [updated] = await db.update(organizationWebsites)
      .set({
        status: "PUBLISHED",
        lastPublishedAt: new Date(),
        lastPublishedByUserId: user.id,
        updatedAt: new Date(),
      })
      .where(eq(organizationWebsites.id, website.id))
      .returning();

    await logUpdate(user.id, "organization_websites", website.id, website, { status: "PUBLISHED" }, req);

    await db.insert(websiteDeployments).values({
      websiteId: website.id,
      organizationId: website.organizationId,
      action: "PUBLISHED",
      performedByUserId: user.id,
      performedByName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      note: "Website published",
    });

    res.json({ 
      success: true, 
      website: updated,
      siteUrl: `https://${website.subdomain}.smartmanageai-sites.com`,
    });
  } catch (error) {
    console.error("Error publishing website:", error);
    res.status(500).json({ error: "Failed to publish website" });
  }
});

// ============================================
// WEBSITE PREVIEW & PUBLIC SERVING
// ============================================

// GET /api/website/public/:subdomain - Get public website data by subdomain (no auth required)
router.get("/public/:subdomain", async (req: Request, res: Response) => {
  try {
    const { subdomain } = req.params;

    if (!subdomain) {
      return res.status(400).json({ error: "Subdomain is required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: and(
        eq(organizationWebsites.subdomain, subdomain),
        eq(organizationWebsites.status, "PUBLISHED")
      ),
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found or not published" });
    }

    const orgId = website.organizationId;

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    const allPages = await db.query.organizationWebsitePages.findMany({
      where: and(
        eq(organizationWebsitePages.organizationId, orgId),
        eq(organizationWebsitePages.isPublished, true)
      ),
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    const blogPostsResult = await db.execute(sql`
      SELECT id, website_id, organization_id, slug, title, excerpt,
             author_id, author_name, status, category, tags, 
             meta_title, meta_description, keywords, published_at, 
             view_count, cover_image_url, content_json, content_html, 
             created_at, updated_at
      FROM website_blog_posts 
      WHERE organization_id = ${orgId} AND status = 'PUBLISHED'
      ORDER BY published_at DESC NULLS LAST
      LIMIT 6
    `);
    const blogPosts = blogPostsResult.rows;

    const projectsResult = await db.execute(sql`
      SELECT id, website_id, organization_id, slug, title, short_description,
             full_description, project_type, service_type, location,
             completion_date, cover_image_url, before_image_url, after_image_url,
             featured, status, view_count, meta_title, meta_description,
             created_at, updated_at
      FROM website_projects 
      WHERE organization_id = ${orgId} AND status = 'PUBLISHED'
      ORDER BY completion_date DESC NULLS LAST
      LIMIT 6
    `);
    const projects = projectsResult.rows;

    const socialLinks = await db.query.organizationSocialLinks.findFirst({
      where: eq(organizationSocialLinks.organizationId, orgId),
    });

    res.json({
      website: {
        ...website,
        logoUrl: orgLogoProxyUrl(orgId, website.logoUrl),
      },
      organization: org ? {
        name: org.name,
        tradeType: org.tradeType,
        region: org.region,
        logoUrl: orgLogoProxyUrl(orgId, org.logoUrl),
      } : null,
      pages: allPages,
      blogPosts,
      projects,
      socialLinks,
      headerConfig: website.headerComponentsConfig || null,
      footerConfig: website.footerComponentsConfig || null,
      bodyConfig: website.bodyComponentsConfig || null,
      headerLayoutSettings: {
        headerType: website.headerType || 'static',
        headerHeight: website.headerHeight || 80,
        sectionSettings: website.headerSectionSettings || null,
      },
      footerLayoutSettings: {
        footerColumns: website.footerColumns || 3,
        sectionSettings: website.footerSectionSettings || null,
      },
    });
  } catch (error) {
    console.error("Error fetching public website:", error);
    res.status(500).json({ error: "Failed to fetch website" });
  }
});

// GET /api/website/staging-token - Get current staging token
router.get("/staging-token", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const orgId = user.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId),
    });
    if (!website) return res.status(404).json({ error: "Website not found" });

    res.json({ token: website.stagingToken || null, subdomain: website.subdomain });
  } catch (error) {
    console.error("Error fetching staging token:", error);
    res.status(500).json({ error: "Failed to fetch staging token" });
  }
});

// POST /api/website/staging-token - Generate or regenerate staging token
router.post("/staging-token", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const orgId = user.organizationId;
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId),
    });
    if (!website) return res.status(404).json({ error: "Website not found" });

    const token = randomUUID();
    await db.update(organizationWebsites)
      .set({ stagingToken: token })
      .where(eq(organizationWebsites.id, website.id));

    res.json({ token, subdomain: website.subdomain });
  } catch (error) {
    console.error("Error generating staging token:", error);
    res.status(500).json({ error: "Failed to generate staging token" });
  }
});

// GET /api/website/staging/:subdomain - Get website data for staging preview (no auth, token-protected)
router.get("/staging/:subdomain", async (req: Request, res: Response) => {
  try {
    const { subdomain } = req.params;
    const token = req.query.token as string;

    if (!subdomain) {
      return res.status(400).json({ error: "Subdomain is required" });
    }
    if (!token) {
      return res.status(403).json({ error: "Staging token is required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.subdomain, subdomain),
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    if (!website.stagingToken || website.stagingToken !== token) {
      return res.status(403).json({ error: "Invalid staging token" });
    }

    const orgId = website.organizationId;

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    const allPages = await db.query.organizationWebsitePages.findMany({
      where: eq(organizationWebsitePages.organizationId, orgId),
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    const blogPostsResult = await db.execute(sql`
      SELECT id, website_id, organization_id, slug, title, excerpt,
             author_id, author_name, status, category, tags, 
             meta_title, meta_description, keywords, published_at, 
             view_count, cover_image_url, content_json, content_html, 
             created_at, updated_at
      FROM website_blog_posts 
      WHERE organization_id = ${orgId}
      ORDER BY published_at DESC NULLS LAST
      LIMIT 6
    `);
    const blogPosts = blogPostsResult.rows;

    const projectsResult = await db.execute(sql`
      SELECT id, website_id, organization_id, slug, title, short_description,
             full_description, project_type, service_type, location,
             completion_date, cover_image_url, before_image_url, after_image_url,
             featured, status, view_count, meta_title, meta_description,
             created_at, updated_at
      FROM website_projects 
      WHERE organization_id = ${orgId}
      ORDER BY completion_date DESC NULLS LAST
      LIMIT 6
    `);
    const projects = projectsResult.rows;

    const socialLinks = await db.query.organizationSocialLinks.findFirst({
      where: eq(organizationSocialLinks.organizationId, orgId),
    });

    res.json({
      website: {
        ...website,
        logoUrl: orgLogoProxyUrl(orgId, website.logoUrl),
      },
      organization: org ? {
        name: org.name,
        tradeType: org.tradeType,
        region: org.region,
        logoUrl: orgLogoProxyUrl(orgId, org.logoUrl),
      } : null,
      pages: allPages,
      blogPosts,
      projects,
      socialLinks,
      headerConfig: website.headerComponentsConfig || null,
      footerConfig: website.footerComponentsConfig || null,
      bodyConfig: website.bodyComponentsConfig || null,
      headerLayoutSettings: {
        headerType: website.headerType || 'static',
        headerHeight: website.headerHeight || 80,
        sectionSettings: website.headerSectionSettings || null,
      },
      footerLayoutSettings: {
        footerColumns: website.footerColumns || 3,
        sectionSettings: website.footerSectionSettings || null,
      },
      isStaging: true,
    });
  } catch (error) {
    console.error("Error fetching staging website:", error);
    res.status(500).json({ error: "Failed to fetch staging website" });
  }
});

// GET /api/website/preview - Get all data needed for website preview
router.get("/preview", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required for preview" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId),
    });

    if (!website) {
      return res.status(404).json({ error: "Website not configured" });
    }

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    const pages = await db.query.organizationWebsitePages.findMany({
      where: eq(organizationWebsitePages.organizationId, orgId),
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    const blogPostsResult = await db.execute(sql`
      SELECT id, website_id, organization_id, slug, title, excerpt,
             author_id, author_name, status, category, tags, 
             meta_title, meta_description, keywords, published_at, 
             view_count, cover_image_url, content_json, content_html, 
             featured_post,
             created_at, updated_at
      FROM website_blog_posts 
      WHERE organization_id = ${orgId} AND status = 'PUBLISHED'
      ORDER BY published_at DESC NULLS LAST
      LIMIT 50
    `);
    const blogPosts = blogPostsResult.rows;

    const projectsResult = await db.execute(sql`
      SELECT id, website_id, organization_id, slug, title, short_description,
             full_description, project_type, service_type, location,
             completion_date, cover_image_url, before_image_url, after_image_url,
             featured, status, view_count, meta_title, meta_description,
             created_at, updated_at
      FROM website_projects 
      WHERE organization_id = ${orgId} AND status = 'PUBLISHED'
      ORDER BY completion_date DESC NULLS LAST
      LIMIT 6
    `);
    const projects = projectsResult.rows;

    const socialLinks = await db.query.organizationSocialLinks.findFirst({
      where: eq(organizationSocialLinks.organizationId, orgId),
    });

    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json({
      website: {
        ...website,
        logoUrl: orgLogoProxyUrl(orgId, website.logoUrl),
      },
      organization: org ? {
        name: org.name,
        tradeType: org.tradeType,
        region: org.region,
        logoUrl: orgLogoProxyUrl(orgId, org.logoUrl),
      } : null,
      pages: pages.filter(p => p.showInNavigation && p.isPublished !== false),
      blogPosts,
      projects,
      socialLinks,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching preview data:", error);
    res.status(500).json({ error: "Failed to fetch preview data" });
  }
});

// ============================================
// Global / Reusable Components
// ============================================

router.get("/global-components", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (!orgId) return;

    const [website] = await db.select({ globalComponentsConfig: organizationWebsites.globalComponentsConfig })
      .from(organizationWebsites)
      .where(eq(organizationWebsites.organizationId, orgId))
      .limit(1);

    if (!website) return res.json({ components: [] });
    const components = (website.globalComponentsConfig as any)?.components || [];
    res.json({ components });
  } catch (error) {
    console.error("Error fetching global components:", error);
    res.status(500).json({ error: "Failed to fetch global components" });
  }
});

router.post("/global-components", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (!orgId) return;

    const { component, name } = req.body;
    if (!component || !name) return res.status(400).json({ error: "Component and name are required" });

    const [website] = await db.select({ id: organizationWebsites.id, globalComponentsConfig: organizationWebsites.globalComponentsConfig })
      .from(organizationWebsites)
      .where(eq(organizationWebsites.organizationId, orgId))
      .limit(1);

    if (!website) return res.status(404).json({ error: "Website not found" });

    const existing = (website.globalComponentsConfig as any)?.components || [];
    const newGlobalComp = {
      id: `global-${Date.now()}-${randomUUID().substring(0, 8)}`,
      name,
      component: { ...component, id: `body-${component.type}-${Date.now()}` },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    existing.push(newGlobalComp);

    await db.update(organizationWebsites)
      .set({ globalComponentsConfig: { components: existing } })
      .where(eq(organizationWebsites.id, website.id));

    res.json(newGlobalComp);
  } catch (error) {
    console.error("Error saving global component:", error);
    res.status(500).json({ error: "Failed to save global component" });
  }
});

router.patch("/global-components/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (!orgId) return;

    const { id } = req.params;
    const { name, component } = req.body;

    const [website] = await db.select({ id: organizationWebsites.id, globalComponentsConfig: organizationWebsites.globalComponentsConfig })
      .from(organizationWebsites)
      .where(eq(organizationWebsites.organizationId, orgId))
      .limit(1);

    if (!website) return res.status(404).json({ error: "Website not found" });

    const existing = (website.globalComponentsConfig as any)?.components || [];
    const idx = existing.findIndex((c: any) => c.id === id);
    if (idx === -1) return res.status(404).json({ error: "Global component not found" });

    if (name !== undefined) existing[idx].name = name;
    if (component !== undefined) existing[idx].component = component;
    existing[idx].updatedAt = new Date().toISOString();

    await db.update(organizationWebsites)
      .set({ globalComponentsConfig: { components: existing } })
      .where(eq(organizationWebsites.id, website.id));

    res.json(existing[idx]);
  } catch (error) {
    console.error("Error updating global component:", error);
    res.status(500).json({ error: "Failed to update global component" });
  }
});

router.post("/global-components/:id/duplicate", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (!orgId) return;

    const { id } = req.params;

    const [website] = await db.select({ id: organizationWebsites.id, globalComponentsConfig: organizationWebsites.globalComponentsConfig })
      .from(organizationWebsites)
      .where(eq(organizationWebsites.organizationId, orgId))
      .limit(1);

    if (!website) return res.status(404).json({ error: "Website not found" });

    const existing = (website.globalComponentsConfig as any)?.components || [];
    const source = existing.find((c: any) => c.id === id);
    if (!source) return res.status(404).json({ error: "Global component not found" });

    const duplicated = {
      id: `global-${Date.now()}-${randomUUID().substring(0, 8)}`,
      name: `${source.name} (Copy)`,
      component: JSON.parse(JSON.stringify(source.component)),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    duplicated.component.id = `body-${duplicated.component.type}-${Date.now()}`;
    existing.push(duplicated);

    await db.update(organizationWebsites)
      .set({ globalComponentsConfig: { components: existing } })
      .where(eq(organizationWebsites.id, website.id));

    res.json(duplicated);
  } catch (error) {
    console.error("Error duplicating global component:", error);
    res.status(500).json({ error: "Failed to duplicate global component" });
  }
});

router.delete("/global-components/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (!orgId) return;

    const { id } = req.params;

    const [website] = await db.select({ id: organizationWebsites.id, globalComponentsConfig: organizationWebsites.globalComponentsConfig })
      .from(organizationWebsites)
      .where(eq(organizationWebsites.organizationId, orgId))
      .limit(1);

    if (!website) return res.status(404).json({ error: "Website not found" });

    const existing = (website.globalComponentsConfig as any)?.components || [];
    const filtered = existing.filter((c: any) => c.id !== id);

    if (filtered.length === existing.length) return res.status(404).json({ error: "Global component not found" });

    await db.update(organizationWebsites)
      .set({ globalComponentsConfig: { components: filtered } })
      .where(eq(organizationWebsites.id, website.id));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting global component:", error);
    res.status(500).json({ error: "Failed to delete global component" });
  }
});

// ============================================
// PUBLISHING & DEPLOYMENT MANAGEMENT
// ============================================

// POST /api/website/unpublish - Unpublish the website (set status back to DRAFT)
router.post("/unpublish", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const [updated] = await db.update(organizationWebsites)
      .set({
        status: "DRAFT",
        updatedAt: new Date(),
      })
      .where(eq(organizationWebsites.id, website.id))
      .returning();

    await logUpdate(user.id, "organization_websites", website.id, website, { status: "DRAFT" }, req);

    await db.insert(websiteDeployments).values({
      websiteId: website.id,
      organizationId: website.organizationId,
      action: "UNPUBLISHED",
      performedByUserId: user.id,
      performedByName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      note: "Website unpublished and set to draft",
    });

    res.json({ success: true, website: updated });
  } catch (error) {
    console.error("Error unpublishing website:", error);
    res.status(500).json({ error: "Failed to unpublish website" });
  }
});

// POST /api/website/maintenance - Toggle maintenance mode on/off
router.post("/maintenance", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const isCurrentlyMaintenance = website.status === "MAINTENANCE";
    const newStatus = isCurrentlyMaintenance ? "PUBLISHED" : "MAINTENANCE";
    const action = isCurrentlyMaintenance ? "MAINTENANCE_OFF" : "MAINTENANCE_ON";

    const [updated] = await db.update(organizationWebsites)
      .set({
        status: newStatus,
        updatedAt: new Date(),
      })
      .where(eq(organizationWebsites.id, website.id))
      .returning();

    await logUpdate(user.id, "organization_websites", website.id, website, { status: newStatus }, req);

    await db.insert(websiteDeployments).values({
      websiteId: website.id,
      organizationId: website.organizationId,
      action: action,
      performedByUserId: user.id,
      performedByName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      note: isCurrentlyMaintenance ? "Maintenance mode disabled" : "Maintenance mode enabled",
    });

    res.json({ success: true, website: updated, maintenanceMode: !isCurrentlyMaintenance });
  } catch (error) {
    console.error("Error toggling maintenance mode:", error);
    res.status(500).json({ error: "Failed to toggle maintenance mode" });
  }
});

// POST /api/website/domain - Update custom domain settings
router.post("/domain", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const { customDomain } = req.body;
    if (!customDomain || typeof customDomain !== "string") {
      return res.status(400).json({ error: "Custom domain is required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const [updated] = await db.update(organizationWebsites)
      .set({
        customDomain: customDomain,
        customDomainVerified: false,
        updatedAt: new Date(),
      })
      .where(eq(organizationWebsites.id, website.id))
      .returning();

    await logUpdate(user.id, "organization_websites", website.id, website, { customDomain }, req);

    await db.insert(websiteDeployments).values({
      websiteId: website.id,
      organizationId: website.organizationId,
      action: "DOMAIN_UPDATED",
      performedByUserId: user.id,
      performedByName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      note: `Custom domain updated to ${customDomain}`,
    });

    res.json({ success: true, website: updated });
  } catch (error) {
    console.error("Error updating custom domain:", error);
    res.status(500).json({ error: "Failed to update custom domain" });
  }
});

// POST /api/website/domain/verify - Simulate DNS verification for custom domain
router.post("/domain/verify", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    if (!website.customDomain) {
      return res.status(400).json({ error: "No custom domain configured" });
    }

    const [updated] = await db.update(organizationWebsites)
      .set({
        customDomainVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(organizationWebsites.id, website.id))
      .returning();

    await logUpdate(user.id, "organization_websites", website.id, website, { customDomainVerified: true }, req);

    await db.insert(websiteDeployments).values({
      websiteId: website.id,
      organizationId: website.organizationId,
      action: "DOMAIN_VERIFIED",
      performedByUserId: user.id,
      performedByName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      note: `DNS verification completed for ${website.customDomain}`,
    });

    res.json({ success: true, website: updated, verified: true });
  } catch (error) {
    console.error("Error verifying domain:", error);
    res.status(500).json({ error: "Failed to verify domain" });
  }
});

// GET /api/website/deployments - Get deployment history
router.get("/deployments", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const deployments = await db.select()
      .from(websiteDeployments)
      .where(eq(websiteDeployments.websiteId, website.id))
      .orderBy(desc(websiteDeployments.createdAt))
      .limit(50);

    res.json(deployments);
  } catch (error) {
    console.error("Error fetching deployments:", error);
    res.status(500).json({ error: "Failed to fetch deployment history" });
  }
});

// POST /api/website/republish - Re-publish an already-published website
router.post("/republish", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const [updated] = await db.update(organizationWebsites)
      .set({
        status: "PUBLISHED",
        lastPublishedAt: new Date(),
        lastPublishedByUserId: user.id,
        updatedAt: new Date(),
      })
      .where(eq(organizationWebsites.id, website.id))
      .returning();

    await logUpdate(user.id, "organization_websites", website.id, website, { status: "PUBLISHED", lastPublishedAt: new Date() }, req);

    await db.insert(websiteDeployments).values({
      websiteId: website.id,
      organizationId: website.organizationId,
      action: "REPUBLISHED",
      performedByUserId: user.id,
      performedByName: `${user.firstName} ${user.lastName}`.trim() || user.email,
      note: "Website re-published with latest changes",
    });

    res.json({
      success: true,
      website: updated,
      siteUrl: `https://${website.subdomain}.smartmanageai-sites.com`,
    });
  } catch (error) {
    console.error("Error republishing website:", error);
    res.status(500).json({ error: "Failed to republish website" });
  }
});

export default router;