import {logError, logWarn } from "./utils/logger";
import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, asc, sql, ilike } from "drizzle-orm";
import { organizationWebsites, organizationWebsitePages, organizationSocialLinks, organizations, OrganizationWebsite, websiteDeployments, websiteProjects, websiteProjectImages, socialPostHistory, websiteContactSubmissions, crmOrganisations, crmContacts, pagePreviewLinks, pageVersions, websiteBlogPosts, hiringJobs, hiringCandidates, hiringCandidateDocuments, users } from "@shared/schema";
import { requireAuth, AuthRequest, requireFeaturePermission } from "./auth";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { ObjectStorageService, ObjectNotFoundError, objectStorageClient } from "./objectStorage";
import multer from "multer";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { sendEmail } from "./email";
import { governedAiCall, estimateCost } from "./services/aiGovernance";
import { insertNotification } from "./services/notificationService";

const router = Router();

// ========================================
// Routes from websiteBuilderRoutes.ts
// ========================================

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

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// GET /api/website/org-logo/:orgId - Serve organization logo directly from GCS (PUBLIC)
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
        logWarn("Non-critical operation failed");
        return res.status(404).json({ error: "Logo not found" });
      }
      return res.redirect(org.logoUrl);
    }

    const objectFile = await objectStorageService.getObjectEntityFile(normalizedPath);
    objectStorageService.downloadObject(objectFile, res);
  } catch (error: any) {
    logError("Error serving org logo:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error fetching website:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error saving website:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error publishing website:", {}, error instanceof Error ? error : new Error(String(error)));
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
      careersEnabled: website.careersEnabled || false,
      careersIntroText: website.careersIntroText || null,
    });
  } catch (error) {
    logError("Error fetching public website:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch website" });
  }
});

// GET /api/website/public/:subdomain/sitemap.xml - Dynamic sitemap for published website
router.get("/public/:subdomain/sitemap.xml", async (req: Request, res: Response) => {
  try {
    const { subdomain } = req.params;
    if (!subdomain) {
      return res.status(400).send("Subdomain is required");
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: and(
        eq(organizationWebsites.subdomain, subdomain),
        eq(organizationWebsites.status, "PUBLISHED")
      ),
    });

    if (!website) {
      return res.status(404).send("Website not found");
    }

    const orgId = website.organizationId;
    const baseUrl = `https://${subdomain}.smartmanageai-sites.com`;

    const pages = await db.query.organizationWebsitePages.findMany({
      where: and(
        eq(organizationWebsitePages.organizationId, orgId),
        eq(organizationWebsitePages.isPublished, true)
      ),
    });

    const blogPostsResult = await db.execute(sql`
      SELECT slug, updated_at FROM website_blog_posts
      WHERE organization_id = ${orgId} AND status = 'PUBLISHED'
    `);
    const blogPosts = blogPostsResult.rows;

    const projectsResult = await db.execute(sql`
      SELECT slug, updated_at FROM website_projects
      WHERE organization_id = ${orgId} AND status = 'PUBLISHED'
    `);
    const projects = projectsResult.rows;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    for (const page of pages) {
      if (page.noIndex) continue;
      const slug = page.pageSlug === "home" ? "" : encodeURIComponent(page.pageSlug);
      const loc = escapeXml(`${baseUrl}/${slug}`);
      const lastmod = page.updatedAt ? new Date(page.updatedAt).toISOString().split("T")[0] : undefined;
      xml += `  <url>\n    <loc>${loc}</loc>\n`;
      if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>weekly</changefreq>\n  </url>\n`;
    }

    for (const post of blogPosts) {
      const loc = escapeXml(`${baseUrl}/blog/${encodeURIComponent((post as any).slug)}`);
      const lastmod = (post as any).updated_at ? new Date((post as any).updated_at).toISOString().split("T")[0] : undefined;
      xml += `  <url>\n    <loc>${loc}</loc>\n`;
      if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n  </url>\n`;
    }

    for (const project of projects) {
      const loc = escapeXml(`${baseUrl}/projects/${encodeURIComponent((project as any).slug)}`);
      const lastmod = (project as any).updated_at ? new Date((project as any).updated_at).toISOString().split("T")[0] : undefined;
      xml += `  <url>\n    <loc>${loc}</loc>\n`;
      if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
      xml += `    <changefreq>monthly</changefreq>\n  </url>\n`;
    }

    xml += `</urlset>`;
    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (error) {
    logError("Error generating sitemap:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).send("Failed to generate sitemap");
  }
});

// GET /api/website/public/:subdomain/robots.txt - Dynamic robots.txt for published website
router.get("/public/:subdomain/robots.txt", async (req: Request, res: Response) => {
  try {
    const { subdomain } = req.params;
    if (!subdomain) {
      return res.status(400).send("Subdomain is required");
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: and(
        eq(organizationWebsites.subdomain, subdomain),
        eq(organizationWebsites.status, "PUBLISHED")
      ),
    });

    if (!website) {
      return res.status(404).send("Website not found");
    }

    const baseUrl = `https://${subdomain}.smartmanageai-sites.com`;

    let robotsTxt = `User-agent: *\n`;
    robotsTxt += `Allow: /\n`;
    robotsTxt += `Disallow: /api/\n`;
    robotsTxt += `Disallow: /staging/\n\n`;
    robotsTxt += `Sitemap: ${baseUrl}/api/website/public/${subdomain}/sitemap.xml\n`;

    res.set("Content-Type", "text/plain");
    res.send(robotsTxt);
  } catch (error) {
    logError("Error generating robots.txt:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).send("Failed to generate robots.txt");
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
    logError("Error fetching staging token:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error generating staging token:", {}, error instanceof Error ? error : new Error(String(error)));
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
      careersEnabled: website.careersEnabled || false,
      careersIntroText: website.careersIntroText || null,
      isStaging: true,
    });
  } catch (error) {
    logError("Error fetching staging website:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch staging website" });
  }
});

// ============================================
// AUTHENTICATED ROUTES (require auth + feature permission)
// ============================================

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
    logError("Error fetching preview data:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error fetching global components:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error saving global component:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error updating global component:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error duplicating global component:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error deleting global component:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error unpublishing website:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error toggling maintenance mode:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error updating custom domain:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error verifying domain:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error fetching deployments:", {}, error instanceof Error ? error : new Error(String(error)));
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
    logError("Error republishing website:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to republish website" });
  }
});

// ========================================
// Routes from websiteContentRoutes.ts
// ========================================

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'));
    }
  }
});
const STORAGE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;

// ============================================
// IMAGE UPLOAD & MEDIA LIBRARY
// ============================================

// POST /api/website/upload-image - Upload an image to object storage
router.post("/upload-image", requireAuth, upload.single("image"), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization access required" });
    }

    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return res.status(500).json({ error: "Object storage not configured" });
    }

    const basePath = publicPaths[0];

    const prefix = `gallery/${orgId}/`;
    const basePathParts = basePath.split('/').filter(p => p.length > 0);
    const checkBucketName = basePathParts[0];
    const bucketPrefix = basePathParts.length > 1 ? basePathParts.slice(1).join('/') + '/' + prefix : prefix;
    const checkBucket = objectStorageClient.bucket(checkBucketName);
    const [existingFiles] = await checkBucket.getFiles({ prefix: bucketPrefix });
    let currentTotalSize = 0;
    for (const f of existingFiles) {
      const [meta] = await f.getMetadata();
      currentTotalSize += parseInt(meta.size as string) || 0;
    }
    if (currentTotalSize + file.size > STORAGE_LIMIT_BYTES) {
      return res.status(413).json({ error: "Storage limit exceeded. You have used " + (currentTotalSize / (1024 * 1024 * 1024)).toFixed(2) + " GB of 3 GB." });
    }

    const ext = file.originalname.split('.').pop() || 'jpg';
    const uniqueId = randomUUID();
    const fileName = `gallery/${orgId}/${uniqueId}.${ext}`;

    const fullPath = `${basePath}/${fileName}`;

    const pathParts = fullPath.split('/').filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join('/');

    const bucket = objectStorageClient.bucket(bucketName);
    const blob = bucket.file(objectName);

    await blob.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
        },
      },
    });

    const proxyUrl = `/api/website/image/${orgId}/${uniqueId}.${ext}`;

    res.json({ 
      url: proxyUrl,
      fileName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    });
  } catch (error) {
    logError("Error uploading image:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// GET /api/website/image/:orgId/:fileName - Serve uploaded website images from GCS
router.get("/image/:orgId/:fileName", async (req: Request, res: Response) => {
  try {
    const { orgId, fileName } = req.params;
    const filePath = `gallery/${orgId}/${fileName}`;

    const file = await objectStorage.searchPublicObject(filePath);
    if (!file) {
      return res.status(404).json({ error: "Image not found" });
    }

    objectStorage.downloadObject(file, res, 86400);
  } catch (error: any) {
    logError("Error serving website image:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "Image not found" });
    }
    res.status(500).json({ error: "Failed to serve image" });
  }
});

// GET /api/website/media - List all media files for the organization
router.get("/media", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization access required" });
    }

    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return res.json({ files: [], totalSize: 0, storageLimit: STORAGE_LIMIT_BYTES });
    }

    const basePath = publicPaths[0];
    const prefix = `gallery/${orgId}/`;
    const pathParts = basePath.split('/').filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const bucketPrefix = pathParts.length > 1 ? pathParts.slice(1).join('/') + '/' + prefix : prefix;

    const bucket = objectStorageClient.bucket(bucketName);
    const [gcsFiles] = await bucket.getFiles({ prefix: bucketPrefix });

    let totalSize = 0;
    const files = await Promise.all(
      gcsFiles.map(async (f) => {
        const [metadata] = await f.getMetadata();
        const size = parseInt(metadata.size as string) || 0;
        totalSize += size;
        const fileName = f.name.split('/').pop() || '';
        return {
          name: fileName,
          originalName: metadata.metadata?.originalName || fileName,
          url: `/api/website/image/${orgId}/${fileName}`,
          size,
          contentType: metadata.contentType || 'application/octet-stream',
          source: metadata.metadata?.source || null,
          createdAt: metadata.timeCreated || new Date().toISOString(),
          updatedAt: metadata.updated || new Date().toISOString(),
        };
      })
    );

    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ files, totalSize, storageLimit: STORAGE_LIMIT_BYTES });
  } catch (error) {
    logError("Error listing media files:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to list media files" });
  }
});

// DELETE /api/website/media/:fileName - Delete a media file
router.delete("/media/:fileName", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization access required" });
    }

    const { fileName } = req.params;
    if (!fileName || fileName.includes('/') || fileName.includes('..')) {
      return res.status(400).json({ error: "Invalid file name" });
    }
    const filePath = `gallery/${orgId}/${fileName}`;

    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return res.status(500).json({ error: "Object storage not configured" });
    }

    const basePath = publicPaths[0];
    const fullPath = `${basePath}/${filePath}`;
    const pathParts = fullPath.split('/').filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join('/');

    const bucket = objectStorageClient.bucket(bucketName);
    const blob = bucket.file(objectName);
    const [exists] = await blob.exists();

    if (!exists) {
      return res.status(404).json({ error: "File not found" });
    }

    await blob.delete();
    res.json({ success: true });
  } catch (error) {
    logError("Error deleting media file:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// ============================================
// PROJECT GALLERY
// ============================================

// GET /api/website/projects - List gallery projects
router.get("/projects", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    let result;
    if (orgId) {
      result = await db.execute(sql`
        SELECT * FROM website_projects 
        WHERE organization_id = ${orgId}
        ORDER BY created_at DESC
      `);
    } else {
      result = await db.execute(sql`
        SELECT * FROM website_projects 
        ORDER BY created_at DESC
      `);
    }

    res.json(result.rows);
  } catch (error) {
    logError("Error fetching gallery projects:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch gallery projects" });
  }
});

// POST /api/website/projects - Create a gallery project
router.post("/projects", requireAuth, async (req: AuthRequest, res: Response) => {
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
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    const slug = req.body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { title, shortDescription, projectType, serviceType, clientName, locationCity, locationState, coverImageUrl } = req.body;
    
    const result = await db.execute(sql`
      INSERT INTO website_projects (
        website_id, organization_id, slug, title, short_description,
        project_type, service_type, client_name, location_city, location_state,
        cover_image_url, status
      ) VALUES (
        ${website.id}, ${orgId}, ${slug}, ${title}, ${shortDescription || null},
        ${projectType || null}, ${serviceType || null}, ${clientName || null},
        ${locationCity || null}, ${locationState || null}, ${coverImageUrl || null}, 'DRAFT'
      ) RETURNING *
    `);
    
    const project = result.rows[0];

    await logCreate(user.id, "website_projects", project.id as string, {
      title, shortDescription, projectType, serviceType, clientName,
      locationCity, locationState, coverImageUrl, slug,
      websiteId: website.id, organizationId: orgId
    }, req);

    res.status(201).json(project);
  } catch (error) {
    logError("Error creating gallery project:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create gallery project" });
  }
});

// GET /api/website/projects/:id - Get a gallery project
router.get("/projects/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const project = await db.query.websiteProjects.findFirst({
      where: and(
        eq(websiteProjects.id, id),
        orgId ? eq(websiteProjects.organizationId, orgId) : undefined
      ),
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const images = await db.query.websiteProjectImages.findMany({
      where: eq(websiteProjectImages.projectId, id),
      orderBy: [asc(websiteProjectImages.displayOrder)],
    });

    res.json({ ...project, images });
  } catch (error) {
    logError("Error fetching gallery project:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch gallery project" });
  }
});

// PATCH /api/website/projects/:id - Update a gallery project
router.patch("/projects/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    let existingResult;
    if (orgId) {
      existingResult = await db.execute(sql`
        SELECT id FROM website_projects 
        WHERE id = ${id} AND organization_id = ${orgId}
      `);
    } else {
      existingResult = await db.execute(sql`
        SELECT id FROM website_projects WHERE id = ${id}
      `);
    }

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { title, shortDescription, projectType, serviceType, clientName, locationCity, locationState, coverImageUrl } = req.body;
    const updatedAt = new Date().toISOString();
    
    let result;
    if (orgId) {
      result = await db.execute(sql`
        UPDATE website_projects
        SET 
          title = COALESCE(${title}, title),
          short_description = COALESCE(${shortDescription}, short_description),
          project_type = COALESCE(${projectType}, project_type),
          service_type = COALESCE(${serviceType}, service_type),
          client_name = COALESCE(${clientName}, client_name),
          location_city = COALESCE(${locationCity}, location_city),
          location_state = COALESCE(${locationState}, location_state),
          cover_image_url = COALESCE(${coverImageUrl}, cover_image_url),
          updated_at = ${updatedAt}
        WHERE id = ${id} AND organization_id = ${orgId}
        RETURNING *
      `);
    } else {
      result = await db.execute(sql`
        UPDATE website_projects
        SET 
          title = COALESCE(${title}, title),
          short_description = COALESCE(${shortDescription}, short_description),
          project_type = COALESCE(${projectType}, project_type),
          service_type = COALESCE(${serviceType}, service_type),
          client_name = COALESCE(${clientName}, client_name),
          location_city = COALESCE(${locationCity}, location_city),
          location_state = COALESCE(${locationState}, location_state),
          cover_image_url = COALESCE(${coverImageUrl}, cover_image_url),
          updated_at = ${updatedAt}
        WHERE id = ${id}
        RETURNING *
      `);
    }

    const updated = result.rows[0];
    res.json(updated);
  } catch (error) {
    logError("Error updating gallery project:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update gallery project" });
  }
});

// POST /api/website/projects/:id/images - Add image to project
router.post("/projects/:id/images", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    const project = await db.query.websiteProjects.findFirst({
      where: and(
        eq(websiteProjects.id, id),
        orgId ? eq(websiteProjects.organizationId, orgId) : undefined
      ),
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }
    
    const imageData = {
      projectId: id,
      ...req.body,
    };

    const [image] = await db.insert(websiteProjectImages)
      .values(imageData)
      .returning();

    await logCreate(user.id, "website_project_images", image.id, imageData, req);

    res.status(201).json(image);
  } catch (error) {
    logError("Error adding project image:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to add project image" });
  }
});

// POST /api/website/projects/generate-description - AI generate project description
router.post("/projects/generate-description", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { title, serviceType, projectType, highlights } = req.body;

    const prompt = `Write a professional project description for a construction portfolio:

Project: ${title}
Service Type: ${serviceType || 'General construction'}
Project Type: ${projectType || 'Commercial'}
${highlights ? `Key Highlights: ${highlights}` : ''}

Return a JSON object with:
{
  "shortDescription": "2-3 sentence teaser for cards/previews",
  "fullDescription": "Detailed 2-3 paragraph description for project page",
  "metaTitle": "SEO title",
  "metaDescription": "SEO description",
  "keywords": ["keyword1", "keyword2"]
}`;

    const orgId = user.organizationId;
    const { result: content, blocked, reason } = await governedAiCall({
      orgId: orgId || "system",
      userId: user.id,
      actionType: "website_project_description_generate",
      inputRefs: { title, serviceType, projectType },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: "system", content: "You are a professional construction project portfolio writer." },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 1000,
          response_format: { type: "json_object" },
        });
        return {
          result: JSON.parse(completion.choices[0]?.message?.content || "{}"),
          completion,
        };
      },
    });

    if (blocked) {
      return res.status(429).json({ error: reason || "AI usage limit reached" });
    }

    res.json(content);
  } catch (error) {
    logError("Error generating project description:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate description" });
  }
});

// ============================================
// SOCIAL MEDIA LINKS
// ============================================

// GET /api/website/social - Get social media links
router.get("/social", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const links = await db.query.organizationSocialLinks.findFirst({
      where: orgId ? eq(organizationSocialLinks.organizationId, orgId) : undefined,
    });

    res.json(links || {});
  } catch (error) {
    logError("Error fetching social links:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch social links" });
  }
});

// POST /api/website/social - Save social media links
router.post("/social", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const existing = await db.query.organizationSocialLinks.findFirst({
      where: eq(organizationSocialLinks.organizationId, orgId!),
    });

    let links;
    if (existing) {
      const [updated] = await db.update(organizationSocialLinks)
        .set({ ...req.body, updatedAt: new Date() })
        .where(eq(organizationSocialLinks.id, existing.id))
        .returning();
      links = updated;
      await logUpdate(user.id, "organization_social_links", existing.id, existing, updated, req);
    } else {
      const [created] = await db.insert(organizationSocialLinks)
        .values({ ...req.body, organizationId: orgId })
        .returning();
      links = created;
      await logCreate(user.id, "organization_social_links", created.id, req.body, req);
    }

    res.json(links);
  } catch (error) {
    logError("Error saving social links:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to save social links" });
  }
});

// POST /api/website/social/generate-post - AI generate social media post
router.post("/social/generate-post", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { platform, topic, sourceType, sourceId, tone } = req.body;

    if (!platform || !topic) {
      return res.status(400).json({ error: "Platform and topic are required" });
    }

    let orgDetails = null;
    if (user.organizationId) {
      orgDetails = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
      });
    }

    const platformGuides: Record<string, string> = {
      FACEBOOK: "Write for Facebook. Can be longer (up to 500 words), conversational, encourage engagement.",
      INSTAGRAM: "Write for Instagram. Focus on visuals, use emojis, max 2200 characters, include call-to-action.",
      LINKEDIN: "Write for LinkedIn. Professional tone, industry insights, thought leadership, 1300 character limit.",
      TWITTER: "Write for X/Twitter. Concise (280 chars max), punchy, include relevant hashtags.",
      TIKTOK: "Write for TikTok. Casual, trendy, engaging, focus on video caption format.",
      YOUTUBE: "Write for YouTube. Video description style, include relevant keywords, call-to-action for subscribe.",
    };

    const prompt = `Create a social media post for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".

Platform: ${platform}
Topic: ${topic}
Tone: ${tone || 'professional'}
${platformGuides[platform] || ''}

Return a JSON object with:
{
  "content": "The full post content",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "suggestedImagePrompt": "Description for an AI image generator if applicable",
  "bestTimeToPost": "Suggested posting time",
  "engagementTips": "Tips to boost engagement"
}`;

    const govOrgId = user.organizationId || "system";
    const { result: postContent, blocked: socialBlocked, reason: socialReason } = await governedAiCall({
      orgId: govOrgId,
      userId: user.id,
      actionType: "social_post_generate",
      inputRefs: { platform, topic, tone, sourceType },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { 
              role: "system", 
              content: "You are a social media marketing expert for the construction industry." 
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 1000,
          response_format: { type: "json_object" },
        });
        return {
          result: JSON.parse(completion.choices[0]?.message?.content || "{}"),
          completion,
        };
      },
    });

    if (socialBlocked) {
      return res.status(429).json({ error: socialReason || "AI usage limit reached" });
    }

    if (user.organizationId) {
      const hashtagsArray = postContent.hashtags || [];
      const hashtagsValue = `{${hashtagsArray.map((h: string) => `"${h.replace(/"/g, '\\"')}"`).join(',')}}`;
      
      await db.execute(sql`
        INSERT INTO social_post_history 
        (organization_id, platform, post_content, hashtags, source_type, source_id, ai_prompt, tone, suggested_image_prompt, created_by_id)
        VALUES (
          ${user.organizationId},
          ${platform},
          ${postContent.content},
          ${hashtagsValue}::text[],
          ${sourceType || null},
          ${sourceId || null},
          ${topic},
          ${tone || 'professional'},
          ${postContent.suggestedImagePrompt || null},
          ${user.id}
        )
      `);
    }

    res.json(postContent);
  } catch (error) {
    logError("Error generating social post:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to generate social post" });
  }
});

// GET /api/website/social/history - Get social post history
router.get("/social/history", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const history = await db.query.socialPostHistory.findMany({
      where: orgId ? eq(socialPostHistory.organizationId, orgId) : undefined,
      orderBy: [desc(socialPostHistory.createdAt)],
      limit: 50,
    });

    res.json(history);
  } catch (error) {
    logError("Error fetching social history:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch social history" });
  }
});

// ============================================
// CONTACT FORM SUBMISSIONS
// ============================================

const formSubmissionRateLimit = new Map<string, { count: number; resetAt: number }>();

// POST /api/website/contact - Submit contact form (public)
router.post("/contact", async (req: Request, res: Response) => {
  try {
    const { websiteId, name, email, phone, company, subject, message, serviceInterest, projectType, estimatedBudget, recipientEmail, formFields, _hp, _ts } = req.body;

    if (_hp && _hp.length > 0) {
      return res.json({ success: true, id: 'ok' });
    }

    if (_ts) {
      const tsNum = Number(_ts);
      if (!isNaN(tsNum) && tsNum > 0) {
        const elapsed = Date.now() - tsNum;
        if (elapsed >= 0 && elapsed < 2000) {
          return res.json({ success: true, id: 'ok' });
        }
      }
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rateEntry = formSubmissionRateLimit.get(ipAddress);
    if (rateEntry) {
      if (now < rateEntry.resetAt) {
        if (rateEntry.count >= 5) {
          return res.status(429).json({ error: "Too many submissions. Please try again later." });
        }
        rateEntry.count++;
      } else {
        formSubmissionRateLimit.set(ipAddress, { count: 1, resetAt: now + 60000 });
      }
    } else {
      formSubmissionRateLimit.set(ipAddress, { count: 1, resetAt: now + 60000 });
    }

    if (formSubmissionRateLimit.size > 1000) {
      const keys = Array.from(formSubmissionRateLimit.keys());
      for (const key of keys) {
        const val = formSubmissionRateLimit.get(key);
        if (val && now > val.resetAt) formSubmissionRateLimit.delete(key);
      }
    }

    if (!websiteId || !name || !email) {
      return res.status(400).json({ error: "Missing required fields (websiteId, name, email)" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.id, websiteId),
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const userAgent = req.headers['user-agent'];

    const [submission] = await db.insert(websiteContactSubmissions).values({
      websiteId,
      organizationId: website.organizationId,
      name,
      email,
      phone,
      company,
      subject,
      message: message || (formFields ? JSON.stringify(formFields) : ''),
      serviceInterest,
      projectType,
      estimatedBudget,
      sourcePage: req.body.sourcePage,
      utmSource: req.body.utm_source,
      utmMedium: req.body.utm_medium,
      utmCampaign: req.body.utm_campaign,
      ipAddress,
      userAgent,
    }).returning();

    const escapeHtml = (str: string): string => {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };

    const targetEmail = recipientEmail || website.contactEmail;
    if (targetEmail) {
      try {
        let fieldsHtml = '';
        if (formFields && typeof formFields === 'object') {
          fieldsHtml = Object.entries(formFields)
            .map(([label, value]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#374151;white-space:nowrap;">${escapeHtml(String(label))}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#1f2937;">${escapeHtml(String(value))}</td></tr>`)
            .join('');
        } else {
          fieldsHtml = `
            <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">Name</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(name)}</td></tr>
            <tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(email)}</td></tr>
            ${phone ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(phone)}</td></tr>` : ''}
            ${company ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">Company</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(company)}</td></tr>` : ''}
            ${subject ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">Subject</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(subject)}</td></tr>` : ''}
            ${message ? `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;">Message</td><td style="padding:8px 12px;border-bottom:1px solid #eee;">${escapeHtml(message)}</td></tr>` : ''}
          `;
        }

        const emailHtml = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <div style="background:#1f2937;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
              <h2 style="margin:0;font-size:20px;">New Form Submission</h2>
              <p style="margin:8px 0 0;opacity:0.8;font-size:14px;">From your website contact form</p>
            </div>
            <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;overflow:hidden;">
              <table style="width:100%;border-collapse:collapse;">
                ${fieldsHtml}
              </table>
            </div>
            <p style="color:#6b7280;font-size:12px;margin-top:16px;text-align:center;">
              Submitted on ${new Date().toLocaleString()} | Source: ${escapeHtml(req.body.sourcePage || 'Website')}
            </p>
          </div>
        `;

        await sendEmail({
          to: targetEmail,
          subject: `New Form Submission${subject ? ': ' + escapeHtml(subject) : ''} - Website Contact`,
          html: emailHtml,
          text: `New form submission from ${name} (${email}).\n\n${formFields ? Object.entries(formFields).map(([k, v]) => `${k}: ${v}`).join('\n') : message || ''}`,
          replyTo: email,
        });
      } catch (emailErr) {
        logError("Error sending form notification email:", {}, emailErr instanceof Error ? emailErr : new Error(String(emailErr)));
      }
    }

    res.json({ success: true, id: submission.id });
  } catch (error) {
    logError("Error submitting contact form:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to submit contact form" });
  }
});

// GET /api/website/contact/submissions - Get contact form submissions
router.get("/contact/submissions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const submissions = await db.query.websiteContactSubmissions.findMany({
      where: orgId ? eq(websiteContactSubmissions.organizationId, orgId) : undefined,
      orderBy: [desc(websiteContactSubmissions.createdAt)],
    });

    res.json(submissions);
  } catch (error) {
    logError("Error fetching submissions:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

// PATCH /api/website/contact/submissions/:id - Update submission (mark read, responded)
router.patch("/contact/submissions/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const orgId = user.organizationId;

    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const existing = await db.query.websiteContactSubmissions.findFirst({
      where: and(
        eq(websiteContactSubmissions.id, id),
        orgId ? eq(websiteContactSubmissions.organizationId, orgId) : undefined
      ),
    });

    if (!existing) {
      return res.status(404).json({ error: "Submission not found" });
    }

    const updateData: any = {};
    if (req.body.read !== undefined) {
      updateData.read = req.body.read;
      if (req.body.read) updateData.readAt = new Date();
    }
    if (req.body.responded !== undefined) {
      updateData.responded = req.body.responded;
      if (req.body.responded) updateData.respondedAt = new Date();
    }

    const [updated] = await db.update(websiteContactSubmissions)
      .set(updateData)
      .where(and(
        eq(websiteContactSubmissions.id, id),
        orgId ? eq(websiteContactSubmissions.organizationId, orgId) : undefined
      ))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error updating submission:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update submission" });
  }
});

// POST /api/website/contact/submissions/:id/convert-to-crm - Convert to CRM lead
router.post("/contact/submissions/:id/convert-to-crm", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    const orgId = user.organizationId;

    if (!orgId) {
      return res.status(403).json({ error: "Organization access required" });
    }

    const submission = await db.query.websiteContactSubmissions.findFirst({
      where: and(
        eq(websiteContactSubmissions.id, id),
        eq(websiteContactSubmissions.organizationId, orgId)
      ),
    });

    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    let crmOrgId: string | null = null;
    if (submission.company) {
      const [crmOrg] = await db.insert(crmOrganisations).values({
        organizationId: orgId,
        name: submission.company,
        type: "CONTRACTOR",
      }).returning();
      crmOrgId = crmOrg.id;
    }

    if (!crmOrgId) {
      const [placeholderOrg] = await db.insert(crmOrganisations).values({
        organizationId: orgId,
        name: submission.name || "Contact Lead",
        type: "CONTRACTOR",
      }).returning();
      crmOrgId = placeholderOrg.id;
    }

    const nameParts = (submission.name || '').split(' ');
    const [crmContact] = await db.insert(crmContacts).values({
      organizationId: orgId,
      organisationId: crmOrgId,
      firstName: nameParts[0] || 'Unknown',
      lastName: nameParts.slice(1).join(' ') || '',
      email: submission.email,
      phone: submission.phone,
    }).returning();

    await db.update(websiteContactSubmissions)
      .set({
        convertedToCrm: true,
        convertedAt: new Date(),
        crmOrganisationId: crmOrgId,
        crmContactId: crmContact.id,
      })
      .where(eq(websiteContactSubmissions.id, id));

    res.json({
      success: true,
      crmOrganisationId: crmOrgId,
      crmContactId: crmContact.id,
    });
  } catch (error) {
    logError("Error converting to CRM:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to convert to CRM" });
  }
});

// ========================================
// Routes from websitePageRoutes.ts
// ========================================

interface PresenceEntry {
  userId: string;
  userName: string;
  pageId: string;
  lastSeen: number;
  activity: "viewing" | "editing";
}

const presenceStore = new Map<string, PresenceEntry>();
const PRESENCE_TIMEOUT_MS = 30000;

function cleanExpiredPresence() {
  const now = Date.now();
  const keys = Array.from(presenceStore.keys());
  for (const key of keys) {
    const entry = presenceStore.get(key);
    if (entry && now - entry.lastSeen > PRESENCE_TIMEOUT_MS) {
      presenceStore.delete(key);
    }
  }
}

setInterval(cleanExpiredPresence, 15000);

// GET /api/website/pages - List all pages
router.get("/pages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    let pages = await db.query.organizationWebsitePages.findMany({
      where: orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined,
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    if (orgId) {
      const website = await db.query.organizationWebsites.findFirst({
        where: eq(organizationWebsites.organizationId, orgId),
      });
      if (website) {
        const defaultPages = [
          { pageType: "HOME" as const, pageSlug: "home", pageTitle: "Homepage", navigationLabel: "Home", navigationOrder: 0 },
          { pageType: "SERVICES" as const, pageSlug: "services", pageTitle: "Services", navigationLabel: "Services", navigationOrder: 1 },
          { pageType: "ABOUT" as const, pageSlug: "about", pageTitle: "About", navigationLabel: "About", navigationOrder: 2 },
          { pageType: "CONTACT" as const, pageSlug: "contact", pageTitle: "Contact", navigationLabel: "Contact", navigationOrder: 3 },
        ];
        let created = false;
        for (const def of defaultPages) {
          if (!pages.some(p => p.pageType === def.pageType || p.pageSlug === def.pageSlug)) {
            const [newPage] = await db.insert(organizationWebsitePages)
              .values({
                websiteId: website.id,
                organizationId: orgId,
                pageType: def.pageType,
                pageSlug: def.pageSlug,
                pageTitle: def.pageTitle,
                navigationLabel: def.navigationLabel,
                showInNavigation: true,
                navigationOrder: def.navigationOrder,
                isPublished: true,
              })
              .returning();
            pages.push(newPage);
            created = true;
          }
        }
        if (created) {
          pages.sort((a, b) => (a.navigationOrder ?? 0) - (b.navigationOrder ?? 0));
        }
      }
    }

    res.json(pages);
  } catch (error) {
    logError("Error fetching pages:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch pages" });
  }
});

// POST /api/website/pages - Create a new page
router.post("/pages", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    let website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    console.log("Creating page with request body:", JSON.stringify(req.body));

    const { pageType, pageTitle, pageSlug, navigationLabel, showInNavigation, parentPageId, ...rest } = req.body;

    if (parentPageId) {
      const parentPage = await db.query.organizationWebsitePages.findFirst({
        where: and(
          eq(organizationWebsitePages.id, parentPageId),
          eq(organizationWebsitePages.organizationId, orgId!)
        ),
      });
      if (!parentPage) {
        return res.status(400).json({ error: "Parent page not found in your organization" });
      }
      if (parentPage.parentPageId) {
        return res.status(400).json({ error: "Cannot nest pages more than one level deep" });
      }
    }

    const pageData = {
      ...rest,
      pageType: pageType || "CUSTOM",
      pageTitle: pageTitle || "",
      pageSlug: pageSlug || "",
      navigationLabel: navigationLabel || pageTitle || "",
      showInNavigation: showInNavigation !== undefined ? showInNavigation : true,
      parentPageId: parentPageId || null,
      websiteId: website.id,
      organizationId: orgId,
    };

    console.log("Page data to insert:", JSON.stringify(pageData));

    const [page] = await db.insert(organizationWebsitePages)
      .values(pageData)
      .returning();

    await logCreate(user.id, "organization_website_pages", page.id, pageData, req);

    res.status(201).json(page);
  } catch (error) {
    logError("Error creating page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create page" });
  }
});

// GET /api/website/pages/:id - Get a specific page
router.get("/pages/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, id),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }

    res.json(page);
  } catch (error) {
    logError("Error fetching page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch page" });
  }
});

// PATCH /api/website/pages/:id - Update a page
router.patch("/pages/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    const existing = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, id),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!existing) {
      return res.status(404).json({ error: "Page not found" });
    }

    if (req.body.parentPageId !== undefined && req.body.parentPageId) {
      if (req.body.parentPageId === id) {
        return res.status(400).json({ error: "A page cannot be its own parent" });
      }
      const parentPage = await db.query.organizationWebsitePages.findFirst({
        where: and(
          eq(organizationWebsitePages.id, req.body.parentPageId),
          eq(organizationWebsitePages.organizationId, existing.organizationId)
        ),
      });
      if (!parentPage) {
        return res.status(400).json({ error: "Parent page not found" });
      }
      if (parentPage.parentPageId) {
        return res.status(400).json({ error: "Cannot nest pages more than one level deep" });
      }
    }

    const isPublishing = req.body.isPublished === true && !existing.isPublished;

    const [updated] = await db.update(organizationWebsitePages)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(organizationWebsitePages.id, id))
      .returning();

    await logUpdate(user.id, "organization_website_pages", id, existing, updated, req);

    if (isPublishing) {
      try {
        await createVersionSnapshot(existing, user, "publish", "Published page");
      } catch (e) {
        logError("Error creating version snapshot on publish:", {}, e instanceof Error ? e : new Error(String(e)));
      }
    }

    res.json(updated);
  } catch (error) {
    logError("Error updating page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update page" });
  }
});

// DELETE /api/website/pages/:id - Delete a page
router.delete("/pages/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    const existing = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, id),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!existing) {
      return res.status(404).json({ error: "Page not found" });
    }

    const corePageTypes = ["HOME", "SERVICES", "ABOUT", "CONTACT"];
    if (corePageTypes.includes(existing.pageType)) {
      return res.status(400).json({ error: "Cannot delete core navigation pages (Home, Services, About, Contact)." });
    }

    await db.delete(organizationWebsitePages)
      .where(eq(organizationWebsitePages.id, id));

    await logDelete(user.id, "organization_website_pages", id, existing, req);

    res.json({ success: true });
  } catch (error) {
    logError("Error deleting page:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to delete page" });
  }
});

// ==============================================
// Presence Routes
// ==============================================

router.post("/pages/:pageId/presence", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    const activity = req.body.activity || "viewing";
    const userName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown";
    const key = `${user.id}:${pageId}`;

    presenceStore.set(key, {
      userId: user.id,
      userName,
      pageId,
      lastSeen: Date.now(),
      activity,
    });

    cleanExpiredPresence();

    const activeUsers: PresenceEntry[] = [];
    Array.from(presenceStore.values()).forEach(entry => {
      if (entry.pageId === pageId && entry.userId !== user.id) {
        activeUsers.push(entry);
      }
    });

    res.json({ users: activeUsers });
  } catch (error) {
    logError("Error updating presence:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update presence" });
  }
});

router.delete("/pages/:pageId/presence", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    presenceStore.delete(`${user.id}:${pageId}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to remove presence" });
  }
});

// ==============================================
// Conflict-Safe Save Check
// ==============================================

router.get("/pages/:pageId/check-conflict", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    const clientUpdatedAt = req.query.since as string;

    if (!clientUpdatedAt) {
      return res.json({ conflict: false });
    }

    const orgId = user.organizationId;
    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });

    if (!page) return res.status(404).json({ error: "Page not found" });

    const clientDate = new Date(clientUpdatedAt);
    const serverDate = new Date(page.updatedAt);
    const conflict = serverDate.getTime() > clientDate.getTime() + 1000;

    const lastVersion = conflict ? await db.query.pageVersions.findFirst({
      where: eq(pageVersions.pageId, pageId),
      orderBy: [desc(pageVersions.versionNumber)],
    }) : null;

    res.json({
      conflict,
      serverUpdatedAt: page.updatedAt,
      lastEditor: lastVersion?.editorName || null,
      lastSaved: lastVersion?.createdAt || null,
    });
  } catch (error) {
    logError("Error checking conflict:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to check conflict" });
  }
});

// ==============================================
// Version Diff Route
// ==============================================

router.get("/versions/diff/:versionIdA/:versionIdB", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { versionIdA, versionIdB } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [versionA, versionB] = await Promise.all([
      db.query.pageVersions.findFirst({ where: eq(pageVersions.id, versionIdA) }),
      db.query.pageVersions.findFirst({ where: eq(pageVersions.id, versionIdB) }),
    ]);

    if (!versionA || !versionB) {
      return res.status(404).json({ error: "One or both versions not found" });
    }

    if (versionA.pageId !== versionB.pageId) {
      return res.status(400).json({ error: "Versions must belong to the same page" });
    }

    const parseComponents = (json: string | null) => {
      try {
        if (!json) return [];
        const parsed = JSON.parse(json);
        return parsed.components || [];
      } catch { return []; }
    };

    const parseSettings = (json: string | null) => {
      try {
        if (!json) return {};
        return JSON.parse(json);
      } catch { return {}; }
    };

    const compsA = parseComponents(versionA.contentJson);
    const compsB = parseComponents(versionB.contentJson);
    const settingsA = parseSettings(versionA.pageSettingsJson);
    const settingsB = parseSettings(versionB.pageSettingsJson);

    const idsA = new Set(compsA.map((c: any) => c.id));
    const idsB = new Set(compsB.map((c: any) => c.id));
    const compsMapA = new Map(compsA.map((c: any) => [c.id, c]));
    const compsMapB = new Map(compsB.map((c: any) => [c.id, c]));

    const diff: any[] = [];

    for (const comp of compsB) {
      if (!idsA.has(comp.id)) {
        diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "added", component: comp });
      } else {
        const oldComp: any = compsMapA.get(comp.id);
        const oldJson = JSON.stringify(oldComp);
        const newJson = JSON.stringify(comp);
        if (oldJson !== newJson) {
          const changes: string[] = [];
          if (JSON.stringify(oldComp?.config) !== JSON.stringify(comp.config)) changes.push("content");
          if (JSON.stringify(oldComp?.styles) !== JSON.stringify(comp.styles)) changes.push("styles");
          if (oldComp?.label !== comp.label) changes.push("label");
          if (oldComp?.order !== comp.order) changes.push("order");
          if (oldComp?.enabled !== comp.enabled) changes.push("visibility");
          diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "modified", changes, oldComponent: oldComp, component: comp });
        } else {
          diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "unchanged" });
        }
      }
    }

    for (const comp of compsA) {
      if (!idsB.has(comp.id)) {
        diff.push({ id: comp.id, type: comp.type, label: comp.label, status: "removed", component: comp });
      }
    }

    const settingsChanges: any[] = [];
    const allKeysArr = Array.from(new Set([...Object.keys(settingsA), ...Object.keys(settingsB)]));
    for (const key of allKeysArr) {
      if (JSON.stringify(settingsA[key]) !== JSON.stringify(settingsB[key])) {
        settingsChanges.push({ field: key, oldValue: settingsA[key], newValue: settingsB[key] });
      }
    }

    res.json({
      versionA: { id: versionA.id, versionNumber: versionA.versionNumber, editorName: versionA.editorName, createdAt: versionA.createdAt, trigger: versionA.trigger },
      versionB: { id: versionB.id, versionNumber: versionB.versionNumber, editorName: versionB.editorName, createdAt: versionB.createdAt, trigger: versionB.trigger },
      componentDiff: diff,
      settingsChanges,
      summary: {
        added: diff.filter(d => d.status === "added").length,
        modified: diff.filter(d => d.status === "modified").length,
        removed: diff.filter(d => d.status === "removed").length,
        unchanged: diff.filter(d => d.status === "unchanged").length,
      },
    });
  } catch (error) {
    logError("Error computing version diff:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to compute version diff" });
  }
});

// ==============================================
// Version History Helper
// ==============================================
async function createVersionSnapshot(
  page: any,
  user: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null },
  trigger: string,
  changeSummary: string
) {
  const lastVersion = await db.query.pageVersions.findFirst({
    where: eq(pageVersions.pageId, page.id),
    orderBy: [desc(pageVersions.versionNumber)],
  });
  const nextVersion = (lastVersion?.versionNumber ?? 0) + 1;
  const editorName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown";

  const pageSettingsJson = JSON.stringify({
    pageTitle: page.pageTitle,
    pageSlug: page.pageSlug,
    pageType: page.pageType,
    navigationLabel: page.navigationLabel,
    showInNavigation: page.showInNavigation,
    isPublished: page.isPublished,
    metaTitle: page.metaTitle,
    metaDescription: page.metaDescription,
    canonicalUrl: page.canonicalUrl,
    noIndex: page.noIndex,
    ogImageUrl: page.ogImageUrl,
  });

  const [version] = await db.insert(pageVersions).values({
    pageId: page.id,
    organizationId: page.organizationId,
    versionNumber: nextVersion,
    contentJson: page.contentJson,
    pageSettingsJson,
    editorId: user.id,
    editorName,
    changeSummary,
    trigger,
  }).returning();
  return version;
}

function generateChangeSummary(oldContent: string | null, newContent: string | null): string {
  try {
    const oldParsed = oldContent ? JSON.parse(oldContent) : { components: [] };
    const newParsed = newContent ? JSON.parse(newContent) : { components: [] };
    const oldCount = oldParsed.components?.length || 0;
    const newCount = newParsed.components?.length || 0;
    const parts: string[] = [];
    if (newCount > oldCount) parts.push(`Added ${newCount - oldCount} component(s)`);
    else if (newCount < oldCount) parts.push(`Removed ${oldCount - newCount} component(s)`);
    if (newCount === oldCount && newCount > 0) parts.push(`Updated ${newCount} component(s)`);
    if (parts.length === 0) return "Page content updated";
    return parts.join(", ");
  } catch {
    logWarn("Non-critical operation failed");
    return "Page content updated";
  }
}

// ==============================================
// Preview Link Routes
// ==============================================

// POST /api/website/pages/:pageId/preview-link - Generate a preview link
router.post("/pages/:pageId/preview-link", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });
    if (!page) return res.status(404).json({ error: "Page not found" });

    const expiresInHours = req.body.expiresInHours || 72;
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
    const token = randomUUID();

    const [link] = await db.insert(pagePreviewLinks).values({
      pageId,
      organizationId: page.organizationId,
      token,
      createdById: user.id,
      expiresAt,
    }).returning();

    res.json(link);
  } catch (error) {
    logError("Error creating preview link:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create preview link" });
  }
});

// GET /api/website/pages/:pageId/preview-links - List active preview links
router.get("/pages/:pageId/preview-links", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const links = await db.query.pagePreviewLinks.findMany({
      where: and(
        eq(pagePreviewLinks.pageId, pageId),
        sql`${pagePreviewLinks.revokedAt} IS NULL`,
        sql`${pagePreviewLinks.expiresAt} > NOW()`
      ),
      orderBy: [desc(pagePreviewLinks.createdAt)],
    });

    res.json(links);
  } catch (error) {
    logError("Error listing preview links:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to list preview links" });
  }
});

// DELETE /api/website/preview-links/:linkId - Revoke a preview link
router.delete("/preview-links/:linkId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { linkId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const [updated] = await db.update(pagePreviewLinks)
      .set({ revokedAt: new Date() })
      .where(eq(pagePreviewLinks.id, linkId))
      .returning();

    if (!updated) return res.status(404).json({ error: "Preview link not found" });
    res.json({ success: true });
  } catch (error) {
    logError("Error revoking preview link:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to revoke preview link" });
  }
});

// GET /api/website/shared-preview/:token - Public preview (no auth)
router.get("/shared-preview/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const link = await db.query.pagePreviewLinks.findFirst({
      where: and(
        eq(pagePreviewLinks.token, token),
        sql`${pagePreviewLinks.revokedAt} IS NULL`,
        sql`${pagePreviewLinks.expiresAt} > NOW()`
      ),
    });

    if (!link) {
      return res.status(404).json({ error: "Preview link not found or expired" });
    }

    const page = await db.query.organizationWebsitePages.findFirst({
      where: eq(organizationWebsitePages.id, link.pageId),
    });

    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.id, page.websiteId),
    });

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, page.organizationId),
    });

    res.set("Cache-Control", "no-store");
    res.json({
      page,
      website: website ? {
        ...website,
        logoUrl: orgLogoProxyUrl(page.organizationId, website.logoUrl),
      } : null,
      organization: org ? {
        name: org.name,
        tradeType: org.tradeType,
        logoUrl: orgLogoProxyUrl(page.organizationId, org.logoUrl),
      } : null,
      expiresAt: link.expiresAt,
    });
  } catch (error) {
    logError("Error fetching shared preview:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch preview" });
  }
});

// ==============================================
// Version History Routes
// ==============================================

// POST /api/website/pages/:pageId/versions - Create a version snapshot manually
router.post("/pages/:pageId/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    const page = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });
    if (!page) return res.status(404).json({ error: "Page not found" });

    const changeSummary = req.body.changeSummary || generateChangeSummary(null, page.contentJson);
    const version = await createVersionSnapshot(page, user, req.body.trigger || "manual", changeSummary);
    res.json(version);
  } catch (error) {
    logError("Error creating version:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create version" });
  }
});

// GET /api/website/pages/:pageId/versions - List versions for a page
router.get("/pages/:pageId/versions", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const versions = await db.query.pageVersions.findMany({
      where: eq(pageVersions.pageId, pageId),
      orderBy: [desc(pageVersions.versionNumber)],
      limit: 50,
    });

    res.json(versions);
  } catch (error) {
    logError("Error listing versions:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to list versions" });
  }
});

// GET /api/website/versions/:versionId - Get a specific version
router.get("/versions/:versionId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { versionId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const version = await db.query.pageVersions.findFirst({
      where: eq(pageVersions.id, versionId),
    });

    if (!version) return res.status(404).json({ error: "Version not found" });
    res.json(version);
  } catch (error) {
    logError("Error fetching version:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch version" });
  }
});

// POST /api/website/pages/:pageId/revert/:versionId - Revert to a version
router.post("/pages/:pageId/revert/:versionId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { pageId, versionId } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    const currentPage = await db.query.organizationWebsitePages.findFirst({
      where: and(
        eq(organizationWebsitePages.id, pageId),
        orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined
      ),
    });
    if (!currentPage) return res.status(404).json({ error: "Page not found" });

    const targetVersion = await db.query.pageVersions.findFirst({
      where: and(
        eq(pageVersions.id, versionId),
        eq(pageVersions.pageId, pageId)
      ),
    });
    if (!targetVersion) return res.status(404).json({ error: "Version not found" });

    await createVersionSnapshot(currentPage, user, "revert", `Reverted to version ${targetVersion.versionNumber}`);

    const settingsToRestore: any = { contentJson: targetVersion.contentJson, updatedAt: new Date() };
    if (targetVersion.pageSettingsJson) {
      try {
        const settings = JSON.parse(targetVersion.pageSettingsJson);
        if (settings.pageTitle) settingsToRestore.pageTitle = settings.pageTitle;
        if (settings.pageSlug) settingsToRestore.pageSlug = settings.pageSlug;
        if (settings.navigationLabel !== undefined) settingsToRestore.navigationLabel = settings.navigationLabel;
        if (settings.showInNavigation !== undefined) settingsToRestore.showInNavigation = settings.showInNavigation;
        if (settings.metaTitle !== undefined) settingsToRestore.metaTitle = settings.metaTitle;
        if (settings.metaDescription !== undefined) settingsToRestore.metaDescription = settings.metaDescription;
        if (settings.canonicalUrl !== undefined) settingsToRestore.canonicalUrl = settings.canonicalUrl;
        if (settings.noIndex !== undefined) settingsToRestore.noIndex = settings.noIndex;
        if (settings.ogImageUrl !== undefined) settingsToRestore.ogImageUrl = settings.ogImageUrl;
      } catch { logWarn("Non-critical operation failed"); }
    }

    const [updated] = await db.update(organizationWebsitePages)
      .set(settingsToRestore)
      .where(eq(organizationWebsitePages.id, pageId))
      .returning();

    res.json(updated);
  } catch (error) {
    logError("Error reverting version:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to revert to version" });
  }
});

// ========================================
// Routes from websiteBlogRoutes.ts
// ========================================

// GET /api/website/blog/posts - List blog posts
router.get("/blog/posts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const { status } = req.query;

    let query;
    if (orgId) {
      if (status) {
        query = sql`
          SELECT * FROM website_blog_posts 
          WHERE organization_id = ${orgId} AND status = ${status}
          ORDER BY created_at DESC
        `;
      } else {
        query = sql`
          SELECT * FROM website_blog_posts 
          WHERE organization_id = ${orgId}
          ORDER BY created_at DESC
        `;
      }
    } else {
      if (status) {
        query = sql`
          SELECT * FROM website_blog_posts 
          WHERE status = ${status}
          ORDER BY created_at DESC
        `;
      } else {
        query = sql`
          SELECT * FROM website_blog_posts 
          ORDER BY created_at DESC
        `;
      }
    }
    
    const result = await db.execute(query);
    res.json(result.rows);
  } catch (error) {
    logError("Error fetching blog posts:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch blog posts" });
  }
});

// POST /api/website/blog/posts - Create a blog post
router.post("/blog/posts", requireAuth, async (req: AuthRequest, res: Response) => {
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
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    const slug = req.body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const { title, excerpt, content, contentHtml, contentJson, category, tags, 
            featuredImageUrl, coverImageUrl, metaTitle, metaDescription, 
            keywords, aiGenerated, aiPrompt } = req.body;
    
    const authorName = `${user.firstName} ${user.lastName}`;

    const result = await db.execute(sql`
      INSERT INTO website_blog_posts (
        website_id, organization_id, slug, title, excerpt,
        content_html, content_json, category, tags,
        cover_image_url, author_id, author_name, meta_title, meta_description,
        keywords, ai_generated, ai_prompt, status
      ) VALUES (
        ${website.id}, ${orgId}, ${slug}, ${title}, ${excerpt || null},
        ${contentHtml || content || null}, ${contentJson || null}, ${category || null}, ${tags || null},
        ${coverImageUrl || featuredImageUrl || null}, ${user.id}, ${authorName}, ${metaTitle || null}, ${metaDescription || null},
        ${keywords || null}, ${aiGenerated || false}, ${aiPrompt || null}, 'DRAFT'
      ) RETURNING *
    `);
    
    const post = result.rows[0];

    await logCreate(user.id, "website_blog_posts", post.id as string, {
      title, excerpt, content, contentHtml, category, tags, slug,
      websiteId: website.id, organizationId: orgId, authorId: user.id, authorName
    }, req);

    res.status(201).json(post);
  } catch (error) {
    logError("Error creating blog post:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to create blog post" });
  }
});

// GET /api/website/blog/posts/:id - Get a blog post
router.get("/blog/posts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const post = await db.query.websiteBlogPosts.findFirst({
      where: and(
        eq(websiteBlogPosts.id, id),
        orgId ? eq(websiteBlogPosts.organizationId, orgId) : undefined
      ),
    });

    if (!post) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    res.json(post);
  } catch (error) {
    logError("Error fetching blog post:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch blog post" });
  }
});

// PATCH /api/website/blog/posts/:id - Update a blog post
router.patch("/blog/posts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;

    let existingResult;
    if (orgId) {
      existingResult = await db.execute(sql`
        SELECT id FROM website_blog_posts 
        WHERE id = ${id} AND organization_id = ${orgId}
      `);
    } else {
      existingResult = await db.execute(sql`
        SELECT id FROM website_blog_posts WHERE id = ${id}
      `);
    }

    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    const { title, excerpt, content, category, status } = req.body;
    const updatedAt = new Date().toISOString();
    
    let result;
    if (orgId) {
      result = await db.execute(sql`
        UPDATE website_blog_posts
        SET 
          title = COALESCE(${title}, title),
          excerpt = COALESCE(${excerpt}, excerpt),
          content_html = COALESCE(${content}, content_html),
          category = COALESCE(${category}, category),
          status = COALESCE(${status}, status),
          updated_at = ${updatedAt}
        WHERE id = ${id} AND organization_id = ${orgId}
        RETURNING *
      `);
    } else {
      result = await db.execute(sql`
        UPDATE website_blog_posts
        SET 
          title = COALESCE(${title}, title),
          excerpt = COALESCE(${excerpt}, excerpt),
          content_html = COALESCE(${content}, content_html),
          category = COALESCE(${category}, category),
          status = COALESCE(${status}, status),
          updated_at = ${updatedAt}
        WHERE id = ${id}
        RETURNING *
      `);
    }

    const updated = result.rows[0];
    res.json(updated);
  } catch (error) {
    logError("Error updating blog post:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to update blog post" });
  }
});

// POST /api/website/blog/posts/:id/publish - Publish a blog post
router.post("/blog/posts/:id/publish", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    
    const existing = await db.query.websiteBlogPosts.findFirst({
      where: and(
        eq(websiteBlogPosts.id, id),
        orgId ? eq(websiteBlogPosts.organizationId, orgId) : undefined
      ),
    });

    if (!existing) {
      return res.status(404).json({ error: "Blog post not found" });
    }

    const [updated] = await db.update(websiteBlogPosts)
      .set({ 
        status: "PUBLISHED", 
        publishedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(websiteBlogPosts.id, id))
      .returning();

    await logUpdate(user.id, "website_blog_posts", id, existing, updated, req);

    res.json(updated);
  } catch (error) {
    logError("Error publishing blog post:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to publish blog post" });
  }
});

// POST /api/website/blog/posts/generate - AI-generate a blog post
router.post("/blog/posts/generate", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { topic, tone, keywords, length } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "Topic is required" });
    }

    let orgDetails = null;
    if (user.organizationId) {
      orgDetails = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
      });
    }

    const prompt = `Write a professional blog post for a ${orgDetails?.tradeType || 'construction'} company about: "${topic}"

Tone: ${tone || 'professional and informative'}
Target length: ${length || 'medium'} (short=300 words, medium=600 words, long=1000+ words)
${keywords?.length ? `Include these keywords naturally: ${keywords.join(', ')}` : ''}

Return a JSON object with:
{
  "title": "Blog post title",
  "excerpt": "2-3 sentence summary for preview",
  "content": "Full blog post content in HTML format with proper headings, paragraphs, and lists",
  "metaTitle": "SEO title (60 chars max)",
  "metaDescription": "SEO description (160 chars max)",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "suggestedTags": ["tag1", "tag2"],
  "suggestedCategory": "category name"
}`;

    const govOrgId = user.organizationId || "system";
    const { result: govResult, blocked, reason } = await governedAiCall({
      orgId: govOrgId,
      userId: user.id,
      actionType: "blog_post_generate",
      inputRefs: { topic, tone, length },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { 
              role: "system", 
              content: "You are a professional content writer specializing in the construction industry. Write engaging, SEO-optimized blog posts." 
            },
            { role: "user", content: prompt },
          ],
          max_completion_tokens: 2500,
          response_format: { type: "json_object" },
        });
        return {
          result: completion.choices[0]?.message?.content,
          completion,
        };
      },
    });

    if (blocked) {
      return res.status(429).json({ error: reason || "AI usage limit reached" });
    }

    const rawContent = govResult;
    if (!rawContent) {
      logError("OpenAI returned empty content");
      return res.status(500).json({ error: "AI returned empty response. Please try again." });
    }

    let content;
    try {
      content = JSON.parse(rawContent);
    } catch (parseError) {
      logError("Failed to parse OpenAI response:", {}, rawContent instanceof Error ? rawContent : new Error(String(rawContent)));
      return res.status(500).json({ error: "Failed to parse AI response. Please try again." });
    }

    if (!content.title || !content.content) {
      logError("OpenAI response missing required fields:", { detail: String(content) });
      return res.status(500).json({ error: "AI response missing required fields. Please try again." });
    }

    res.json({ 
      ...content,
      aiGenerated: true,
      aiPrompt: topic,
    });
  } catch (error: any) {
    logError("Error generating blog post:", {}, error instanceof Error ? error : new Error(String(error)));
    const errorMessage = error?.message?.includes("API key") 
      ? "OpenAI API key not configured" 
      : "Failed to generate blog post. Please try again.";
    res.status(500).json({ error: errorMessage });
  }
});

// POST /api/website/blog/generate-image - AI-generate a featured image for a blog post
router.post("/blog/generate-image", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: "Organization access required" });
    }

    const { title, category } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Blog post title is required" });
    }

    const imagePrompt = `Professional, high-quality construction industry blog header image for an article titled "${title}"${category ? ` in the category "${category}"` : ""}. Modern, clean composition suitable for a professional construction management website. Photorealistic style, well-lit, no text overlays.`;

    const { result: b64Data, blocked: imgBlocked, reason: imgReason } = await governedAiCall({
      orgId,
      userId: user.id,
      actionType: "blog_image_generate",
      inputRefs: { title, category },
      fn: async () => {
        const imageResponse = await openai.images.generate({
          model: "gpt-image-1",
          prompt: imagePrompt,
          n: 1,
          size: "1536x1024",
          quality: "low",
          output_format: "png",
        } as any);
        const model = "dall-e-3";
        const cost = estimateCost(model, 0, 0);
        return {
          result: imageResponse.data?.[0]?.b64_json || null,
          completion: { model, usage: { prompt_tokens: 0, completion_tokens: 0 } },
        };
      },
    });

    if (imgBlocked) {
      return res.status(429).json({ error: imgReason || "AI usage limit reached" });
    }

    if (!b64Data) {
      return res.status(500).json({ error: "Failed to generate image" });
    }

    const imageBuffer = Buffer.from(b64Data, "base64");

    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return res.status(500).json({ error: "Object storage not configured" });
    }

    const basePath = publicPaths[0];
    const uniqueId = randomUUID();
    const fileName = `gallery/${orgId}/${uniqueId}.png`;
    const fullPath = `${basePath}/${fileName}`;
    const pathParts = fullPath.split('/').filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join('/');

    const bucket = objectStorageClient.bucket(bucketName);
    const blob = bucket.file(objectName);

    await blob.save(imageBuffer, {
      metadata: {
        contentType: "image/png",
        metadata: {
          originalName: `ai-generated-${uniqueId}.png`,
        },
      },
    });

    const proxyUrl = `/api/website/image/${orgId}/${uniqueId}.png`;

    res.json({ imageUrl: proxyUrl });
  } catch (error: any) {
    logError("Error generating blog image:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error?.code === "content_policy_violation") {
      return res.status(400).json({ error: "The image could not be generated due to content policy. Try a different title." });
    }
    if (error?.code === "unknown_model" || error?.message?.includes("Unknown model")) {
      return res.status(501).json({ error: "AI image generation model is not available. Please upload an image manually." });
    }
    if (error?.status === 404 || error?.message?.includes("not found") || error?.message?.includes("does not exist")) {
      return res.status(501).json({ error: "AI image generation is not available with your current configuration. Please upload an image manually." });
    }
    res.status(500).json({ error: error?.message || "Failed to generate blog featured image" });
  }
});

// ============================================
// PUBLIC CAREERS PAGE ENDPOINTS
// ============================================

const careersApplicationRateLimit = new Map<string, { count: number; resetAt: number }>();

const careersResumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and Word documents are allowed'));
    }
  },
});

router.get("/public/:subdomain/careers", async (req: Request, res: Response) => {
  try {
    const { subdomain } = req.params;
    if (!subdomain) return res.status(400).json({ error: "Subdomain is required" });

    const website = await db.query.organizationWebsites.findFirst({
      where: and(
        eq(organizationWebsites.subdomain, subdomain),
        eq(organizationWebsites.status, "PUBLISHED")
      ),
    });

    if (!website) return res.status(404).json({ error: "Website not found" });
    if (!website.careersEnabled) return res.status(404).json({ error: "Careers page is not enabled" });

    const orgId = website.organizationId;

    const jobs = await db
      .select({
        id: hiringJobs.id,
        title: hiringJobs.title,
        department: hiringJobs.department,
        trade: hiringJobs.trade,
        employmentType: hiringJobs.employmentType,
        location: hiringJobs.location,
        compensationType: hiringJobs.compensationType,
        compensationMin: hiringJobs.compensationMin,
        compensationMax: hiringJobs.compensationMax,
        description: hiringJobs.description,
        publishedAt: hiringJobs.publishedAt,
      })
      .from(hiringJobs)
      .where(and(
        eq(hiringJobs.organizationId, orgId),
        eq(hiringJobs.status, "PUBLISHED")
      ))
      .orderBy(desc(hiringJobs.publishedAt));

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { name: true },
    });

    res.json({
      jobs,
      organizationName: org?.name || "",
      introText: website.careersIntroText || null,
    });
  } catch (error) {
    logError("Error fetching public careers:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch careers" });
  }
});

router.get("/public/:subdomain/careers/:jobId", async (req: Request, res: Response) => {
  try {
    const { subdomain, jobId } = req.params;
    if (!subdomain || !jobId) return res.status(400).json({ error: "Subdomain and job ID are required" });

    const website = await db.query.organizationWebsites.findFirst({
      where: and(
        eq(organizationWebsites.subdomain, subdomain),
        eq(organizationWebsites.status, "PUBLISHED")
      ),
    });

    if (!website) return res.status(404).json({ error: "Website not found" });
    if (!website.careersEnabled) return res.status(404).json({ error: "Careers page is not enabled" });

    const [job] = await db
      .select()
      .from(hiringJobs)
      .where(and(
        eq(hiringJobs.id, jobId),
        eq(hiringJobs.organizationId, website.organizationId),
        eq(hiringJobs.status, "PUBLISHED")
      ))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found" });

    res.json({
      id: job.id,
      title: job.title,
      department: job.department,
      trade: job.trade,
      employmentType: job.employmentType,
      location: job.location,
      compensationType: job.compensationType,
      compensationMin: job.compensationMin,
      compensationMax: job.compensationMax,
      description: job.description,
      requirements: job.requirements,
      preferredQualifications: job.preferredQualifications,
      certificationsRequired: job.certificationsRequired,
      screeningQuestionsJson: job.screeningQuestionsJson,
      publishedAt: job.publishedAt,
    });
  } catch (error) {
    logError("Error fetching public job detail:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to fetch job details" });
  }
});

router.post("/public/:subdomain/careers/:jobId/apply", careersResumeUpload.single("resume"), async (req: Request, res: Response) => {
  try {
    const { subdomain, jobId } = req.params;
    if (!subdomain || !jobId) return res.status(400).json({ error: "Subdomain and job ID are required" });

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const rateEntry = careersApplicationRateLimit.get(ipAddress);
    if (rateEntry) {
      if (now < rateEntry.resetAt) {
        if (rateEntry.count >= 10) {
          return res.status(429).json({ error: "Too many applications submitted. Please try again later." });
        }
        rateEntry.count++;
      } else {
        careersApplicationRateLimit.set(ipAddress, { count: 1, resetAt: now + 3600000 });
      }
    } else {
      careersApplicationRateLimit.set(ipAddress, { count: 1, resetAt: now + 3600000 });
    }

    if (careersApplicationRateLimit.size > 5000) {
      const keys = Array.from(careersApplicationRateLimit.keys());
      for (const key of keys) {
        const val = careersApplicationRateLimit.get(key);
        if (val && now > val.resetAt) careersApplicationRateLimit.delete(key);
      }
    }

    const { firstName, lastName, email, phone, screeningAnswers } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: "First name, last name, and email are required" });
    }

    if (firstName.length > 100 || lastName.length > 100 || email.length > 255 || (phone && phone.length > 30)) {
      return res.status(400).json({ error: "Field length exceeds maximum allowed" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email address" });
    }

    if (screeningAnswers && screeningAnswers.length > 10000) {
      return res.status(400).json({ error: "Screening answers too long" });
    }

    const website = await db.query.organizationWebsites.findFirst({
      where: and(
        eq(organizationWebsites.subdomain, subdomain),
        eq(organizationWebsites.status, "PUBLISHED")
      ),
    });

    if (!website) return res.status(404).json({ error: "Website not found" });
    if (!website.careersEnabled) return res.status(404).json({ error: "Careers page is not enabled" });

    const orgId = website.organizationId;

    const [job] = await db
      .select()
      .from(hiringJobs)
      .where(and(
        eq(hiringJobs.id, jobId),
        eq(hiringJobs.organizationId, orgId),
        eq(hiringJobs.status, "PUBLISHED")
      ))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found or no longer accepting applications" });

    let resumeStorageKey: string | null = null;
    if (req.file) {
      try {
        const objectStorageService = new ObjectStorageService();
        const privateDir = objectStorageService.getPrivateObjectDir();
        const uniqueId = randomUUID();
        const ext = req.file.originalname.split('.').pop() || 'pdf';
        const fileName = `careers-resumes/${orgId}/${uniqueId}.${ext}`;
        const fullPath = `${privateDir}/${fileName}`;
        const pathParts = fullPath.split('/').filter(p => p.length > 0);
        const bucketName = pathParts[0];
        const objectName = pathParts.slice(1).join('/');
        const bucket = objectStorageClient.bucket(bucketName);
        const blob = bucket.file(objectName);
        await blob.save(req.file.buffer, {
          metadata: {
            contentType: req.file.mimetype,
            metadata: { originalName: req.file.originalname },
          },
        });
        resumeStorageKey = fullPath;
      } catch (uploadErr) {
        logError("Resume upload failed:", {}, uploadErr instanceof Error ? uploadErr : new Error(String(uploadErr)));
        return res.status(500).json({ error: "Failed to upload resume. Please try again." });
      }
    }

    let parsedAnswers: string | null = null;
    if (screeningAnswers) {
      try {
        parsedAnswers = typeof screeningAnswers === 'string' ? screeningAnswers : JSON.stringify(screeningAnswers);
      } catch { logWarn("Non-critical operation failed"); }
    }

    const [candidate] = await db.insert(hiringCandidates).values({
      organizationId: orgId,
      jobId: job.id,
      firstName,
      lastName,
      fullName: `${firstName} ${lastName}`.trim(),
      email,
      phone: phone || null,
      source: "CAREERS_PAGE",
      currentStage: "APPLIED",
      resumeStorageKey,
      applicationAnswersJson: parsedAnswers,
    }).returning();

    const adminUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(
        eq(users.organizationId, orgId),
        sql`${users.role} IN ('ADMIN', 'HUSTLER', 'MANAGER')`
      ));

    for (const admin of adminUsers) {
      try {
        await insertNotification({
          userId: admin.id,
          organizationId: orgId,
          type: "GENERAL",
          title: "New Job Application",
          message: `${firstName} ${lastName} applied for ${job.title} via the careers page.`,
          relatedEntityId: candidate.id,
          relatedEntityType: "hiring_candidate",
        });
      } catch { logWarn("Non-critical operation failed"); }
    }

    res.status(201).json({ success: true, message: "Application submitted successfully" });
  } catch (error) {
    logError("Error submitting job application:", {}, error instanceof Error ? error : new Error(String(error)));
    res.status(500).json({ error: "Failed to submit application" });
  }
});

export default router;
