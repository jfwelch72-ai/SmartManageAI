import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  organizationWebsitePages,
  organizationWebsites,
  organizations,
  websiteAnalyticsEvents,
} from "@shared/schema";
import { requireAuth, AuthRequest } from "./auth";
import { logCreate } from "./auditLogger";
import { openai } from "./ai/openaiClient";

const router = express.Router();

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
Include: Safety commitment, certifications, training programs, safety statistics, incident reporting.`,
      CONTACT: `Create a Contact page for a ${orgDetails?.tradeType || 'construction'} company called "${orgDetails?.name || 'Our Company'}".
Include: Contact form, phone/email, business hours, service area map, FAQ.`,
    };

    const prompt = pagePrompts[pageType] || `Create a ${pageType} page for a construction company.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { 
          role: "system", 
          content: `You are a professional web designer. Generate complete page content as JSON with this structure:
{
  "pageTitle": "Page Title",
  "metaTitle": "SEO Title (60 chars max)",
  "metaDescription": "SEO Description (160 chars max)",
  "keywords": ["keyword1", "keyword2"],
  "sections": [
    {
      "type": "hero|text|features|testimonials|cta|contact|gallery|stats",
      "heading": "Section Heading",
      "content": "Section content in HTML",
      "items": [{"title": "...", "description": "...", "icon": "..."}]
    }
  ]
}`
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 3000,
      response_format: { type: "json_object" },
    });

    const pageContent = JSON.parse(response.choices[0]?.message?.content || "{}");

    res.json(pageContent);
  } catch (error) {
    console.error("Error generating page:", error);
    res.status(500).json({ error: "Failed to generate page content" });
  }
});

// POST /api/website/assistant/suggest-colors - AI suggest brand colors
router.post("/assistant/suggest-colors", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!["ADMIN", "SUPER_ADMIN"].includes(user.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    
    const { tradeType, style, currentColors } = req.body;

    let orgDetails = null;
    if (user.organizationId) {
      orgDetails = await db.query.organizations.findFirst({
        where: eq(organizations.id, user.organizationId),
      });
    }

    const prompt = `Suggest a professional color palette for a ${orgDetails?.tradeType || tradeType || 'construction'} company website.
Style preference: ${style || 'modern and professional'}
${currentColors ? `Current colors: ${JSON.stringify(currentColors)}` : ''}

Return a JSON object with 3 color scheme options:
{
  "schemes": [
    {
      "name": "Scheme name",
      "primary": "#hex",
      "secondary": "#hex", 
      "accent": "#hex",
      "background": "#hex",
      "textColor": "#hex",
      "reasoning": "Brief explanation of why these colors work"
    }
  ]
}

Consider:
- Construction industry conventions (trust, safety, professionalism)
- Color psychology for the specific trade
- Accessibility (sufficient contrast)
- Modern web design trends`;

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

    const pages = await db.query.organizationWebsitePages.findMany({
      where: eq(organizationWebsitePages.organizationId, orgId!),
    });

    const issues: Array<{ page: string; issues: string[]; score: number }> = [];

    for (const page of pages) {
      const pageIssues: string[] = [];
      let score = 100;

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

      if (!page.keywords || page.keywords.length === 0) {
        pageIssues.push("No keywords defined");
        score -= 10;
      }

      if (!page.richSchemaJson) {
        pageIssues.push("Missing structured data (JSON-LD schema)");
        score -= 10;
      }

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

export default router;