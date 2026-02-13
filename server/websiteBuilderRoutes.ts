import express, { Request, Response, NextFunction } from "express";
import { z } from "zod";
import multer from "multer";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, asc, sql, ilike, or } from "drizzle-orm";
import { 
  organizationWebsites, 
  organizationWebsitePages, 
  websiteBlogPosts, 
  websiteBlogComments,
  websiteProjects,
  websiteProjectImages,
  websiteAnalyticsDaily,
  websiteAnalyticsEvents,
  organizationSocialLinks,
  socialPostHistory,
  websiteContactSubmissions,
  organizations,
  users,
  crmOrganisations,
  crmContacts,
  pagePreviewLinks,
  pageVersions,
  insertOrganizationWebsiteSchema,
  insertOrganizationWebsitePageSchema,
  insertWebsiteBlogPostSchema,
  insertWebsiteBlogCommentSchema,
  insertWebsiteProjectSchema,
  insertWebsiteProjectImageSchema,
  insertOrganizationSocialLinksSchema,
  insertSocialPostHistorySchema,
  insertWebsiteContactSubmissionSchema,
  OrganizationWebsite,
  OrganizationWebsitePage,
  WebsiteBlogPost,
  WebsiteProject
} from "@shared/schema";
import { requireAuth, AuthRequest } from "./auth";
import { getOrgIdForFilter, getOrgFilter } from "./orgFilter";
import { logCreate, logUpdate, logDelete } from "./auditLogger";
import { openai } from "./ai/openaiClient";
import { ObjectStorageService, objectStorageClient, ObjectNotFoundError } from "./objectStorage";
// import { requireFeature } from "./middleware/requireFeature"; // Re-enable for production billing

const router = express.Router();

// ==============================================
// In-Memory Presence Store
// ==============================================
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

// Configure multer for memory storage (for file uploads)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'));
    }
  }
});

// Initialize object storage service
const objectStorage = new ObjectStorageService();
const STORAGE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024; // 3GB media library limit

// Helper: Validate organization access
function validateOrgAccess(req: AuthRequest, res: Response): string | null {
  const user = req.user!;
  if (user.role === "SUPER_ADMIN") {
    return null; // SUPER_ADMIN can access all
  }
  if (!user.organizationId) {
    res.status(403).json({ error: "No organization access" });
    return null;
  }
  return user.organizationId;
}

// Helper: Convert org logo GCS URL to the dedicated logo endpoint path
function orgLogoProxyUrl(orgId: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("https://storage.googleapis.com/")) {
    return `/api/website/org-logo/${orgId}`;
  }
  return url;
}

// GET /api/website/org-logo/:orgId - Serve organization logo directly from GCS
// This bypasses the /objects/ proxy which requires file tracking in media/documents tables
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

// NOTE: Feature gate (requireFeature("WEBSITE_SEO")) is temporarily disabled for development/testing.
// Re-enable by adding websiteFeatureGate middleware to all authenticated routes when ready for production billing enforcement.

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

    // Check if website exists
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
      // Generate subdomain from org slug
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

    // Update website status to published
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
// WEBSITE PAGES
// ============================================

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
    console.error("Error fetching pages:", error);
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

    // Get or create website
    let website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    console.log("Creating page with request body:", JSON.stringify(req.body));

    const { pageType, pageTitle, pageSlug, navigationLabel, showInNavigation, parentPageId, ...rest } = req.body;

    // Validate parentPageId if provided
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
    console.error("Error creating page:", error);
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
    console.error("Error fetching page:", error);
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

    // Validate parentPageId if being updated
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
        console.error("Error creating version snapshot on publish:", e);
      }
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating page:", error);
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
    console.error("Error deleting page:", error);
    res.status(500).json({ error: "Failed to delete page" });
  }
});

// ============================================
// AI WEBSITE DESIGN ASSISTANT
// ============================================

// POST /api/website/assistant/ask - General AI conversation
router.post("/assistant/ask", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { message, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Get organization details for context
    let orgDetails = null;
    if (user.organizationId) {
      orgDetails = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
      });
    }

    const systemPrompt = `You are an AI Website Design Assistant for SmartManageAI, a construction management platform.
You help contractors create professional, SEO-optimized websites.

${orgDetails ? `Company Context:
- Company Name: ${orgDetails.name}
- Trade: ${orgDetails.tradeType}
- Region: ${orgDetails.region || 'Not specified'}
` : ''}

Your capabilities:
- Suggest website layouts and color schemes
- Generate page content (home, about, services, etc.)
- Write SEO-optimized text
- Create service descriptions from scope of work
- Generate blog post ideas and content
- Provide branding recommendations

Be helpful, professional, and focused on helping contractors present themselves well online.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
      max_tokens: 1500,
    });

    const aiResponse = response.choices[0]?.message?.content || "I couldn't generate a response.";

    res.json({ 
      response: aiResponse,
      usage: response.usage,
    });
  } catch (error) {
    console.error("Error in AI assistant:", error);
    res.status(500).json({ error: "AI assistant unavailable" });
  }
});

// POST /api/website/assistant/generate-page - Generate a complete page
router.post("/assistant/generate-page", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { pageType, context } = req.body;

    if (!pageType) {
      return res.status(400).json({ error: "Page type is required" });
    }

    // Get organization details
    let orgDetails = null;
    if (user.organizationId) {
      orgDetails = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
      });
    }

    const pagePrompts: Record<string, string> = {
      HOME: `Create a compelling home page for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".
Include: Hero section with headline and CTA, key services overview, why choose us section, testimonials placeholder, contact CTA.`,
      ABOUT: `Create an About Us page for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".
Include: Company story, mission statement, values, team section, certifications/licenses, service area.`,
      SERVICES: `Create a Services page for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".
Include: Overview of main services, detailed service descriptions, process/approach, pricing guidance, CTA.`,
      SAFETY: `Create a Safety page for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".
Include: Safety commitment statement, safety certifications, training programs, safety record highlights, OSHA compliance.`,
      CONTACT: `Create a Contact page for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".
Include: Contact form, phone/email info, office hours, service area map placeholder, quick quote request.`,
    };

    const prompt = pagePrompts[pageType] || `Create a ${pageType} page for a construction company.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: `You are a professional website content writer specializing in construction companies.
Generate content in JSON format with sections that can be rendered as website blocks.

Return a JSON object with:
{
  "heroTitle": "Main headline",
  "heroSubtitle": "Supporting text",
  "sections": [
    {
      "type": "text|services|features|cta|testimonials",
      "title": "Section title",
      "content": "Section content or array of items"
    }
  ],
  "metaTitle": "SEO title (60 chars max)",
  "metaDescription": "SEO description (160 chars max)",
  "keywords": ["keyword1", "keyword2"]
}` 
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    const content = JSON.parse(response.choices[0]?.message?.content || "{}");

    res.json({ 
      pageType,
      content,
      aiGenerated: true,
    });
  } catch (error) {
    console.error("Error generating page:", error);
    res.status(500).json({ error: "Failed to generate page content" });
  }
});

// POST /api/website/assistant/suggest-colors - AI color scheme suggestions
router.post("/assistant/suggest-colors", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { logoUrl, industry, mood } = req.body;

    const prompt = `Suggest a professional color scheme for a ${industry || 'construction'} company website.
Mood: ${mood || 'professional and trustworthy'}
${logoUrl ? `The logo is at: ${logoUrl}` : ''}

Return a JSON object with:
{
  "primaryColor": "#hex",
  "secondaryColor": "#hex", 
  "accentColor": "#hex",
  "backgroundColor": "#hex",
  "textColor": "#hex",
  "reasoning": "Brief explanation of why these colors work"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a professional brand designer specializing in construction company branding." },
        { role: "user", content: prompt },
      ],
      max_tokens: 500,
      response_format: { type: "json_object" },
    });

    const colors = JSON.parse(response.choices[0]?.message?.content || "{}");

    res.json(colors);
  } catch (error) {
    console.error("Error suggesting colors:", error);
    res.status(500).json({ error: "Failed to suggest colors" });
  }
});

// ============================================
// BLOG SYSTEM
// ============================================

// GET /api/website/blog/posts - List blog posts
router.get("/blog/posts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const { status } = req.query;

    // Use raw SQL to avoid Drizzle ORM schema mismatch issues
    let query;
    // Handle SUPER_ADMIN case (no org filter) vs regular user (org filter)
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
      // SUPER_ADMIN: return all posts
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
    console.error("Error fetching blog posts:", error);
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

    // Get website
    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    // Generate slug from title
    const slug = req.body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Extract fields from request body
    const { title, excerpt, content, contentHtml, contentJson, category, tags, 
            featuredImageUrl, coverImageUrl, metaTitle, metaDescription, 
            keywords, aiGenerated, aiPrompt } = req.body;
    
    const authorName = `${user.firstName} ${user.lastName}`;

    // Use raw SQL to avoid Drizzle ORM schema mismatch issues
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
    console.error("Error creating blog post:", error);
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
    console.error("Error fetching blog post:", error);
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

    // Use raw SQL to check existing and avoid Drizzle ORM schema mismatch
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

    // Build update query with raw SQL - include org scoping for security
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
      // SUPER_ADMIN case - no org filter
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
    console.error("Error updating blog post:", error);
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
    
    // Verify post belongs to user's organization
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
    console.error("Error publishing blog post:", error);
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

    // Get organization details
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: "You are a professional content writer specializing in the construction industry. Write engaging, SEO-optimized blog posts." 
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 2500,
      response_format: { type: "json_object" },
    });

    const rawContent = response.choices[0]?.message?.content;
    if (!rawContent) {
      console.error("OpenAI returned empty content");
      return res.status(500).json({ error: "AI returned empty response. Please try again." });
    }

    let content;
    try {
      content = JSON.parse(rawContent);
    } catch (parseError) {
      console.error("Failed to parse OpenAI response:", rawContent);
      return res.status(500).json({ error: "Failed to parse AI response. Please try again." });
    }

    if (!content.title || !content.content) {
      console.error("OpenAI response missing required fields:", content);
      return res.status(500).json({ error: "AI response missing required fields. Please try again." });
    }

    res.json({ 
      ...content,
      aiGenerated: true,
      aiPrompt: topic,
    });
  } catch (error: any) {
    console.error("Error generating blog post:", error);
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

    const imageResponse = await openai.images.generate({
      model: "gpt-image-1",
      prompt: imagePrompt,
      n: 1,
      size: "1536x1024",
      quality: "low",
      output_format: "png",
    } as any);

    const b64Data = imageResponse.data?.[0]?.b64_json;
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
    console.error("Error generating blog image:", error);
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
// PROJECT GALLERY
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

    // Parse path to get bucket and object name
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
    console.error("Error uploading image:", error);
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
    console.error("Error serving website image:", error);
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
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
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
          createdAt: metadata.timeCreated || new Date().toISOString(),
          updatedAt: metadata.updated || new Date().toISOString(),
        };
      })
    );

    files.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ files, totalSize, storageLimit: STORAGE_LIMIT_BYTES });
  } catch (error) {
    console.error("Error listing media files:", error);
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
    console.error("Error deleting media file:", error);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// GET /api/website/projects - List gallery projects
router.get("/projects", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    // Use raw SQL to avoid Drizzle ORM schema mismatch issues
    // Handle SUPER_ADMIN case (no org filter) vs regular user (org filter)
    let result;
    if (orgId) {
      result = await db.execute(sql`
        SELECT * FROM website_projects 
        WHERE organization_id = ${orgId}
        ORDER BY created_at DESC
      `);
    } else {
      // SUPER_ADMIN: return all projects
      result = await db.execute(sql`
        SELECT * FROM website_projects 
        ORDER BY created_at DESC
      `);
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching gallery projects:", error);
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

    // Get website
    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      return res.status(400).json({ error: "Please set up your website first" });
    }

    // Generate slug
    const slug = req.body.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    // Use raw SQL insert to avoid Drizzle ORM schema mismatch issues
    // The DB has columns that differ from the Drizzle schema definition
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
    console.error("Error creating gallery project:", error);
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

    // Get project images
    const images = await db.query.websiteProjectImages.findMany({
      where: eq(websiteProjectImages.projectId, id),
      orderBy: [asc(websiteProjectImages.displayOrder)],
    });

    res.json({ ...project, images });
  } catch (error) {
    console.error("Error fetching gallery project:", error);
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
    
    // Use raw SQL to check existing and avoid Drizzle ORM schema mismatch
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

    // Build update query with raw SQL - include org scoping for security
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
      // SUPER_ADMIN case - no org filter
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
    console.error("Error updating gallery project:", error);
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
    
    // Verify project belongs to user's organization
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
    console.error("Error adding project image:", error);
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a professional construction project portfolio writer." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const content = JSON.parse(response.choices[0]?.message?.content || "{}");

    res.json(content);
  } catch (error) {
    console.error("Error generating project description:", error);
    res.status(500).json({ error: "Failed to generate description" });
  }
});

// ============================================
// SOCIAL MEDIA
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
    console.error("Error fetching social links:", error);
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

    // Check if links exist
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
    console.error("Error saving social links:", error);
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

    // Get organization details
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: "You are a social media marketing expert for the construction industry." 
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const postContent = JSON.parse(response.choices[0]?.message?.content || "{}");

    // Save to history using raw SQL to avoid schema mismatch
    if (user.organizationId) {
      const hashtagsArray = postContent.hashtags || [];
      // Convert array to PostgreSQL text[] format
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
    console.error("Error generating social post:", error);
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
    console.error("Error fetching social history:", error);
    res.status(500).json({ error: "Failed to fetch social history" });
  }
});

// ============================================
// SEO OPTIMIZATION
// ============================================

// POST /api/website/seo/scan - Scan website for SEO issues
router.post("/seo/scan", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const orgId = user.organizationId;

    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    // Get all pages
    const pages = await db.query.organizationWebsitePages.findMany({
      where: eq(organizationWebsitePages.organizationId, orgId!),
    });

    // Analyze each page
    const issues: Array<{ page: string; issues: string[]; score: number }> = [];

    for (const page of pages) {
      const pageIssues: string[] = [];
      let score = 100;

      // Check meta title
      if (!page.metaTitle) {
        pageIssues.push("Missing meta title");
        score -= 15;
      } else if (page.metaTitle.length < 30) {
        pageIssues.push("Meta title too short (should be 50-60 characters)");
        score -= 5;
      } else if (page.metaTitle.length > 60) {
        pageIssues.push("Meta title too long (should be 50-60 characters)");
        score -= 5;
      }

      // Check meta description
      if (!page.metaDescription) {
        pageIssues.push("Missing meta description");
        score -= 15;
      } else if (page.metaDescription.length < 120) {
        pageIssues.push("Meta description too short (should be 150-160 characters)");
        score -= 5;
      } else if (page.metaDescription.length > 160) {
        pageIssues.push("Meta description too long (should be 150-160 characters)");
        score -= 5;
      }

      // Check keywords
      if (!page.keywords || page.keywords.length === 0) {
        pageIssues.push("No keywords defined");
        score -= 10;
      }

      // Check rich schema
      if (!page.richSchemaJson) {
        pageIssues.push("Missing structured data (JSON-LD schema)");
        score -= 10;
      }

      // Check content
      if (!page.contentJson) {
        pageIssues.push("Page has no content");
        score -= 20;
      }

      issues.push({
        page: page.pageSlug,
        issues: pageIssues,
        score: Math.max(0, score),
      });
    }

    const overallScore = issues.length > 0 
      ? Math.round(issues.reduce((sum, p) => sum + p.score, 0) / issues.length)
      : 0;

    res.json({
      overallScore,
      pagesAnalyzed: pages.length,
      pages: issues,
    });
  } catch (error) {
    console.error("Error scanning SEO:", error);
    res.status(500).json({ error: "Failed to scan SEO" });
  }
});

// POST /api/website/seo/optimize/:pageId - AI optimize page SEO
router.post("/seo/optimize/:pageId", requireAuth, async (req: AuthRequest, res: Response) => {
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

    if (!page) {
      return res.status(404).json({ error: "Page not found" });
    }

    // Get organization for context
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, page.organizationId),
    });

    const prompt = `Optimize SEO for this ${page.pageType} page:
Title: ${page.pageTitle}
Current Meta Title: ${page.metaTitle || 'None'}
Current Meta Description: ${page.metaDescription || 'None'}
Current Keywords: ${page.keywords?.join(', ') || 'None'}

Company: ${org?.name || 'Construction Company'}
Trade: ${org?.tradeType || 'General Contractor'}
Location: ${org?.city ? `${org.city}, ${org.state}` : 'Not specified'}

Generate optimized SEO content. Return JSON:
{
  "metaTitle": "Optimized title (50-60 chars)",
  "metaDescription": "Optimized description (150-160 chars)",
  "keywords": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5"],
  "richSchema": { JSON-LD schema object appropriate for page type },
  "suggestions": ["Additional SEO improvement suggestion 1", "suggestion 2"]
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an SEO expert specializing in local business and construction company websites." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
      response_format: { type: "json_object" },
    });

    const seoContent = JSON.parse(response.choices[0]?.message?.content || "{}");

    res.json(seoContent);
  } catch (error) {
    console.error("Error optimizing SEO:", error);
    res.status(500).json({ error: "Failed to optimize SEO" });
  }
});

// ============================================
// ANALYTICS
// ============================================

// POST /api/website/analytics/track - Track event (public, used by tracking pixel)
router.post("/analytics/track", async (req: Request, res: Response) => {
  try {
    const { websiteId, sessionId, visitorId, eventType, pagePath, pageTitle, referrer, eventData } = req.body;

    if (!websiteId || !sessionId || !eventType) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get client info
    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    await db.insert(websiteAnalyticsEvents).values({
      websiteId,
      sessionId,
      visitorId,
      eventType,
      pagePath,
      pageTitle,
      referrer,
      eventDataJson: eventData ? JSON.stringify(eventData) : null,
      ipAddress,
      userAgent,
      utmSource: req.body.utm_source,
      utmMedium: req.body.utm_medium,
      utmCampaign: req.body.utm_campaign,
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Error tracking event:", error);
    res.status(500).json({ error: "Failed to track event" });
  }
});

// GET /api/website/analytics/summary - Get analytics summary
router.get("/analytics/summary", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = validateOrgAccess(req, res);
    if (orgId === null && req.user?.role !== "SUPER_ADMIN") return;

    const days = Number(req.query.days) || 30;

    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.json({ hasData: false, period: { days, startDate: new Date().toISOString() }, totals: { pageViews: 0, uniqueVisitors: 0, sessions: 0, contactFormSubmissions: 0 }, dailyStats: [], topPages: [], referrers: [] });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateStr = startDate.toISOString();

    const totalsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'PAGE_VIEW') AS page_views,
        COUNT(DISTINCT visitor_id) AS unique_visitors,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) FILTER (WHERE event_type = 'FORM_SUBMIT') AS contact_form_submissions
      FROM website_analytics_events
      WHERE website_id = ${website.id}
        AND created_at >= ${startDateStr}::timestamp
    `);

    const row = totalsResult.rows[0] || {};
    const totals = {
      pageViews: Number(row.page_views) || 0,
      uniqueVisitors: Number(row.unique_visitors) || 0,
      sessions: Number(row.sessions) || 0,
      contactFormSubmissions: Number(row.contact_form_submissions) || 0,
    };

    const dailyResult = await db.execute(sql`
      SELECT
        created_at::date AS date,
        COUNT(*) FILTER (WHERE event_type = 'PAGE_VIEW') AS page_views,
        COUNT(DISTINCT visitor_id) AS unique_visitors
      FROM website_analytics_events
      WHERE website_id = ${website.id}
        AND created_at >= ${startDateStr}::timestamp
      GROUP BY created_at::date
      ORDER BY created_at::date ASC
    `);

    const dailyStats = dailyResult.rows.map((r: any) => ({
      date: r.date,
      pageViews: Number(r.page_views) || 0,
      uniqueVisitors: Number(r.unique_visitors) || 0,
    }));

    const topPagesResult = await db.execute(sql`
      SELECT page_path AS path, COUNT(*) AS count
      FROM website_analytics_events
      WHERE website_id = ${website.id}
        AND created_at >= ${startDateStr}::timestamp
        AND event_type = 'PAGE_VIEW'
        AND page_path IS NOT NULL
      GROUP BY page_path
      ORDER BY count DESC
      LIMIT 10
    `);

    const topPages = topPagesResult.rows.map((r: any) => ({
      path: r.path,
      count: Number(r.count) || 0,
    }));

    const referrersResult = await db.execute(sql`
      SELECT referrer, COUNT(*) AS count
      FROM website_analytics_events
      WHERE website_id = ${website.id}
        AND created_at >= ${startDateStr}::timestamp
        AND referrer IS NOT NULL
        AND referrer != ''
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 10
    `);

    const referrers = referrersResult.rows.map((r: any) => ({
      referrer: r.referrer,
      count: Number(r.count) || 0,
    }));

    const hasData = totals.pageViews > 0 || totals.sessions > 0;

    res.json({
      hasData,
      period: { days, startDate: startDate.toISOString() },
      totals,
      dailyStats,
      topPages,
      referrers,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ============================================
// CONTACT FORM SUBMISSIONS
// ============================================

// POST /api/website/contact - Submit contact form (public)
router.post("/contact", async (req: Request, res: Response) => {
  try {
    const { websiteId, name, email, phone, company, subject, message, serviceInterest, projectType, estimatedBudget } = req.body;

    if (!websiteId || !name || !email || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get website and organization
    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.id, websiteId),
    });

    if (!website) {
      return res.status(404).json({ error: "Website not found" });
    }

    const ipAddress = req.headers['x-forwarded-for'] as string || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const [submission] = await db.insert(websiteContactSubmissions).values({
      websiteId,
      organizationId: website.organizationId,
      name,
      email,
      phone,
      company,
      subject,
      message,
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

    res.json({ success: true, id: submission.id });
  } catch (error) {
    console.error("Error submitting contact form:", error);
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
    console.error("Error fetching submissions:", error);
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
    console.error("Error updating submission:", error);
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

    // Create CRM organization if company provided
    let crmOrgId: string | null = null;
    if (submission.company) {
      const [crmOrg] = await db.insert(crmOrganisations).values({
        organizationId: orgId,
        name: submission.company,
        type: "CONTRACTOR",
      }).returning();
      crmOrgId = crmOrg.id;
    }

    // Create CRM contact - organisationId is required, so only create if we have an org
    if (!crmOrgId) {
      // If no company provided, create a placeholder CRM org first
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

    // Update submission
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
    console.error("Error converting to CRM:", error);
    res.status(500).json({ error: "Failed to convert to CRM" });
  }
});

// ============================================
// WEBSITE PREVIEW
// ============================================

// GET /api/website/public/:subdomain - Get public website data by subdomain (no auth required)
router.get("/public/:subdomain", async (req: Request, res: Response) => {
  try {
    const { subdomain } = req.params;

    if (!subdomain) {
      return res.status(400).json({ error: "Subdomain is required" });
    }

    // Get website by subdomain - only return published websites
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

    // Get organization info for branding
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    // Get only published pages for rendering content
    const allPages = await db.query.organizationWebsitePages.findMany({
      where: and(
        eq(organizationWebsitePages.organizationId, orgId),
        eq(organizationWebsitePages.isPublished, true)
      ),
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    // Get published blog posts using raw SQL to avoid schema mismatch
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

    // Get featured projects using raw SQL to avoid schema mismatch
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

    // Get social links
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
    });
  } catch (error) {
    console.error("Error fetching public website:", error);
    res.status(500).json({ error: "Failed to fetch website" });
  }
});

// GET /api/website/preview - Get all data needed for website preview
router.get("/preview", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    
    // Restrict to ADMIN and SUPER_ADMIN only
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    // Get organization ID - SUPER_ADMIN must have an organization context
    const orgId = user.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "Organization context required for preview" });
    }

    // Get website settings
    const website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId),
    });

    if (!website) {
      return res.status(404).json({ error: "Website not configured" });
    }

    // Get organization info for branding
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    // Get pages
    const pages = await db.query.organizationWebsitePages.findMany({
      where: eq(organizationWebsitePages.organizationId, orgId),
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

    // Get published blog posts using raw SQL to avoid schema mismatch
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

    // Get featured projects using raw SQL to avoid schema mismatch
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

    // Get social links
    const socialLinks = await db.query.organizationSocialLinks.findFirst({
      where: eq(organizationSocialLinks.organizationId, orgId),
    });

    // Set no-cache headers for preview
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
    console.error("Error updating presence:", error);
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
    console.error("Error checking conflict:", error);
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
    console.error("Error computing version diff:", error);
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
    console.error("Error creating preview link:", error);
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
    console.error("Error listing preview links:", error);
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
    console.error("Error revoking preview link:", error);
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
    console.error("Error fetching shared preview:", error);
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
    console.error("Error creating version:", error);
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
    console.error("Error listing versions:", error);
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
    console.error("Error fetching version:", error);
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
      } catch {}
    }

    const [updated] = await db.update(organizationWebsitePages)
      .set(settingsToRestore)
      .where(eq(organizationWebsitePages.id, pageId))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error reverting version:", error);
    res.status(500).json({ error: "Failed to revert to version" });
  }
});

// ============================================
// AI WEBSITE WIZARD
// ============================================

const AI_WIZARD_DEFAULT_STYLES = {
  typography: { fontFamily: "inherit", fontSize: "base", fontWeight: "normal", color: "", lineHeight: "normal" },
  spacing: { paddingTop: "8", paddingBottom: "8", paddingLeft: "4", paddingRight: "4", marginTop: "0", marginBottom: "0" },
  background: { type: "none", color: "", gradientFrom: "", gradientTo: "", gradientDirection: "to-b", imageUrl: "", videoUrl: "", imagePosition: "center", imageSize: "cover", imageAttachment: "scroll", imageRepeat: "no-repeat" },
  alignment: "center",
};

const AI_WIZARD_LABELS: Record<string, string> = {
  banner: "Banner Section", hero: "Hero Section", content: "Content Section",
  form: "Form", grid: "Grid & Layout", cta: "Call to Action",
  testimonial: "Testimonials", feature_highlight: "Feature Highlights",
  gallery: "Gallery", stats: "Stats / KPIs", faq: "FAQ Section",
  certifications: "Certifications", about_company: "About Company",
  equipment: "Equipment", safety: "Safety & Compliance", team: "Team Members",
  logo_showcase: "Logo Showcase", blog_section: "Blog Section",
};

router.post("/ai-wizard", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const orgId = user.organizationId;
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    const {
      companyName, industry, services, companyDescription, goals,
      contactEmail, contactPhone, contactAddress,
      stylePreference, colorPreference,
    } = req.body;

    if (!companyName || !industry || !services || !companyDescription || !goals) {
      return res.status(400).json({ error: "Missing required fields: companyName, industry, services, companyDescription, goals" });
    }

    let website = await db.query.organizationWebsites.findFirst({
      where: eq(organizationWebsites.organizationId, orgId!),
    });

    if (!website) {
      const org = await db.query.organizations.findFirst({
        where: eq(organizations.id, orgId!),
      });
      const subdomain = org?.slug || `org-${Date.now()}`;
      const [created] = await db.insert(organizationWebsites)
        .values({
          organizationId: orgId!,
          subdomain,
          siteTitle: companyName,
          siteTagline: companyDescription.substring(0, 200),
          primaryColor: "#2563eb",
          secondaryColor: "#1e40af",
          accentColor: "#f59e0b",
          fontFamily: "Inter",
          status: "DRAFT",
        })
        .returning();
      website = created;
      await logCreate(user.id, "organization_websites", website.id, { subdomain, siteTitle: companyName }, req);
    }

    const systemPrompt = `You are a professional website architect for construction and trade companies. Generate ONLY valid JSON with no explanations, markdown, or code fences.

The user will provide company details. You must return a JSON object with this exact structure:
{
  "siteSettings": {
    "siteTitle": "string",
    "siteTagline": "string",
    "primaryColor": "#hex",
    "secondaryColor": "#hex",
    "accentColor": "#hex",
    "fontFamily": "Inter"
  },
  "pages": [
    {
      "pageType": "HOME" or "CUSTOM",
      "pageSlug": "string",
      "pageTitle": "string",
      "navigationLabel": "string",
      "showInNavigation": true,
      "navigationOrder": 0,
      "metaTitle": "string (60 chars max)",
      "metaDescription": "string (160 chars max)",
      "components": [
        { "type": "component_type", "config": { ... } }
      ]
    }
  ]
}

Available component types and their EXACT config schemas:

1. "hero": { "title": "string", "subtitle": "string", "content": "string", "imageEnabled": true, "imageUrl": "", "imagePosition": "right", "buttons": [{"text": "string", "url": "string", "variant": "default"|"outline"}] }

2. "banner": { "title": "string", "content": "string", "buttons": [{"text": "string", "url": "string", "variant": "default"|"outline"}], "sideImageEnabled": false, "sideImageUrl": "" }

3. "content": { "title": "string", "content": "string" }

4. "form": { "title": "string", "submitButtonText": "string", "fields": [{"id": "string", "label": "string", "type": "text"|"email"|"phone"|"number"|"textarea"|"select", "placeholder": "string", "required": true|false}] }

5. "grid": { "columns": 3, "title": "string", "items": [{"id": "string", "title": "string", "content": "string", "icon": "string", "imageUrl": "", "buttonText": "string", "buttonUrl": "string"}] }

6. "cta": { "title": "string", "content": "string", "buttons": [{"text": "string", "url": "string", "variant": "default"|"outline"}] }

7. "testimonial": { "layout": "grid", "columns": 3, "title": "string", "items": [{"id": "string", "name": "string", "role": "string", "quote": "string", "imageEnabled": false, "imageUrl": ""}] }

8. "feature_highlight": { "columns": 3, "title": "string", "items": [{"id": "string", "title": "string", "description": "string", "icon": "string"}] }
   Valid icons: "star", "zap", "headphones", "shield", "award", "target", "check-circle", "truck", "hard-hat", "wrench", "clock", "users"

9. "stats": { "columns": 4, "title": "string", "items": [{"id": "string", "value": "string", "label": "string", "prefix": "string", "suffix": "string"}] }

10. "faq": { "title": "string", "items": [{"id": "string", "question": "string", "answer": "string"}] }

11. "certifications": { "title": "string", "columns": 4, "items": [{"id": "string", "logoUrl": "", "label": "string"}] }

12. "about_company": { "title": "string", "overview": "string", "yearsExperience": "string", "mission": "string", "vision": "string", "teamPhotoUrl": "" }

13. "equipment": { "title": "string", "columns": 3, "items": [{"id": "string", "imageUrl": "", "model": "string", "description": "string"}] }

14. "safety": { "title": "string", "safetyPolicy": "string", "stats": [{"id": "string", "value": "string", "label": "string"}], "badges": [{"id": "string", "imageUrl": "", "label": "string"}] }

15. "team": { "title": "string", "columns": 3, "items": [{"id": "string", "photoUrl": "", "name": "string", "role": "string", "bio": "string"}] }

16. "logo_showcase": { "title": "string", "items": [{"id": "string", "imageUrl": "", "altText": "string"}], "desktopColumns": 5, "tabletColumns": 3, "mobileColumns": 2, "continuousSlide": false, "slideSpeed": 30 }

17. "blog_section": { "title": "string", "source": "latest", "sortOrder": "latest", "layoutStyle": "grid", "desktopItems": 3, "tabletItems": 2, "mobileItems": 1, "showExcerpt": true, "showAuthor": true, "showDate": true, "showCategory": true, "showCoverImage": true, "readMoreText": "Read More" }

GUARDRAILS:
- Max 7 components per page.
- Homepage MUST include: hero, feature_highlight or grid (for services), stats, cta, testimonial.
- If goal includes "lead_generation", MUST include a form component on relevant pages.
- If industry is construction-related, include certifications, safety, equipment, team components where appropriate. Do NOT use "gallery" type - use a "grid" component for showcasing projects instead.
- Mobile-first: max 3 columns in grids, clear CTA buttons.
- Generate realistic, professional content with real-sounding service descriptions and stats.
- All items need unique IDs using patterns like "g1", "g2", "fh1", "fh2", "t1", "t2", "s1", "s2", etc.

PAGE GENERATION RULES:
- ALWAYS generate: Home, About, Services, Contact pages.
- For construction companies, also generate a Projects/Gallery page.
- Keep navigation simple (4-6 pages max).
- Home page should have the most components (5-7).
- Other pages should have 2-5 components.
- Contact page MUST have a form component.
- Home page uses pageType "HOME", all others use "CUSTOM".

COLOR RULES:
- Choose colors that match the style and color preferences provided.
- primaryColor should be the main brand color.
- secondaryColor should complement the primary.
- accentColor should provide contrast for CTAs and highlights.`;

    const userPrompt = `Generate a complete website for:
Company Name: ${companyName}
Industry: ${industry}
Services: ${services}
Description: ${companyDescription}
Goals: ${goals}
${contactEmail ? `Email: ${contactEmail}` : ""}
${contactPhone ? `Phone: ${contactPhone}` : ""}
${contactAddress ? `Address: ${contactAddress}` : ""}
${stylePreference ? `Style Preference: ${stylePreference}` : ""}
${colorPreference ? `Color Preference: ${colorPreference}` : ""}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 8000,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: "AI did not return a response" });
    }

    let aiResult: any;
    try {
      aiResult = JSON.parse(content);
    } catch (parseErr) {
      console.error("Failed to parse AI wizard response:", parseErr);
      return res.status(500).json({ error: "AI returned invalid JSON" });
    }

    const { siteSettings, pages: aiPages } = aiResult;

    if (!siteSettings || !aiPages || !Array.isArray(aiPages)) {
      return res.status(500).json({ error: "AI returned an incomplete response" });
    }

    await db.update(organizationWebsites).set({
      siteTitle: siteSettings.siteTitle || companyName,
      siteTagline: siteSettings.siteTagline || "",
      primaryColor: siteSettings.primaryColor || "#2563eb",
      secondaryColor: siteSettings.secondaryColor || "#1e40af",
      accentColor: siteSettings.accentColor || "#f59e0b",
      fontFamily: siteSettings.fontFamily || "Inter",
      updatedAt: new Date(),
    }).where(eq(organizationWebsites.id, website.id));

    const resultPages: any[] = [];
    const baseTs = Date.now();

    for (const aiPage of aiPages) {
      const components = (aiPage.components || []).map((comp: any, idx: number) => ({
        id: `body-${comp.type}-${baseTs + idx}`,
        label: AI_WIZARD_LABELS[comp.type] || comp.type,
        enabled: true,
        visibleDesktop: true,
        visibleMobile: true,
        order: idx,
        styles: { ...AI_WIZARD_DEFAULT_STYLES },
        type: comp.type,
        config: comp.config,
      }));

      const contentJson = JSON.stringify({ components });

      const existingPage = await db.query.organizationWebsitePages.findFirst({
        where: and(
          eq(organizationWebsitePages.organizationId, orgId!),
          eq(organizationWebsitePages.pageSlug, aiPage.pageSlug)
        ),
      });

      if (existingPage) {
        const [updated] = await db.update(organizationWebsitePages)
          .set({
            contentJson,
            pageTitle: aiPage.pageTitle,
            navigationLabel: aiPage.navigationLabel,
            showInNavigation: aiPage.showInNavigation ?? true,
            navigationOrder: aiPage.navigationOrder ?? 0,
            metaTitle: aiPage.metaTitle || "",
            metaDescription: aiPage.metaDescription || "",
            updatedAt: new Date(),
          })
          .where(eq(organizationWebsitePages.id, existingPage.id))
          .returning();
        resultPages.push(updated);
      } else {
        const slugToPageType: Record<string, string> = {
          home: "HOME", about: "ABOUT", services: "SERVICES", contact: "CONTACT",
        };
        const resolvedPageType = slugToPageType[aiPage.pageSlug] || "CUSTOM";

        const [created] = await db.insert(organizationWebsitePages)
          .values({
            websiteId: website.id,
            organizationId: orgId!,
            pageType: resolvedPageType as any,
            pageSlug: aiPage.pageSlug,
            pageTitle: aiPage.pageTitle,
            navigationLabel: aiPage.navigationLabel,
            showInNavigation: aiPage.showInNavigation ?? true,
            navigationOrder: aiPage.navigationOrder ?? 0,
            metaTitle: aiPage.metaTitle || "",
            metaDescription: aiPage.metaDescription || "",
            contentJson,
            isPublished: true,
          })
          .returning();
        resultPages.push(created);
      }
    }

    res.json({
      success: true,
      pages: resultPages,
      siteSettings: {
        siteTitle: siteSettings.siteTitle,
        siteTagline: siteSettings.siteTagline,
        primaryColor: siteSettings.primaryColor,
        secondaryColor: siteSettings.secondaryColor,
        accentColor: siteSettings.accentColor,
        fontFamily: siteSettings.fontFamily,
      },
    });
  } catch (error) {
    console.error("Error in AI website wizard:", error);
    res.status(500).json({ error: "AI website wizard failed. Please try again." });
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

export default router;