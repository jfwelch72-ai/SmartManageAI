import { logWarn, logError } from "../utils/logger";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.SESSION_SECRET || process.env.ENCRYPTION_KEY || "";

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

export interface PublishResult {
  success: boolean;
  externalPostId?: string;
  externalPostUrl?: string;
  error?: string;
  platformSupported: boolean;
}

interface PostData {
  id: string;
  content: string;
  platform: string | null;
  mediaUrls: string[] | null;
  hashtags: string[] | null;
  title: string | null;
}

interface AccountData {
  id: string;
  platform: string;
  accountId: string | null;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
}

async function publishToFacebook(post: PostData, token: string, pageId: string): Promise<PublishResult> {
  const message = buildPostMessage(post);

  if (post.mediaUrls && post.mediaUrls.length > 0) {
    const photoIds: string[] = [];
    for (const url of post.mediaUrls) {
      const photoRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}/photos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, published: false, access_token: token }),
        signal: AbortSignal.timeout(30000),
      });
      const photoData = await photoRes.json();
      if (photoData.error) throw new Error(`Facebook photo upload failed: ${photoData.error.message}`);
      if (photoData.id) photoIds.push(photoData.id);
    }

    if (photoIds.length > 0) {
      const attachedMedia = photoIds.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })]);
      const params = new URLSearchParams([
        ["message", message],
        ["access_token", token],
        ...attachedMedia,
      ]);
      const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (data.error) throw new Error(`Facebook API error: ${data.error.message}`);
      return {
        success: true,
        platformSupported: true,
        externalPostId: data.id,
        externalPostUrl: `https://facebook.com/${data.id}`,
      };
    }
  }

  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, access_token: token }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Facebook API error: ${data.error.message}`);
  return {
    success: true,
    platformSupported: true,
    externalPostId: data.id,
    externalPostUrl: `https://facebook.com/${data.id}`,
  };
}

async function publishToInstagram(post: PostData, token: string, igUserId: string): Promise<PublishResult> {
  const caption = buildPostMessage(post);

  if (!post.mediaUrls || post.mediaUrls.length === 0) {
    throw new Error("Instagram requires at least one image or video. Please add media to your post.");
  }

  if (post.mediaUrls.length === 1) {
    const createRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: post.mediaUrls[0], caption, access_token: token }),
      signal: AbortSignal.timeout(30000),
    });
    const createData = await createRes.json();
    if (createData.error) throw new Error(`Instagram API error: ${createData.error.message}`);

    const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creation_id: createData.id, access_token: token }),
      signal: AbortSignal.timeout(30000),
    });
    const publishData = await publishRes.json();
    if (publishData.error) throw new Error(`Instagram publish error: ${publishData.error.message}`);

    return {
      success: true,
      platformSupported: true,
      externalPostId: publishData.id,
      externalPostUrl: `https://instagram.com/p/${publishData.id}`,
    };
  }

  const childIds: string[] = [];
  for (const url of post.mediaUrls) {
    const childRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: token }),
      signal: AbortSignal.timeout(30000),
    });
    const childData = await childRes.json();
    if (childData.error) throw new Error(`Instagram carousel error: ${childData.error.message}`);
    childIds.push(childData.id);
  }

  const carouselRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media_type: "CAROUSEL", children: childIds, caption, access_token: token }),
    signal: AbortSignal.timeout(30000),
  });
  const carouselData = await carouselRes.json();
  if (carouselData.error) throw new Error(`Instagram carousel create error: ${carouselData.error.message}`);

  const publishRes = await fetch(`https://graph.facebook.com/v19.0/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: carouselData.id, access_token: token }),
    signal: AbortSignal.timeout(30000),
  });
  const publishData = await publishRes.json();
  if (publishData.error) throw new Error(`Instagram publish error: ${publishData.error.message}`);

  return {
    success: true,
    platformSupported: true,
    externalPostId: publishData.id,
    externalPostUrl: `https://instagram.com/p/${publishData.id}`,
  };
}

async function publishToLinkedIn(post: PostData, token: string, authorUrn: string): Promise<PublishResult> {
  const text = buildPostMessage(post);

  const shareContent: any = {
    author: authorUrn.startsWith("urn:") ? authorUrn : `urn:li:organization:${authorUrn}`,
    lifecycleState: "PUBLISHED",
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        shareCommentary: { text },
        shareMediaCategory: "NONE",
      },
    },
    visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
  };

  if (post.mediaUrls && post.mediaUrls.length > 0) {
    shareContent.specificContent["com.linkedin.ugc.ShareContent"].shareMediaCategory = "ARTICLE";
    shareContent.specificContent["com.linkedin.ugc.ShareContent"].media = post.mediaUrls.map(url => ({
      status: "READY",
      originalUrl: url,
    }));
  }

  const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify(shareContent),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`LinkedIn API error: ${errorData.message || res.statusText}`);
  }

  const data = await res.json();
  const postId = data.id || res.headers.get("x-restli-id") || "";

  return {
    success: true,
    platformSupported: true,
    externalPostId: postId,
    externalPostUrl: postId ? `https://linkedin.com/feed/update/${postId}` : undefined,
  };
}

async function publishToTwitter(post: PostData, token: string): Promise<PublishResult> {
  const text = buildPostMessage(post);

  const res = await fetch("https://api.twitter.com/2/tweets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(`Twitter/X API error: ${errorData.detail || errorData.title || res.statusText}`);
  }

  const data = await res.json();
  const tweetId = data.data?.id;

  return {
    success: true,
    platformSupported: true,
    externalPostId: tweetId,
    externalPostUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined,
  };
}

async function publishToTikTok(post: PostData, token: string, accountId: string): Promise<PublishResult> {
  try {
    const mediaUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
    const isVideo = mediaUrl && /\.(mp4|mov|avi|webm)$/i.test(mediaUrl);

    if (isVideo) {
      const res = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: post.content.substring(0, 150),
            privacy_level: "SELF_ONLY",
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: mediaUrl,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json() as any;
      if (data.error?.code) {
        return { success: false, platformSupported: true, error: `TikTok API error: ${data.error.message || data.error.code}` };
      }
      return {
        success: true,
        platformSupported: true,
        externalPostId: data.data?.publish_id || undefined,
      };
    }

    const res = await fetch("https://open.tiktokapis.com/v2/post/publish/content/init/", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: post.content.substring(0, 150),
          description: buildPostMessage(post),
          privacy_level: "SELF_ONLY",
        },
        ...(mediaUrl ? {
          media_info: {
            images: {
              image_url_list: post.mediaUrls,
            },
          },
        } : {}),
      }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json() as any;
    if (data.error?.code) {
      return { success: false, platformSupported: true, error: `TikTok API error: ${data.error.message || data.error.code}` };
    }
    return {
      success: true,
      platformSupported: true,
      externalPostId: data.data?.publish_id || undefined,
    };
  } catch (err: any) {
    logError("TikTok publish error:", {}, err instanceof Error ? err : new Error(String(err)));
    return { success: false, platformSupported: true, error: err.message || "TikTok publishing failed" };
  }
}

// Exported (Task #1543) so the safeDownload integration can be exercised
// directly by the URL-fetcher test suite.
export async function publishToYouTube(post: PostData, token: string): Promise<PublishResult> {
  try {
    const mediaUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
    const isVideo = mediaUrl && /\.(mp4|mov|avi|webm)$/i.test(mediaUrl);

    if (isVideo) {
      const metadata = {
        snippet: {
          title: post.title || post.content.substring(0, 100),
          description: buildPostMessage(post),
          tags: post.hashtags || [],
        },
        status: {
          privacyStatus: "public",
        },
      };

      const initRes = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(30000),
      });

      if (!initRes.ok) {
        const errorData = await initRes.json().catch(() => ({})) as any;
        return { success: false, platformSupported: true, error: `YouTube API error: ${errorData.error?.message || initRes.statusText}` };
      }

      const uploadUrl = initRes.headers.get("location");
      if (!uploadUrl) {
        return { success: false, platformSupported: true, error: "YouTube did not return an upload URL" };
      }

      // Task #1498: route the user-supplied media URL through safeDownload
      // so SSRF, redirect re-validation, and a size cap apply before we
      // forward the payload to YouTube.
      const { safeDownload, SafeDownloadError } = await import("../services/safeDownload");
      let videoBuffer: Buffer;
      try {
        const result = await safeDownload({
          url: mediaUrl,
          timeoutMs: 60000,
          allowedContentTypes: null,
          maxBytes: 500 * 1024 * 1024,
        });
        videoBuffer = result.buffer;
      } catch (err: any) {
        const reason = err instanceof SafeDownloadError ? err.message : "Failed to fetch video from media URL for YouTube upload";
        return { success: false, platformSupported: true, error: reason };
      }

      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "video/*",
          "Content-Length": String(videoBuffer.byteLength),
        },
        body: videoBuffer,
        signal: AbortSignal.timeout(120000),
      });

      if (!uploadRes.ok) {
        const errorData = await uploadRes.json().catch(() => ({})) as any;
        return { success: false, platformSupported: true, error: `YouTube upload error: ${errorData.error?.message || uploadRes.statusText}` };
      }

      const uploadData = await uploadRes.json() as any;
      const videoId = uploadData.id;

      return {
        success: true,
        platformSupported: true,
        externalPostId: videoId,
        externalPostUrl: videoId ? `https://youtube.com/watch?v=${videoId}` : undefined,
      };
    }

    const bulletinBody = {
      snippet: {
        description: buildPostMessage(post),
      },
    };

    const res = await fetch("https://www.googleapis.com/youtube/v3/activities?part=snippet", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bulletinBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as any;
      return { success: false, platformSupported: true, error: `YouTube API error: ${errorData.error?.message || res.statusText}` };
    }

    const data = await res.json() as any;
    return {
      success: true,
      platformSupported: true,
      externalPostId: data.id || undefined,
      externalPostUrl: data.id ? `https://youtube.com/watch?v=${data.id}` : undefined,
    };
  } catch (err: any) {
    logError("YouTube publish error:", {}, err instanceof Error ? err : new Error(String(err)));
    return { success: false, platformSupported: true, error: err.message || "YouTube publishing failed" };
  }
}

async function publishToPinterest(post: PostData, token: string, boardId: string): Promise<PublishResult> {
  try {
    const mediaUrl = post.mediaUrls && post.mediaUrls.length > 0 ? post.mediaUrls[0] : null;
    const description = buildPostMessage(post);

    const pinBody: any = {
      board_id: boardId,
      title: post.title || post.content.substring(0, 100),
      description,
    };

    if (mediaUrl) {
      pinBody.media_source = {
        source_type: "image_url",
        url: mediaUrl,
      };
    } else {
      pinBody.media_source = {
        source_type: "image_url",
        url: "https://via.placeholder.com/600x600.png?text=Post",
      };
      pinBody.note = description;
    }

    const res = await fetch("https://api.pinterest.com/v5/pins", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pinBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as any;
      return { success: false, platformSupported: true, error: `Pinterest API error: ${errorData.message || res.statusText}` };
    }

    const data = await res.json() as any;
    return {
      success: true,
      platformSupported: true,
      externalPostId: data.id || undefined,
      externalPostUrl: data.id ? `https://pinterest.com/pin/${data.id}` : undefined,
    };
  } catch (err: any) {
    logError("Pinterest publish error:", {}, err instanceof Error ? err : new Error(String(err)));
    return { success: false, platformSupported: true, error: err.message || "Pinterest publishing failed" };
  }
}

function publishUnsupportedPlatform(platform: string): PublishResult {
  logError(`[Social Publish] Unsupported platform: ${platform} — publish rejected`, {});
  return {
    success: false,
    platformSupported: false,
    error: `${platform} is not a supported publishing platform. Please contact support or check for updates.`,
  };
}

function buildPostMessage(post: PostData): string {
  let message = post.content;
  if (post.hashtags && post.hashtags.length > 0) {
    const tags = post.hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ");
    message = `${message}\n\n${tags}`;
  }
  return message;
}

export async function publishToPlatform(post: PostData, account: AccountData): Promise<PublishResult> {
  if (!account.accessTokenEncrypted) {
    throw new Error("No access token configured for this account. Please update your account credentials.");
  }

  const token = decrypt(account.accessTokenEncrypted);
  if (!token) {
    throw new Error("Failed to decrypt access token. The token may be corrupted — please reconnect the account.");
  }

  const platform = account.platform;
  const accountId = account.accountId || "";

  switch (platform) {
    case "FACEBOOK":
      if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET) {
        return { success: false, platformSupported: true, error: "Facebook API credentials not configured. Set FB_APP_ID and FB_APP_SECRET environment variables." };
      }
      if (!accountId) throw new Error("Facebook Page ID is required. Please update your account settings.");
      return publishToFacebook(post, token, accountId);

    case "INSTAGRAM":
      if (!process.env.FB_APP_ID || !process.env.FB_APP_SECRET) {
        return { success: false, platformSupported: true, error: "Instagram (Facebook) API credentials not configured. Set FB_APP_ID and FB_APP_SECRET environment variables." };
      }
      if (!accountId) throw new Error("Instagram Business Account ID is required. Please update your account settings.");
      return publishToInstagram(post, token, accountId);

    case "LINKEDIN":
      if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
        return { success: false, platformSupported: true, error: "LinkedIn API credentials not configured. Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET environment variables." };
      }
      if (!accountId) throw new Error("LinkedIn Organization URN or ID is required. Please update your account settings.");
      return publishToLinkedIn(post, token, accountId);

    case "TWITTER":
      if (!process.env.TWITTER_CLIENT_ID || !process.env.TWITTER_CLIENT_SECRET) {
        return { success: false, platformSupported: true, error: "Twitter/X API credentials not configured. Set TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET environment variables." };
      }
      return publishToTwitter(post, token);

    case "TIKTOK":
      if (!process.env.TIKTOK_CLIENT_ID) {
        return { success: false, platformSupported: true, error: "TikTok API credentials not configured. Set TIKTOK_CLIENT_ID environment variable." };
      }
      return publishToTikTok(post, token, accountId);

    case "YOUTUBE":
      if (!process.env.YOUTUBE_CLIENT_ID) {
        return { success: false, platformSupported: true, error: "YouTube API credentials not configured. Set YOUTUBE_CLIENT_ID environment variable." };
      }
      return publishToYouTube(post, token);

    case "PINTEREST":
      if (!process.env.PINTEREST_APP_ID) {
        return { success: false, platformSupported: true, error: "Pinterest API credentials not configured. Set PINTEREST_APP_ID environment variable." };
      }
      if (!accountId) throw new Error("Pinterest Board ID is required. Please update your account settings.");
      return publishToPinterest(post, token, accountId);

    default:
      return publishUnsupportedPlatform(platform);
  }
}

export interface EngagementData {
  likes: number;
  comments: number;
  shares: number;
  reach: number;
  impressions: number;
  clicks: number;
}

export async function fetchEngagement(
  post: { externalPostId: string; platform: string | null },
  account: AccountData
): Promise<EngagementData | null> {
  if (!account.accessTokenEncrypted) return null;

  const token = decrypt(account.accessTokenEncrypted);
  if (!token) return null;

  const platform = account.platform;
  const postId = post.externalPostId;

  try {
    switch (platform) {
      case "FACEBOOK": {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${postId}?fields=likes.summary(true),comments.summary(true),shares&access_token=${token}`,
          { signal: AbortSignal.timeout(15000) }
        );
        const data = await res.json();
        if (data.error) {
          logError("Facebook engagement fetch failed", { postId, error: data.error.message });
          return null;
        }
        return {
          likes: data.likes?.summary?.total_count || 0,
          comments: data.comments?.summary?.total_count || 0,
          shares: data.shares?.count || 0,
          reach: 0,
          impressions: 0,
          clicks: 0,
        };
      }

      case "INSTAGRAM": {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/${postId}?fields=like_count,comments_count,reach,impressions&access_token=${token}`,
          { signal: AbortSignal.timeout(15000) }
        );
        const data = await res.json();
        if (data.error) {
          logError("Instagram engagement fetch failed", { postId, error: data.error.message });
          return null;
        }
        return {
          likes: data.like_count || 0,
          comments: data.comments_count || 0,
          shares: 0,
          reach: data.reach || 0,
          impressions: data.impressions || 0,
          clicks: 0,
        };
      }

      case "TWITTER": {
        const res = await fetch(
          `https://api.twitter.com/2/tweets/${postId}?tweet.fields=public_metrics`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          }
        );
        const data = await res.json();
        if (!res.ok || !data.data) {
          logError("Twitter engagement fetch failed", { postId, status: res.status });
          return null;
        }
        const metrics = data.data.public_metrics || {};
        return {
          likes: metrics.like_count || 0,
          comments: metrics.reply_count || 0,
          shares: metrics.retweet_count || 0,
          reach: 0,
          impressions: metrics.impression_count || 0,
          clicks: 0,
        };
      }

      case "LINKEDIN": {
        const shareUrn = postId.startsWith("urn:") ? postId : `urn:li:share:${postId}`;
        const res = await fetch(
          `https://api.linkedin.com/v2/socialActions/${encodeURIComponent(shareUrn)}/totalShareStatistics`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "X-Restli-Protocol-Version": "2.0.0",
            },
            signal: AbortSignal.timeout(15000),
          }
        );
        if (!res.ok) {
          logError("LinkedIn engagement fetch failed", { postId, status: res.status });
          return null;
        }
        const data = await res.json();
        const totalStats = data.totalShareStatistics || {};
        return {
          likes: totalStats.likeCount || 0,
          comments: totalStats.commentCount || 0,
          shares: totalStats.shareCount || 0,
          reach: totalStats.uniqueImpressionsCount || 0,
          impressions: totalStats.impressionCount || 0,
          clicks: totalStats.clickCount || 0,
        };
      }

      default:
        return null;
    }
  } catch (err) {
    logError("Engagement fetch error", { postId, platform }, err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

export async function validateToken(platform: string, token: string, accountId?: string): Promise<{ valid: boolean; error?: string }> {
  try {
    switch (platform) {
      case "FACEBOOK": {
        const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`, {
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        return data.error ? { valid: false, error: data.error.message } : { valid: true };
      }
      case "INSTAGRAM": {
        const res = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`, {
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        return data.error ? { valid: false, error: data.error.message } : { valid: true };
      }
      case "LINKEDIN": {
        const res = await fetch("https://api.linkedin.com/v2/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      case "TWITTER": {
        const res = await fetch("https://api.twitter.com/2/users/me", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      case "TIKTOK": {
        const res = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as any;
        return data.error?.code ? { valid: false, error: data.error.message || `Error code: ${data.error.code}` } : { valid: true };
      }
      case "YOUTUBE": {
        const res = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      case "PINTEREST": {
        const res = await fetch("https://api.pinterest.com/v5/user_account", {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        return res.ok ? { valid: true } : { valid: false, error: `HTTP ${res.status}` };
      }
      default:
        return { valid: true };
    }
  } catch (err: any) {
    return { valid: false, error: err.message || "Token validation failed" };
  }
}

export async function refreshToken(
  platform: string,
  refreshTokenEncrypted: string,
  clientId?: string,
  clientSecret?: string
): Promise<{ accessToken: string; expiresIn?: number } | null> {
  const refreshTkn = decrypt(refreshTokenEncrypted);
  if (!refreshTkn) return null;

  try {
    switch (platform) {
      case "FACEBOOK": {
        const res = await fetch(
          `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${clientId}&client_secret=${clientSecret}&fb_exchange_token=${refreshTkn}`,
          { signal: AbortSignal.timeout(10000) }
        );
        const data = await res.json();
        if (data.error) return null;
        return { accessToken: data.access_token, expiresIn: data.expires_in };
      }
      case "LINKEDIN": {
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshTkn,
          client_id: clientId || "",
          client_secret: clientSecret || "",
        });
        const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json();
        if (data.error) return null;
        return { accessToken: data.access_token, expiresIn: data.expires_in };
      }
      case "TIKTOK": {
        const params = new URLSearchParams({
          client_key: clientId || "",
          client_secret: clientSecret || "",
          grant_type: "refresh_token",
          refresh_token: refreshTkn,
        });
        const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as any;
        if (!data.access_token) return null;
        return { accessToken: data.access_token, expiresIn: data.expires_in };
      }
      case "YOUTUBE": {
        const params = new URLSearchParams({
          client_id: clientId || "",
          client_secret: clientSecret || "",
          grant_type: "refresh_token",
          refresh_token: refreshTkn,
        });
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as any;
        if (!data.access_token) return null;
        return { accessToken: data.access_token, expiresIn: data.expires_in };
      }
      case "PINTEREST": {
        const credentials = "Basic " + Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
        const params = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refreshTkn,
        });
        const res = await fetch("https://api.pinterest.com/v5/oauth/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: credentials,
          },
          body: params.toString(),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json() as any;
        if (!data.access_token) return null;
        return { accessToken: data.access_token, expiresIn: data.expires_in };
      }
      default:
        return null;
    }
  } catch {
    logWarn("Non-critical operation failed");
    return null;
  }
}
