import express, { Request, Response } from "express";
import { randomUUID } from "crypto";
import multer from "multer";
import { db } from "./db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import {
  organizationWebsites,
  websiteProjects,
  websiteProjectImages,
  organizationSocialLinks,
  socialPostHistory,
  websiteContactSubmissions,
  organizations,
  crmOrganisations,
  crmContacts,
} from "@shared/schema";
import { requireAuth, AuthRequest } from "./auth";
import { logCreate, logUpdate } from "./auditLogger";
import { openai } from "./ai/openaiClient";
import { ObjectStorageService, objectStorageClient, ObjectNotFoundError } from "./objectStorage";
import { sendEmail } from "./services/emailService";
import { governedAiCall } from "./services/aiGovernance";

const router = express.Router();

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

const objectStorage = new ObjectStorageService();
const STORAGE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;

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

    const orgId = user.organizationId;
    const { result: content, blocked, reason } = await governedAiCall({
      orgId: orgId || "system",
      userId: user.id,
      actionType: "website_project_description_generate",
      inputRefs: { title, serviceType, projectType },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a professional construction project portfolio writer." },
            { role: "user", content: prompt },
          ],
          max_tokens: 1000,
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
    console.error("Error generating project description:", error);
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
        console.error("Error sending form notification email:", emailErr);
      }
    }

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
    console.error("Error converting to CRM:", error);
    res.status(500).json({ error: "Failed to convert to CRM" });
  }
});

export default router;