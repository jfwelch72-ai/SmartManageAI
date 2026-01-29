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
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

const router = express.Router();

// Configure multer for memory storage (for file uploads)
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Only allow images
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Initialize object storage service
const objectStorage = new ObjectStorageService();

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

    const pages = await db.query.organizationWebsitePages.findMany({
      where: orgId ? eq(organizationWebsitePages.organizationId, orgId) : undefined,
      orderBy: [asc(organizationWebsitePages.navigationOrder)],
    });

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

    const { pageType, pageTitle, pageSlug, navigationLabel, showInNavigation, ...rest } = req.body;

    const pageData = {
      ...rest,
      pageType: pageType || "CUSTOM",
      pageTitle: pageTitle || "",
      pageSlug: pageSlug || "",
      navigationLabel: navigationLabel || pageTitle || "",
      showInNavigation: showInNavigation !== undefined ? showInNavigation : true,
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

    const [updated] = await db.update(organizationWebsitePages)
      .set({ ...req.body, updatedAt: new Date() })
      .where(eq(organizationWebsitePages.id, id))
      .returning();

    await logUpdate(user.id, "organization_website_pages", id, existing, updated, req);

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
          content = COALESCE(${content}, content),
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
          content = COALESCE(${content}, content),
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
    if (!orgId && user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "Organization access required" });
    }

    // Generate unique filename with extension
    const ext = file.originalname.split('.').pop() || 'jpg';
    const uniqueId = randomUUID();
    const fileName = `gallery/${orgId}/${uniqueId}.${ext}`;

    // Get public search paths for storage
    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return res.status(500).json({ error: "Object storage not configured" });
    }

    // Use the first public path
    const basePath = publicPaths[0];
    const fullPath = `${basePath}/${fileName}`;

    // Parse path to get bucket and object name
    const pathParts = fullPath.split('/').filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join('/');

    // Upload to object storage
    const bucket = objectStorageClient.bucket(bucketName);
    const blob = bucket.file(objectName);

    await blob.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
      },
    });

    // Generate public URL
    const publicUrl = `https://storage.googleapis.com/${bucketName}/${objectName}`;

    res.json({ 
      url: publicUrl,
      fileName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    });
  } catch (error) {
    console.error("Error uploading image:", error);
    res.status(500).json({ error: "Failed to upload image" });
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

    const { days = 30 } = req.query;

    // Get website
    const website = await db.query.organizationWebsites.findFirst({
      where: orgId ? eq(organizationWebsites.organizationId, orgId) : undefined,
    });

    if (!website) {
      return res.json({ hasData: false });
    }

    // Get daily analytics for the period
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - Number(days));

    const dailyStats = await db.query.websiteAnalyticsDaily.findMany({
      where: and(
        eq(websiteAnalyticsDaily.websiteId, website.id),
        sql`${websiteAnalyticsDaily.date} >= ${startDate.toISOString().split('T')[0]}`
      ),
      orderBy: [asc(websiteAnalyticsDaily.date)],
    });

    // Calculate totals
    const totals = dailyStats.reduce((acc, day) => ({
      pageViews: acc.pageViews + (day.pageViews || 0),
      uniqueVisitors: acc.uniqueVisitors + (day.uniqueVisitors || 0),
      sessions: acc.sessions + (day.sessions || 0),
      contactFormSubmissions: acc.contactFormSubmissions + (day.contactFormSubmissions || 0),
    }), { pageViews: 0, uniqueVisitors: 0, sessions: 0, contactFormSubmissions: 0 });

    res.json({
      hasData: dailyStats.length > 0,
      period: { days: Number(days), startDate },
      totals,
      dailyStats,
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
      .where(eq(websiteContactSubmissions.id, id))
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
      where: eq(websiteContactSubmissions.id, id),
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

    // Set no-cache headers for preview
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });

    res.json({
      website,
      organization: org ? {
        name: org.name,
        tradeType: org.tradeType,
        region: org.region,
        logoUrl: org.logoUrl,
      } : null,
      pages: pages.filter(p => p.showInNavigation),
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

export default router;