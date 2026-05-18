export interface IntegrationStatus {
  livekit: boolean;
  twilio: boolean;
  openai: boolean;
  sendgrid: boolean;
  social_facebook: boolean;
  social_linkedin: boolean;
  social_twitter: boolean;
  social_tiktok: boolean;
  social_youtube: boolean;
  social_pinterest: boolean;
}

export function getIntegrationStatus(): IntegrationStatus {
  return {
    livekit: !!(
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET &&
      process.env.LIVEKIT_URL
    ),
    twilio: !!(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_FROM_NUMBER
    ),
    openai: !!(
      process.env.AI_INTEGRATIONS_OPENAI_API_KEY ||
      process.env.OPENAI_API_KEY
    ),
    sendgrid: !!(
      process.env.SENDGRID_API_KEY
    ),
    social_facebook: !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET),
    social_linkedin: !!(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
    social_twitter: !!(process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET),
    social_tiktok: !!process.env.TIKTOK_CLIENT_ID,
    social_youtube: !!process.env.YOUTUBE_CLIENT_ID,
    social_pinterest: !!process.env.PINTEREST_APP_ID,
  };
}

export function isSocialPlatformConfigured(platform: string): boolean {
  const status = getIntegrationStatus();
  const map: Record<string, boolean> = {
    FACEBOOK: status.social_facebook,
    INSTAGRAM: status.social_facebook,
    LINKEDIN: status.social_linkedin,
    TWITTER: status.social_twitter,
    TIKTOK: status.social_tiktok,
    YOUTUBE: status.social_youtube,
    PINTEREST: status.social_pinterest,
  };
  return map[platform.toUpperCase()] ?? false;
}
