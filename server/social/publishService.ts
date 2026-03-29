import { logWarn } from "../utils/logger";
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

function publishStub(platform: string): PublishResult {
  console.log(`[Social Publish] ${platform} publishing is not yet supported — post was marked as published locally only.`);
  return {
    success: true,
    platformSupported: false,
    error: `${platform} API publishing is not yet available. Post saved as published locally.`,
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
      if (!accountId) throw new Error("Facebook Page ID is required. Please update your account settings.");
      return publishToFacebook(post, token, accountId);

    case "INSTAGRAM":
      if (!accountId) throw new Error("Instagram Business Account ID is required. Please update your account settings.");
      return publishToInstagram(post, token, accountId);

    case "LINKEDIN":
      if (!accountId) throw new Error("LinkedIn Organization URN or ID is required. Please update your account settings.");
      return publishToLinkedIn(post, token, accountId);

    case "TWITTER":
      return publishToTwitter(post, token);

    case "TIKTOK":
      return publishStub("TikTok");

    case "YOUTUBE":
      return publishStub("YouTube");

    case "PINTEREST":
      return publishStub("Pinterest");

    default:
      return publishStub(platform);
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
      default:
        return null;
    }
  } catch {
    logWarn("Non-critical operation failed");
    return null;
  }
}
