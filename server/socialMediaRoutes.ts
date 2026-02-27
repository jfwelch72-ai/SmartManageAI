import { Router, Request, Response } from "express";
import { db } from "./db";
import { eq, and, desc, asc, gte, lte, sql, or, ilike } from "drizzle-orm";
import { socialAccounts, socialMediaPosts, socialPostAnalytics, organizations } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { randomUUID } from "crypto";
import crypto from "crypto";
import { openai } from "./ai/openaiClient";

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
    return "";
  }
}

function getOrgId(req: AuthRequest): string | null {
  return req.user?.organizationId || null;
}

function isAdmin(req: AuthRequest): boolean {
  return ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(req.user?.role || "");
}

router.get("/accounts", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching social accounts:", error);
    res.status(500).json({ error: "Failed to fetch social accounts" });
  }
});

router.post("/accounts", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Error creating social account:", error);
    res.status(500).json({ error: "Failed to create social account" });
  }
});

router.patch("/accounts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Error updating social account:", error);
    res.status(500).json({ error: "Failed to update social account" });
  }
});

router.delete("/accounts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Error deleting social account:", error);
    res.status(500).json({ error: "Failed to delete social account" });
  }
});

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

    const countResult = await db.execute(sql`SELECT COUNT(*) as total FROM social_media_posts WHERE organization_id = ${orgId}`);
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

    res.json(post);
  } catch (error) {
    console.error("Error creating social post:", error);
    res.status(500).json({ error: "Failed to create social post" });
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
    const [updated] = await db.update(socialMediaPosts)
      .set({ status: "POSTED", publishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(socialMediaPosts.id, id), eq(socialMediaPosts.organizationId, orgId)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Post not found" });
    res.json(updated);
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

router.get("/calendar", requireAuth, async (req: AuthRequest, res: Response) => {
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
    console.error("Error fetching social calendar:", error);
    res.status(500).json({ error: "Failed to fetch calendar data" });
  }
});

router.get("/stats", requireAuth, async (req: AuthRequest, res: Response) => {
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

    res.json({
      total, drafts, scheduled, posted, failed, pendingApproval,
      publishedThisMonth, publishedThisWeek,
      byPlatform,
      connectedAccounts: accounts.length,
      accountsByPlatform: accounts.reduce((acc: Record<string, string>, a) => {
        acc[a.platform] = a.status;
        return acc;
      }, {}),
    });
  } catch (error) {
    console.error("Error fetching social stats:", error);
    res.status(500).json({ error: "Failed to fetch social stats" });
  }
});

router.post("/posts/generate", requireAuth, async (req: AuthRequest, res: Response) => {
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

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a social media marketing expert for the construction industry." },
        { role: "user", content: prompt },
      ],
      max_tokens: 1000,
      response_format: { type: "json_object" },
    });

    const postContent = JSON.parse(response.choices[0]?.message?.content || "{}");

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
    console.error("Error generating social post:", error);
    res.status(500).json({ error: "Failed to generate social post" });
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
