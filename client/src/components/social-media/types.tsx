import { SiFacebook, SiInstagram, SiLinkedin, SiYoutube, SiTiktok, SiPinterest } from "react-icons/si";

export interface SocialPost {
  id: string;
  title: string | null;
  content: string;
  platform: string | null;
  platforms: string[] | null;
  status: string;
  mediaUrls: string[] | null;
  hashtags: string[] | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  campaignTag: string | null;
  tone: string | null;
  notes: string | null;
  isRecurring: boolean;
  recurringPattern: any;
  aiGenerated: boolean;
  socialAccountId: string | null;
  externalPostUrl: string | null;
  rejectionReason: string | null;
  approvalStatus: string | null;
  lastError: string | null;
  warning?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialAccount {
  id: string;
  platform: string;
  accountName: string | null;
  status: string;
  profileImageUrl: string | null;
  lastSyncAt: string | null;
}

export const PLATFORMS = [
  { value: "FACEBOOK", label: "Facebook", icon: SiFacebook, color: "#1877F2" },
  { value: "INSTAGRAM", label: "Instagram", icon: SiInstagram, color: "#E4405F" },
  { value: "LINKEDIN", label: "LinkedIn", icon: SiLinkedin, color: "#0A66C2" },
  { value: "TWITTER", label: "X (Twitter)", icon: () => <span className="font-bold text-sm">𝕏</span>, color: "#000000" },
  { value: "TIKTOK", label: "TikTok", icon: SiTiktok, color: "#000000" },
  { value: "YOUTUBE", label: "YouTube", icon: SiYoutube, color: "#FF0000" },
  { value: "PINTEREST", label: "Pinterest", icon: SiPinterest, color: "#BD081C" },
];

export const CHAR_LIMITS: Record<string, number> = {
  TWITTER: 280,
  LINKEDIN: 1300,
  INSTAGRAM: 2200,
  FACEBOOK: 63206,
  TIKTOK: 2200,
  YOUTUBE: 5000,
  PINTEREST: 500,
};

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  PENDING_APPROVAL: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  APPROVED: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  SCHEDULED: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  QUEUED: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  POSTED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

export function getPlatformInfo(platform: string) {
  return PLATFORMS.find(p => p.value === platform) || PLATFORMS[0];
}
