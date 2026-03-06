import express, { Response } from "express";
import { randomUUID } from "crypto";
import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  websiteBlogPosts,
  organizationWebsites,
  organizations,
} from "@shared/schema";
import { requireAuth, AuthRequest } from "./auth";
import { logCreate, logUpdate } from "./auditLogger";
import { openai } from "./ai/openaiClient";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";

const router = express.Router();

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

export default router;