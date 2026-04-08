export interface IntegrationStatus {
  livekit: boolean;
  twilio: boolean;
  openai: boolean;
  sendgrid: boolean;
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
  };
}
