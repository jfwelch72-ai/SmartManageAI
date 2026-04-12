import {logError, logWarn } from "./utils/logger";
import { Router, type Request, type Response, NextFunction } from "express";
import { db } from "./db";
import { sensitiveLimiter } from "./rateLimiter";
import { eq, and, desc, gte, lte, ilike, sql, asc, or } from "drizzle-orm";
import { socialAccounts, socialMediaPosts, organizations } from "@shared/schema";
import { requireAuth, requireFeaturePermission, type AuthRequest } from "./auth";
import { randomUUID } from "crypto";
import crypto from "crypto";
import multer from "multer";
import { publishToPlatform, validateToken, refreshToken, fetchEngagement } from "./social/publishService";
import { ObjectStorageService, objectStorageClient, ObjectNotFoundError } from "./objectStorage";
import { openai, AI_MODEL_GPT5 } from "./ai/openaiClient";
import { governedAiCall, estimateCost } from "./services/aiGovernance";
import { isSocialPlatformConfigured } from "./services/integrationStatusService";

const router = Router();

// ========================================
// Routes from socialPostRoutes.ts
// ========================================

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

router.use(requireAuth, requireFeaturePermission('canPostSocialMedia'));

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

router.get("/posts", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.post("/posts", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    const approvalStatus = postStatus === "PENDING_APPROVAL" ? "pending" : undefined;

    const warnings: string[] = [];

    if (platform && !isSocialPlatformConfigured(platform)) {
      if (postStatus === "SCHEDULED" || postStatus === "POSTED") {
        warnings.push(`${platform} API credentials are not configured. This post will fail to publish. Please configure the platform keys or switch to DRAFT.`);
      } else {
        warnings.push(`${platform} API credentials are not configured. Publishing will not work until credentials are added.`);
      }
    }

    if (platforms && Array.isArray(platforms)) {
      const unconfigured = platforms.filter((p: string) => !isSocialPlatformConfigured(p));
      if (unconfigured.length > 0) {
        warnings.push(`The following platforms are not configured: ${unconfigured.join(", ")}. Posts to these platforms will fail.`);
      }
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
      approvalStatus: approvalStatus || null,
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

    const allWarnings = warning ? [warning, ...warnings] : warnings;
    res.json(allWarnings.length > 0 ? { ...post, warning: allWarnings[0], warnings: allWarnings } : post);
  } catch (error) {
    next(error);
  }
});

router.post("/posts/generate-image", requireAuth, sensitiveLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
          model: "dall-e-3",
          prompt: imagePrompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          response_format: "b64_json",
        });
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
      return next(error);
    }

    const imageBuffer = Buffer.from(b64Data, "base64");
    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return next(error);
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
    logError("Error generating social media image:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error?.code === "content_policy_violation") {
      return res.status(400).json({ error: "The image could not be generated due to content policy. Try a different prompt." });
    }
    if (error?.code === "unknown_model" || error?.message?.includes("Unknown model") || error?.status === 404 || error?.message?.includes("not found")) {
      return res.status(501).json({ error: "AI image generation is not available. Please upload an image manually." });
    }
    next(error);
  }
});

router.post("/upload-media", requireAuth, socialUpload.single("file"), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file provided" });

    const publicPaths = objectStorage.getPublicObjectSearchPaths();
    if (publicPaths.length === 0) {
      return next(new Error("Object storage not configured"));
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
    next(error);
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
    logError("Error serving social image:", {}, error instanceof Error ? error : new Error(String(error)));
    if (error instanceof ObjectNotFoundError) {
      return res.status(404).json({ error: "Image not found" });
    }
    next(error);
  }
});

router.patch("/posts/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    if (updates.status === "PENDING_APPROVAL") {
      updates.approvalStatus = "pending";
      updates.rejectionReason = null;
    }

    const [updated] = await db.update(socialMediaPosts)
      .set(updates)
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)))
      .returning();

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

router.delete("/posts/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.post("/posts/:id/publish", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.post("/posts/:id/approve", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.post("/posts/:id/duplicate", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.patch("/posts/:id/reschedule", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.post("/posts/:id/reject", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

router.post("/sync-engagement/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const post = await db.query.socialMediaPosts.findFirst({
      where: and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)),
    });
    if (!post) return res.status(404).json({ error: "Post not found" });
    if (post.status !== "POSTED" || !post.externalPostId) {
      return res.status(400).json({ error: "Post must be published with an external ID to sync engagement" });
    }
    if (!post.socialAccountId) {
      return res.status(400).json({ error: "No social account linked to this post" });
    }

    const account = await db.query.socialAccounts.findFirst({
      where: and(eq(socialAccounts.id, post.socialAccountId), eq(socialAccounts.organizationId, orgId)),
    });
    if (!account) {
      return res.status(400).json({ error: "Linked social account not found" });
    }

    const engagement = await fetchEngagement(
      { externalPostId: post.externalPostId, platform: post.platform },
      { id: account.id, platform: account.platform, accountId: account.accountId, accessTokenEncrypted: account.accessTokenEncrypted, refreshTokenEncrypted: account.refreshTokenEncrypted }
    );

    if (!engagement) {
      return res.status(200).json({ message: "Engagement data not available for this platform", metrics: null });
    }

    await db.execute(
      sql`UPDATE social_media_posts SET
        engagement_likes = ${engagement.likes},
        engagement_comments = ${engagement.comments},
        engagement_shares = ${engagement.shares},
        engagement_reach = ${engagement.reach},
        engagement_impressions = ${engagement.impressions},
        engagement_clicks = ${engagement.clicks},
        engagement_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id}`
    );

    res.json({ metrics: engagement });
  } catch (error) {
    next(error);
  }
});

router.post("/posts/bulk", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
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
    next(error);
  }
});

// ========================================
// Routes from socialAccountRoutes.ts
// ========================================

function decrypt(text: string): string {
  try {
    const key = crypto.scryptSync(ENCRYPTION_KEY, "salt", 32);
    const parts = text.split(":");
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    logWarn("Non-critical operation failed");
    return "";
  }
}

function getPlatformCredentials(platform: string): { clientId: string; clientSecret: string } {
  switch (platform) {
    case "FACEBOOK":
    case "INSTAGRAM":
      return { clientId: process.env.FB_APP_ID || "", clientSecret: process.env.FB_APP_SECRET || "" };
    case "LINKEDIN":
      return { clientId: process.env.LINKEDIN_CLIENT_ID || "", clientSecret: process.env.LINKEDIN_CLIENT_SECRET || "" };
    case "TWITTER":
      return { clientId: process.env.TWITTER_CLIENT_ID || "", clientSecret: process.env.TWITTER_CLIENT_SECRET || "" };
    default:
      return { clientId: "", clientSecret: "" };
  }
}

router.get("/accounts", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const accounts = await db.query.socialAccounts.findMany({
      where: eq(socialAccounts.organizationId, orgId),
      orderBy: [asc(socialAccounts.platform)],
    });

    const sanitized = accounts.map(a => ({
      ...a,
      accessTokenEncrypted: a.accessTokenEncrypted ? "***" : null,
      refreshTokenEncrypted: a.refreshTokenEncrypted ? "***" : null,
    }));

    res.json(sanitized);
  } catch (error) {
    next(error);
  }
});

router.post("/accounts", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { platform, accountName, accountId, accessToken, refreshToken, permissionScopes } = req.body;
    if (!platform) return res.status(400).json({ error: "Platform is required" });

    const [account] = await db.insert(socialAccounts).values({
      organizationId: orgId,
      platform,
      accountName: accountName || null,
      accountId: accountId || null,
      status: accessToken ? "CONNECTED" : "DISCONNECTED",
      accessTokenEncrypted: accessToken ? encrypt(accessToken) : null,
      refreshTokenEncrypted: refreshToken ? encrypt(refreshToken) : null,
      permissionScopes: permissionScopes || null,
      connectedById: req.user!.id,
    }).returning();

    res.json({ ...account, accessTokenEncrypted: "***", refreshTokenEncrypted: "***" });
  } catch (error) {
    next(error);
  }
});

router.patch("/accounts/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const { accountName, accessToken, refreshToken, status } = req.body;

    const updates: any = { updatedAt: new Date() };
    if (accountName !== undefined) updates.accountName = accountName;
    if (status) updates.status = status;
    if (accessToken) {
      updates.accessTokenEncrypted = encrypt(accessToken);
      updates.status = "CONNECTED";
    }
    if (refreshToken) {
      updates.refreshTokenEncrypted = encrypt(refreshToken);
    }

    const [updated] = await db.update(socialAccounts)
      .set(updates)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Account not found" });
    res.json({ ...updated, accessTokenEncrypted: "***", refreshTokenEncrypted: "***" });
  } catch (error) {
    next(error);
  }
});

router.delete("/accounts/:id", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const [deleted] = await db.delete(socialAccounts)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)))
      .returning();

    if (!deleted) return res.status(404).json({ error: "Account not found" });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/accounts/:id/status", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const account = await db.query.socialAccounts.findFirst({
      where: and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    if (!account.accessTokenEncrypted) {
      return res.json({ valid: false, error: "No access token configured", expiresAt: null });
    }

    const token = decrypt(account.accessTokenEncrypted);
    if (!token) {
      return res.json({ valid: false, error: "Token decryption failed", expiresAt: null });
    }

    const result = await validateToken(account.platform, token, account.accountId || undefined);
    res.json({
      valid: result.valid,
      error: result.error || null,
      expiresAt: account.tokenExpiresAt || null,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/accounts/:id/refresh", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { id } = req.params;
    const account = await db.query.socialAccounts.findFirst({
      where: and(eq(socialAccounts.id, id), eq(socialAccounts.organizationId, orgId)),
    });
    if (!account) return res.status(404).json({ error: "Account not found" });

    if (!account.refreshTokenEncrypted) {
      return res.status(400).json({ error: "No refresh token available. Please reconnect the account." });
    }

    const platformCreds = getPlatformCredentials(account.platform);
    const result = await refreshToken(account.platform, account.refreshTokenEncrypted, platformCreds.clientId, platformCreds.clientSecret);
    if (!result) {
      await db.update(socialAccounts)
        .set({ status: "EXPIRED", updatedAt: new Date() })
        .where(eq(socialAccounts.id, id));
      return res.status(400).json({ error: "Token refresh failed. Please reconnect the account." });
    }

    const expiresAt = result.expiresIn ? new Date(Date.now() + result.expiresIn * 1000) : null;
    const [updated] = await db.update(socialAccounts)
      .set({
        accessTokenEncrypted: encrypt(result.accessToken),
        tokenExpiresAt: expiresAt,
        status: "CONNECTED",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, id))
      .returning();

    res.json({
      success: true,
      status: "CONNECTED",
      expiresAt,
      account: { ...updated, accessTokenEncrypted: "***", refreshTokenEncrypted: "***" },
    });
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from socialAnalyticsRoutes.ts
// ========================================

router.get("/calendar", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { month, year } = req.query;
    const m = parseInt(month as string) || new Date().getMonth() + 1;
    const y = parseInt(year as string) || new Date().getFullYear();

    const startDate = new Date(y, m - 1, 1);
    const endDate = new Date(y, m, 0, 23, 59, 59);

    const posts = await db.query.socialMediaPosts.findMany({
      where: and(
        eq(socialMediaPosts.organizationId, orgId),
        or(
          and(gte(socialMediaPosts.scheduledAt, startDate), lte(socialMediaPosts.scheduledAt, endDate)),
          and(gte(socialMediaPosts.publishedAt, startDate), lte(socialMediaPosts.publishedAt, endDate)),
          and(gte(socialMediaPosts.createdAt, startDate), lte(socialMediaPosts.createdAt, endDate))
        )
      ),
      orderBy: [asc(socialMediaPosts.scheduledAt)],
    });

    const grouped: Record<string, any[]> = {};
    posts.forEach(post => {
      const date = post.scheduledAt || post.publishedAt || post.createdAt;
      const key = new Date(date).toISOString().split("T")[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(post);
    });

    res.json({ month: m, year: y, posts: grouped });
  } catch (error) {
    next(error);
  }
});

router.get("/stats", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - now.getDay());
    thisWeekStart.setHours(0, 0, 0, 0);

    const allPosts = await db.query.socialMediaPosts.findMany({
      where: eq(socialMediaPosts.organizationId, orgId),
    });

    const total = allPosts.length;
    const drafts = allPosts.filter(p => p.status === "DRAFT").length;
    const scheduled = allPosts.filter(p => p.status === "SCHEDULED").length;
    const posted = allPosts.filter(p => p.status === "POSTED").length;
    const failed = allPosts.filter(p => p.status === "FAILED").length;
    const pendingApproval = allPosts.filter(p => p.status === "PENDING_APPROVAL").length;

    const publishedThisMonth = allPosts.filter(p =>
      p.status === "POSTED" && p.publishedAt && new Date(p.publishedAt) >= thisMonthStart
    ).length;

    const publishedThisWeek = allPosts.filter(p =>
      p.status === "POSTED" && p.publishedAt && new Date(p.publishedAt) >= thisWeekStart
    ).length;

    const byPlatform: Record<string, number> = {};
    allPosts.forEach(p => {
      const plat = p.platform || "UNKNOWN";
      byPlatform[plat] = (byPlatform[plat] || 0) + 1;
    });

    const accounts = await db.query.socialAccounts.findMany({
      where: eq(socialAccounts.organizationId, orgId),
    });

    const postedPosts = allPosts.filter(p => p.status === "POSTED");
    const engagementResult = await db.execute(
      sql`SELECT
        COALESCE(SUM(engagement_likes), 0) AS total_likes,
        COALESCE(SUM(engagement_comments), 0) AS total_comments,
        COALESCE(SUM(engagement_shares), 0) AS total_shares,
        COALESCE(SUM(engagement_reach), 0) AS total_reach,
        COALESCE(SUM(engagement_impressions), 0) AS total_impressions,
        COALESCE(SUM(engagement_clicks), 0) AS total_clicks
      FROM social_media_posts
      WHERE organization_id = ${orgId} AND status = 'POSTED'`
    );
    const engRow = engagementResult.rows[0] || {};
    const totalEngagement = {
      likes: parseInt(engRow.total_likes as string) || 0,
      comments: parseInt(engRow.total_comments as string) || 0,
      shares: parseInt(engRow.total_shares as string) || 0,
      reach: parseInt(engRow.total_reach as string) || 0,
      impressions: parseInt(engRow.total_impressions as string) || 0,
      clicks: parseInt(engRow.total_clicks as string) || 0,
    };

    res.json({
      total, drafts, scheduled, posted, failed, pendingApproval,
      publishedThisMonth, publishedThisWeek,
      byPlatform,
      connectedAccounts: accounts.length,
      accountsByPlatform: accounts.reduce((acc: Record<string, string>, a) => {
        acc[a.platform] = a.status;
        return acc;
      }, {}),
      totalEngagement,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/posts/generate", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: "Admin access required" });
    const orgId = getOrgId(req);
    if (!orgId) return res.status(400).json({ error: "Organization required" });

    const { platform, topic, tone, saveAsDraft } = req.body;
    if (!platform || !topic) return res.status(400).json({ error: "Platform and topic are required" });

    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });

    const platformGuides: Record<string, string> = {
      FACEBOOK: "Write for Facebook. Can be longer (up to 500 words), conversational, encourage engagement.",
      INSTAGRAM: "Write for Instagram. Focus on visuals, use emojis, max 2200 characters, include call-to-action.",
      LINKEDIN: "Write for LinkedIn. Professional tone, industry insights, thought leadership, 1300 character limit.",
      TWITTER: "Write for X/Twitter. Concise (280 chars max), punchy, include relevant hashtags.",
      TIKTOK: "Write for TikTok. Casual, trendy, engaging, focus on video caption format.",
      YOUTUBE: "Write for YouTube. Video description style, include relevant keywords, call-to-action for subscribe.",
      PINTEREST: "Write for Pinterest. Descriptive, keyword-rich, inspiring, include call-to-action.",
    };

    const prompt = `Create a social media post for a ${org?.tradeType || "construction"} company called "${org?.name || "Our Company"}".

Platform: ${platform}
Topic: ${topic}
Tone: ${tone || "professional"}
${platformGuides[platform] || ""}

Return a JSON object with:
{
  "content": "The full post content",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3"],
  "suggestedImagePrompt": "Description for an AI image generator if applicable",
  "bestTimeToPost": "Suggested posting time",
  "engagementTips": "Tips to boost engagement",
  "title": "A short internal title/label for this post"
}`;

    const { result: postContent, blocked, reason } = await governedAiCall({
      orgId,
      userId: req.user!.id,
      actionType: "social_post_generate",
      inputRefs: { platform, topic, tone },
      fn: async () => {
        const completion = await openai.chat.completions.create({
          model: AI_MODEL_GPT5,
          messages: [
            { role: "system", content: "You are a social media marketing expert for the construction industry." },
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

    if (saveAsDraft) {
      const [saved] = await db.insert(socialMediaPosts).values({
        organizationId: orgId,
        title: postContent.title || topic,
        content: postContent.content || "",
        platform: platform as any,
        status: "DRAFT",
        hashtags: postContent.hashtags || [],
        tone: tone || "professional",
        aiGenerated: true,
        aiPrompt: topic,
        suggestedImagePrompt: postContent.suggestedImagePrompt || null,
        createdById: req.user!.id,
      }).returning();

      return res.json({ ...postContent, savedPost: saved });
    }

    res.json(postContent);
  } catch (error) {
    next(error);
  }
});

// ========================================
// Routes from socialOAuthRoutes.ts
// ========================================

function getBaseUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:5000";
  return `${proto}://${host}`;
}

function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

function setCookie(res: Response, name: string, value: string) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
}

function validateAndClearState(req: Request, res: Response, name: string, returned: string | undefined): boolean {
  const stored = req.cookies?.[name];
  res.clearCookie(name, { path: "/" });
  if (!stored || !returned || stored !== returned) return false;
  return true;
}

async function upsertSocialAccount(
  orgId: string,
  userId: string,
  platform: string,
  accountName: string,
  accountId: string,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number
) {
  const accessTokenEncrypted = encrypt(accessToken);
  const refreshTokenEncrypted = refreshToken ? encrypt(refreshToken) : null;
  const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

  const [existing] = await db
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.organizationId, orgId), eq(socialAccounts.platform, platform)))
    .limit(1);

  if (existing) {
    await db
      .update(socialAccounts)
      .set({
        accountName,
        accountId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt,
        status: "CONNECTED",
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(socialAccounts.id, existing.id));
  } else {
    await db.insert(socialAccounts).values({
      organizationId: orgId,
      platform,
      accountName,
      accountId,
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
      status: "CONNECTED",
      lastSyncAt: new Date(),
      connectedById: userId,
    });
  }
}

// ─── FACEBOOK ────────────────────────────────────────────────────────────────

router.get("/auth/facebook", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.FB_APP_ID;
  if (!clientId) {
    return res.redirect("/social-media?error=facebook_not_configured");
  }
  const state = generateState();
  setCookie(res, "social_oauth_state_facebook", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/facebook/callback`;
  const scope = "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,instagram_manage_insights";
  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&response_type=code`;
  res.redirect(url);
});

router.get("/auth/facebook/callback", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=facebook_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_facebook", state)) {
      return res.redirect("/social-media?error=facebook_failed");
    }

    const clientId = process.env.FB_APP_ID;
    const clientSecret = process.env.FB_APP_SECRET;
    if (!clientId || !clientSecret) return res.redirect("/social-media?error=facebook_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/facebook/callback`;

    const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${clientId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`, {
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      logError("Facebook token exchange failed:", {}, tokenData instanceof Error ? tokenData : new Error(String(tokenData)));
      return res.redirect("/social-media?error=facebook_failed");
    }

    // Get long-lived token
    const longTokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${tokenData.access_token}`, {
      signal: AbortSignal.timeout(15000),
    });
    const longTokenData = await longTokenRes.json();
    const finalToken = longTokenData.access_token || tokenData.access_token;
    const expiresIn = longTokenData.expires_in || tokenData.expires_in;

    // Get user info
    const userRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${finalToken}`, {
      signal: AbortSignal.timeout(10000),
    });
    const userData = await userRes.json();

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "FACEBOOK", userData.name || "Facebook Page", userData.id || "", finalToken, undefined, expiresIn);

    // Also check for Instagram business account linked to this FB account
    try {
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${finalToken}`, {
        signal: AbortSignal.timeout(10000),
      });
      const pagesData = await pagesRes.json();
      if (pagesData.data && pagesData.data.length > 0) {
        const page = pagesData.data[0];
        const igRes = await fetch(`https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`, {
          signal: AbortSignal.timeout(10000),
        });
        const igData = await igRes.json();
        if (igData.instagram_business_account?.id) {
          const igInfoRes = await fetch(`https://graph.facebook.com/v19.0/${igData.instagram_business_account.id}?fields=id,username&access_token=${page.access_token}`, {
            signal: AbortSignal.timeout(10000),
          });
          const igInfo = await igInfoRes.json();
          await upsertSocialAccount(orgId, userId, "INSTAGRAM", `@${igInfo.username || "instagram"}`, igData.instagram_business_account.id, page.access_token, undefined, expiresIn);
        }
      }
    } catch (igErr) {
      console.warn("Instagram auto-link skipped:", igErr);
    }

    res.redirect("/social-media?connected=FACEBOOK");
  } catch (err) {
    logError("Facebook OAuth callback error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.redirect("/social-media?error=facebook_failed");
  }
});

// ─── LINKEDIN ─────────────────────────────────────────────────────────────────

router.get("/auth/linkedin", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  if (!clientId) return res.redirect("/social-media?error=linkedin_not_configured");

  const state = generateState();
  setCookie(res, "social_oauth_state_linkedin", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/linkedin/callback`;
  const scope = "r_liteprofile r_emailaddress w_member_social";
  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}`;
  res.redirect(url);
});

router.get("/auth/linkedin/callback", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=linkedin_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_linkedin", state)) {
      return res.redirect("/social-media?error=linkedin_failed");
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.redirect("/social-media?error=linkedin_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/linkedin/callback`;

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      logError("LinkedIn token exchange failed:", {}, tokenData instanceof Error ? tokenData : new Error(String(tokenData)));
      return res.redirect("/social-media?error=linkedin_failed");
    }

    const profileRes = await fetch("https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName)", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const profile = await profileRes.json();
    const name = `${profile.localizedFirstName || ""} ${profile.localizedLastName || ""}`.trim() || "LinkedIn User";

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "LINKEDIN", name, profile.id || "", tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=LINKEDIN");
  } catch (err) {
    logError("LinkedIn OAuth callback error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.redirect("/social-media?error=linkedin_failed");
  }
});

// ─── TWITTER / X ──────────────────────────────────────────────────────────────

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

router.get("/auth/twitter", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.TWITTER_CLIENT_ID;
  if (!clientId) return res.redirect("/social-media?error=twitter_not_configured");

  const state = generateState();
  const { verifier, challenge } = generatePKCE();
  setCookie(res, "social_oauth_state_twitter", state);
  setCookie(res, "social_oauth_pkce_twitter", verifier);

  const redirectUri = `${getBaseUrl(req)}/api/social/auth/twitter/callback`;
  const scope = "tweet.read tweet.write users.read offline.access";
  const url = `https://twitter.com/i/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;
  res.redirect(url);
});

router.get("/auth/twitter/callback", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=twitter_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_twitter", state)) {
      return res.redirect("/social-media?error=twitter_failed");
    }

    const verifier = req.cookies?.["social_oauth_pkce_twitter"];
    res.clearCookie("social_oauth_pkce_twitter", { path: "/" });
    if (!verifier) return res.redirect("/social-media?error=twitter_failed");

    const clientId = process.env.TWITTER_CLIENT_ID;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET;
    if (!clientId) return res.redirect("/social-media?error=twitter_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/twitter/callback`;
    const credentials = clientSecret
      ? "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
      : undefined;

    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(credentials ? { Authorization: credentials } : {}),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        ...(credentials ? {} : { client_id: clientId }),
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      logError("Twitter token exchange failed:", {}, tokenData instanceof Error ? tokenData : new Error(String(tokenData)));
      return res.redirect("/social-media?error=twitter_failed");
    }

    const userRes = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const userData = await userRes.json();
    const twitterUser = userData.data || {};

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "TWITTER", `@${twitterUser.username || "twitter"}`, twitterUser.id || "", tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=TWITTER");
  } catch (err) {
    logError("Twitter OAuth callback error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.redirect("/social-media?error=twitter_failed");
  }
});

// ─── TIKTOK ───────────────────────────────────────────────────────────────────

router.get("/auth/tiktok", requireAuth, (req: AuthRequest, res: Response) => {
  const clientKey = process.env.TIKTOK_CLIENT_ID;
  if (!clientKey) return res.redirect("/social-media?error=tiktok_not_configured");

  const state = generateState();
  setCookie(res, "social_oauth_state_tiktok", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/tiktok/callback`;
  const scope = "user.info.basic,video.publish";
  const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  res.redirect(url);
});

router.get("/auth/tiktok/callback", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=tiktok_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_tiktok", state)) {
      return res.redirect("/social-media?error=tiktok_failed");
    }

    const clientKey = process.env.TIKTOK_CLIENT_ID;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) return res.redirect("/social-media?error=tiktok_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/tiktok/callback`;

    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      logError("TikTok token exchange failed:", {}, new Error(JSON.stringify(tokenData)));
      return res.redirect("/social-media?error=tiktok_failed");
    }

    const userRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const userData = await userRes.json() as any;
    const tiktokUser = userData.data?.user || {};

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "TIKTOK", tiktokUser.display_name || "TikTok User", tiktokUser.open_id || "", tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=TIKTOK");
  } catch (err) {
    logError("TikTok OAuth callback error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.redirect("/social-media?error=tiktok_failed");
  }
});

// ─── YOUTUBE ──────────────────────────────────────────────────────────────────

router.get("/auth/youtube", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  if (!clientId) return res.redirect("/social-media?error=youtube_not_configured");

  const state = generateState();
  setCookie(res, "social_oauth_state_youtube", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/youtube/callback`;
  const scope = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube";
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}&access_type=offline&prompt=consent`;
  res.redirect(url);
});

router.get("/auth/youtube/callback", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=youtube_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_youtube", state)) {
      return res.redirect("/social-media?error=youtube_failed");
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return res.redirect("/social-media?error=youtube_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/youtube/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      logError("YouTube token exchange failed:", {}, new Error(JSON.stringify(tokenData)));
      return res.redirect("/social-media?error=youtube_failed");
    }

    const channelRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const channelData = await channelRes.json() as any;
    const channel = channelData.items?.[0] || {};
    const channelName = channel.snippet?.title || "YouTube Channel";
    const channelId = channel.id || "";

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "YOUTUBE", channelName, channelId, tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=YOUTUBE");
  } catch (err) {
    logError("YouTube OAuth callback error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.redirect("/social-media?error=youtube_failed");
  }
});

// ─── PINTEREST ────────────────────────────────────────────────────────────────

router.get("/auth/pinterest", requireAuth, (req: AuthRequest, res: Response) => {
  const clientId = process.env.PINTEREST_APP_ID;
  if (!clientId) return res.redirect("/social-media?error=pinterest_not_configured");

  const state = generateState();
  setCookie(res, "social_oauth_state_pinterest", state);
  const redirectUri = `${getBaseUrl(req)}/api/social/auth/pinterest/callback`;
  const scope = "boards:read,pins:read,pins:write";
  const url = `https://www.pinterest.com/oauth/?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&state=${state}`;
  res.redirect(url);
});

router.get("/auth/pinterest/callback", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect("/social-media?error=pinterest_denied");
    if (!validateAndClearState(req, res, "social_oauth_state_pinterest", state)) {
      return res.redirect("/social-media?error=pinterest_failed");
    }

    const clientId = process.env.PINTEREST_APP_ID;
    const clientSecret = process.env.PINTEREST_APP_SECRET;
    if (!clientId || !clientSecret) return res.redirect("/social-media?error=pinterest_not_configured");

    const redirectUri = `${getBaseUrl(req)}/api/social/auth/pinterest/callback`;
    const credentials = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const tokenRes = await fetch("https://api.pinterest.com/v5/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: credentials,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    });
    const tokenData = await tokenRes.json() as any;
    if (!tokenData.access_token) {
      logError("Pinterest token exchange failed:", {}, new Error(JSON.stringify(tokenData)));
      return res.redirect("/social-media?error=pinterest_failed");
    }

    const userRes = await fetch("https://api.pinterest.com/v5/user_account", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    const userData = await userRes.json() as any;
    const username = userData.username || "Pinterest User";

    const orgId = req.user!.organizationId!;
    const userId = req.user!.id;
    await upsertSocialAccount(orgId, userId, "PINTEREST", username, userData.id || "", tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);

    res.redirect("/social-media?connected=PINTEREST");
  } catch (err) {
    logError("Pinterest OAuth callback error:", {}, err instanceof Error ? err : new Error(String(err)));
    res.redirect("/social-media?error=pinterest_failed");
  }
});

// ─── STATUS ENDPOINT ──────────────────────────────────────────────────────────

router.get("/auth/platform-status", requireAuth, (_req: Request, res: Response) => {
  res.json({
    FACEBOOK: !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET),
    INSTAGRAM: !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET),
    LINKEDIN: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
    TWITTER: !!process.env.TWITTER_CLIENT_ID,
    TIKTOK: !!process.env.TIKTOK_CLIENT_ID,
    YOUTUBE: !!process.env.YOUTUBE_CLIENT_ID,
    PINTEREST: !!process.env.PINTEREST_APP_ID,
  });
});

export default router;
