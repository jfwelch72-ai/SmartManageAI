import twilio from "twilio";
import { logError, logInfo } from "../utils/logger";


const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";

const E164_RE = /^\+[1-9]\d{1,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone);
}

export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER);
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!isTwilioConfigured()) {
    logInfo("smsService: Twilio not configured, skipping SMS", { to: to.slice(0, 4) + "***" });
    return;
  }

  if (!isValidE164(to)) {
    logError("smsService: invalid E.164 number", { to });
    return;
  }

  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await client.messages.create({ to, from: TWILIO_FROM_NUMBER, body });
    logInfo("smsService: SMS sent", { to });
  } catch (err) {
    logError("smsService: Twilio error", { to, error: String(err) });
  }
}
