import { Router, Response } from "express";
import { db } from "./db";
import { eq, and, or, asc, gte, lte } from "drizzle-orm";
import { socialAccounts, socialMediaPosts, organizations } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { openai } from "./ai/openaiClient";

const router = Router();

function getOrgId(req: AuthRequest): string | null {
  return req.user?.organizationId || null;
}

function isAdmin(req: AuthRequest): boolean {
  return ["ADMIN", "SUPER_ADMIN", "MANAGER"].includes(req.user?.role || "");
}

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

export default router;
