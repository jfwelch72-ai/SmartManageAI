import { Router, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, gte, lte, ilike, sql } from "drizzle-orm";
import { socialAccounts, socialMediaPosts } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { randomUUID } from "crypto";
import crypto from "crypto";
import multer from "multer";
import { publishToPlatform } from "./social/publishService";
import { ObjectStorageService, objectStorageClient, ObjectNotFoundError } from "./objectStorage";
import { openai } from "./ai/openaiClient";
import { governedAiCall, estimateCost } from "./services/aiGovernance";

const objectStorage = new ObjectStorageService();
const STORAGE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;
const socialUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

const router = Router();

const ENCRYPTION_KEY = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || "";

function encrypt(text: string): string {
  const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function getOrgId(req: AuthRequest): string | null {
  return req.user?.organizationId || null;
}

function isAdmin(req: AuthRequest): boolean {
  return ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(req.user?.role || "");
}

router.get("/posts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { status, platform, campaign, from, to, limit: limitStr, offset: offsetStr } = req.query;
    const limit = parseInt(limitStr as string) || 50;
    const offset = parseInt(offsetStr as string) || 0;

    const conditions = [eq(socialMediaPosts.organizationId, orgId)];
    if (status) conditions.push(eq(socialMediaPosts.status, status as any));
    if (platform) conditions.push(eq(socialMediaPosts.platform, platform as any));
    if (campaign) conditions.push(eq(socialMediaPosts.campaignTag, campaign as string));
    if (from) conditions.push(gte(socialMediaPosts.scheduledAt, new Date(from as string)));
    if (to) conditions.push(lte(socialMediaPosts.scheduledAt, new Date(to as string)));

    const posts = await db.query.socialMediaPosts.findMany({
      where: and(...conditions),
      orderBy: [desc(socialMediaPosts.createdAt)],
      limit,
      offset,
    });

    const countResult = await db.execute(
      sql`SELECT COUNT(*) as total FROM social_media_posts WHERE organization_id = ${orgId}`
    );
    const total = parseInt(countResult.rows[0]?.total as string) || 0;

    res.json({ data: posts, total, limit, offset });
  } catch (error) {
    console.error("Error fetching social posts:", error);
    res.status(500).json({ error: "Failed to fetch social posts" });
  }
});

router.post("/posts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const {
      title, content, platform, platforms, status, mediaUrls, hashtags,
      scheduledAt, campaignTag, tone, notes, isRecurring, recurringPattern,
      socialAccountId, aiGenerated, aiPrompt, suggestedImagePrompt,
      utmSource, utmMedium, utmCampaign
    } = req.body;

    if (!content) return res.status(400).json({ error: "Content is required" });

    let postStatus = status || "DRAFT";
    if (scheduledAt && postStatus === "DRAFT") {
      postStatus = "SCHEDULED";
    }

    let warning: string | undefined;
    if (platform && content) {
      const duplicates = await db.query.socialMediaPosts.findMany({
        where: and(
          eq(socialMediaPosts.organizationId, orgId),
          eq(socialMediaPosts.platform, platform as any),
          ilike(socialMediaPosts.content, content.trim()),
        ),
        limit: 1,
      });
      if (duplicates.length > 0) {
        warning = "Similar content already exists for this platform";
      }
    }

    const [post] = await db.insert(socialMediaPosts).values({
      organizationId: orgId,
      title: title || null,
      content,
      platform: platform || null,
      platforms: platforms || null,
      status: postStatus,
      mediaUrls: mediaUrls || null,
      hashtags: hashtags || null,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      campaignTag: campaignTag || null,
      tone: tone || null,
      notes: notes || null,
      isRecurring: isRecurring || false,
      recurringPattern: recurringPattern || null,
      socialAccountId: socialAccountId || null,
      aiGenerated: aiGenerated || false,
      aiPrompt: aiPrompt || null,
      suggestedImagePrompt: suggestedImagePrompt || null,
      utmSource: utmSource || null,
      utmMedium: utmMedium || null,
      utmCampaign: utmCampaign || null,
      createdById: req.user!.id,
    }).returning();

    res.json(warning ? { ...post, warning } : post);
  } catch (error) {
    console.error("Error creating social post:", error);
    res.status(500).json({ error: "Failed to create social post" });
  }
});

router.post("/posts/generate-image", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      return res.status(400).json({ error: "Please provide a descriptive prompt (at least 3 characters)" });
    }

    const imagePrompt = `Professional social media post image: ${prompt.trim()}. High-quality, vibrant, suitable for social media marketing. Clean composition, no text overlays.`;

    const { result: b64Data, blocked, reason } = await governedAiCall({
      orgId,
      userId: req.user!.id,
      actionType: "social_image_generate",
      inputRefs: { prompt: prompt.substring(0, 200) },
      fn: async () => {
        const imageResponse = await openai.images.generate({
          model: "gpt-image-1",
          prompt: imagePrompt,
          n: 1,
          size: "1024x1024",
          quality: "low",
          output_format: "png",
        } as any);
        const model = "dall-e-3";
        return {
          result: imageResponse.data?.[0]?.b64_json || null,
          completion: { model, usage: { prompt_tokens: 0, completion_tokens: 0 } },
        };
      },
    });

    if (blocked) {
      return res.status(429).json({ error: reason || "AI usage limit reached" });
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
    const fileName = `gallery/${orgId}/social-${uniqueId}.png`;
    const fullPath = `${basePath}/${fileName}`;
    const pathParts = fullPath.split("/").filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join("/");

    const bucket = objectStorageClient.bucket(bucketName);
    const blob = bucket.file(objectName);

    await blob.save(imageBuffer, {
      metadata: {
        contentType: "image/png",
        metadata: { originalName: `social-ai-${uniqueId}.png`, source: "social-media" },
      },
    });

    const imageUrl = `/api/social/image/${orgId}/social-${uniqueId}.png`;
    res.json({ imageUrl });
  } catch (error: any) {
    console.error("Error generating social media image:", error);
    if (error?.code === "content_policy_violation") {
      return res.status(400).json({ error: "The image could not be generated due to content policy. Try a different prompt." });
    }
    if (error?.code === "unknown_model" || error?.message?.includes("Unknown model") || error?.status === 404 || error?.message?.includes("not found")) {
      return res.status(501).json({ error: "AI image generation is not available. Please upload an image manually." });
    }
    res.status(500).json({ error: error?.message || "Failed to generate image" });
  }
});

router.post("/upload-media", requireAuth, socialUpload.single("file"), async (req: AuthRequest, res: Response) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return res.status(500).json({ error: "Object storage not configured" });
    }

    const basePath = publicPaths[0];
    const prefix = `gallery/${orgId}/`;
    const basePathParts = basePath.split("/").filter(p => p.length > 0);
    const checkBucketName = basePathParts[0];
    const bucketPrefix = basePathParts.length > 1 ? basePathParts.slice(1).join("/") + "/" + prefix : prefix;
    const checkBucket = objectStorageClient.bucket(checkBucketName);
    const [existingFiles] = await checkBucket.getFiles({ prefix: bucketPrefix });
    let currentTotalSize = 0;
    for (const f of existingFiles) {
      const [meta] = await f.getMetadata();
      currentTotalSize += parseInt(meta.size as string) || 0;
    }
    if (currentTotalSize + file.size > STORAGE_LIMIT_BYTES) {
      return res.status(413).json({
        error: "Storage limit exceeded. You have used " + (currentTotalSize / (1024 * 1024 * 1024)).toFixed(2) + " GB of 3 GB.",
      });
    }

    const ext = file.originalname.split(".").pop() || "jpg";
    const uniqueId = randomUUID();
    const fileName = `gallery/${orgId}/social-${uniqueId}.${ext}`;
    const fullPath = `${basePath}/${fileName}`;
    const pathParts = fullPath.split("/").filter(p => p.length > 0);
    const bucketName = pathParts[0];
    const objectName = pathParts.slice(1).join("/");

    const bucket = objectStorageClient.bucket(bucketName);
    const blob = bucket.file(objectName);

    await blob.save(file.buffer, {
      metadata: {
        contentType: file.mimetype,
        metadata: {
          originalName: file.originalname,
          source: "social-media",
        },
      },
    });

    const proxyUrl = `/api/social/image/${orgId}/social-${uniqueId}.${ext}`;
    res.json({ url: proxyUrl, fileName: file.originalname, size: file.size, mimeType: file.mimetype });
  } catch (error: any) {
    console.error("Error uploading social media file:", error);
    res.status(500).json({ error: "Failed to upload file" });
  }
});

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
    console.error("Error serving social image:", error);
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "Image not found" });
    }
    res.status(500).json({ error: "Failed to serve image" });
  }
});

router.patch("/posts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;

    const existing = await db.query.socialMediaPosts.findFirst({
      where: and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)),
    });
    if (!existing) return res.status(404).json({ error: "Post not found" });
    if (existing.status === "POSTED") return res.status(400).json({ error: "Cannot edit a published post" });

    const {
      title, content, platform, platforms, status, mediaUrls, hashtags,
      scheduledAt, campaignTag, tone, notes, isRecurring, recurringPattern,
      socialAccountId, utmSource, utmMedium, utmCampaign
    } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (platform !== undefined) updates.platform = platform;
    if (platforms !== undefined) updates.platforms = platforms;
    if (status !== undefined) updates.status = status;
    if (mediaUrls !== undefined) updates.mediaUrls = mediaUrls;
    if (hashtags !== undefined) updates.hashtags = hashtags;
    if (scheduledAt !== undefined) updates.scheduledAt = scheduledAt ? new Date(scheduledAt) : null;
    if (campaignTag !== undefined) updates.campaignTag = campaignTag;
    if (tone !== undefined) updates.tone = tone;
    if (notes !== undefined) updates.notes = notes;
    if (isRecurring !== undefined) updates.isRecurring = isRecurring;
    if (recurringPattern !== undefined) updates.recurringPattern = recurringPattern;
    if (socialAccountId !== undefined) updates.socialAccountId = socialAccountId;
    if (utmSource !== undefined) updates.utmSource = utmSource;
    if (utmMedium !== undefined) updates.utmMedium = utmMedium;
    if (utmCampaign !== undefined) updates.utmCampaign = utmCampaign;

    if (updates.scheduledAt && updates.status === undefined && existing.status === "DRAFT") {
      updates.status = "SCHEDULED";
    }

    const [updated] = await db.update(socialMediaPosts)
      .set(updates)
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error updating social post:", error);
    res.status(500).json({ error: "Failed to update social post" });
  }
});

router.delete("/posts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const existing = await db.query.socialMediaPosts.findFirst({
      where: and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)),
    });
    if (!existing) return res.status(404).json({ error: "Post not found" });

    await db.delete(socialMediaPosts)
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)));

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting social post:", error);
    res.status(500).json({ error: "Failed to delete social post" });
  }
});

router.post("/posts/:id/publish", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const post = await db.query.socialMediaPosts.findFirst({
      where: and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)),
    });
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (!post.socialAccountId) {
      return res.status(400).json({ error: "Please link a social account before publishing" });
    }

    const account = await db.query.socialAccounts.findFirst({
      where: and(eq(socialAccounts.id, post.socialAccountId), eq(socialAccounts.organizationId, orgId)),
    });
    if (!account) {
      return res.status(400).json({ error: "Linked social account not found. Please reconnect." });
    }

    let externalPostId: string | undefined;
    let externalPostUrl: string | undefined;
    let publishWarning: string | undefined;

    try {
      const result = await publishToPlatform(
        { id: post.id, content: post.content, platform: post.platform, mediaUrls: post.mediaUrls, hashtags: post.hashtags, title: post.title },
        { id: account.id, platform: account.platform, accountId: account.accountId, accessTokenEncrypted: account.accessTokenEncrypted, refreshTokenEncrypted: account.refreshTokenEncrypted }
      );
      externalPostId = result.externalPostId;
      externalPostUrl = result.externalPostUrl;
      if (!result.platformSupported) {
        publishWarning = result.error;
      }
    } catch (publishError: any) {
      const [failed] = await db.update(socialMediaPosts)
        .set({ status: "FAILED", lastError: publishError.message, retryCount: (post.retryCount || 0) + 1, updatedAt: new Date() })
        .where(eq(socialMediaPosts.id, id))
        .returning();
      return res.status(502).json({ error: `Publishing failed: ${publishError.message}`, post: failed });
    }

    const [updated] = await db.update(socialMediaPosts)
      .set({
        status: "POSTED",
        publishedAt: new Date(),
        externalPostId: externalPostId || null,
        externalPostUrl: externalPostUrl || null,
        updatedAt: new Date(),
      })
      .where(eq(socialMediaPosts.id, id))
      .returning();

    res.json({ ...updated, warning: publishWarning });
  } catch (error) {
    console.error("Error publishing social post:", error);
    res.status(500).json({ error: "Failed to publish social post" });
  }
});

router.post("/posts/:id/approve", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const [updated] = await db.update(socialMediaPosts)
      .set({
        status: "APPROVED",
        approvalStatus: "approved",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Post not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error approving social post:", error);
    res.status(500).json({ error: "Failed to approve social post" });
  }
});

router.post("/posts/:id/duplicate", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const original = await db.query.socialMediaPosts.findFirst({
      where: and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)),
    });
    if (!original) return res.status(404).json({ error: "Post not found" });

    const [duplicate] = await db.insert(socialMediaPosts).values({
      organizationId: orgId,
      title: original.title ? `${original.title} (Copy)` : "Copy",
      content: original.content,
      platform: original.platform,
      platforms: original.platforms,
      status: "DRAFT",
      mediaUrls: original.mediaUrls,
      hashtags: original.hashtags,
      scheduledAt: null,
      campaignTag: original.campaignTag,
      tone: original.tone,
      notes: original.notes,
      aiGenerated: original.aiGenerated,
      aiPrompt: original.aiPrompt,
      suggestedImagePrompt: original.suggestedImagePrompt,
      utmSource: original.utmSource,
      utmMedium: original.utmMedium,
      utmCampaign: original.utmCampaign,
      createdById: req.user!.id,
    }).returning();

    res.json(duplicate);
  } catch (error) {
    console.error("Error duplicating social post:", error);
    res.status(500).json({ error: "Failed to duplicate social post" });
  }
});

router.patch("/posts/:id/reschedule", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ error: "scheduledAt is required" });

    const [updated] = await db.update(socialMediaPosts)
      .set({
        scheduledAt: new Date(scheduledAt),
        status: "SCHEDULED",
        updatedAt: new Date(),
      })
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Post not found" });
    res.json(updated);
  } catch (error) {
    console.error("Error rescheduling social post:", error);
    res.status(500).json({ error: "Failed to reschedule social post" });
  }
});

router.post("/posts/:id/reject", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const { reason } = req.body;

    const existing = await db.query.socialMediaPosts.findFirst({
      where: and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)),
    });
    if (!existing) return res.status(404).json({ error: "Post not found" });
    if (existing.approvalStatus !== "pending") {
      return res.status(400).json({ error: "Only posts pending approval can be rejected" });
    }

    const [updated] = await db.update(socialMediaPosts)
      .set({
        status: "DRAFT",
        approvalStatus: "rejected",
        rejectionReason: reason || "No reason provided",
        approvedById: req.user!.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)))
      .returning();

    res.json(updated);
  } catch (error) {
    console.error("Error rejecting social post:", error);
    res.status(500).json({ error: "Failed to reject social post" });
  }
});

router.post("/posts/bulk", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { posts: postsData } = req.body;
    if (!Array.isArray(postsData) || postsData.length === 0) {
      return res.status(400).json({ error: "Posts array is required" });
    }

    const created = [];
    for (const p of postsData) {
      if (!p.content) continue;
      const [post] = await db.insert(socialMediaPosts).values({
        organizationId: orgId,
        title: p.title || null,
        content: p.content,
        platform: p.platform || null,
        platforms: p.platforms || null,
        status: p.scheduledAt ? "SCHEDULED" : "DRAFT",
        hashtags: p.hashtags || null,
        scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
        campaignTag: p.campaignTag || null,
        tone: p.tone || null,
        createdById: req.user!.id,
      }).returning();
      created.push(post);
    }

    res.json({ created: created.length, posts: created });
  } catch (error) {
    console.error("Error bulk creating social posts:", error);
    res.status(500).json({ error: "Failed to bulk create posts" });
  }
});

export default router;
