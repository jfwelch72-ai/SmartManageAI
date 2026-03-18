import { logError, logInfo } from "../utils/logger";

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";

const E164_RE = /^\+[1-9]\d{1,14}$/;

export function isValidE164(phone: string): boolean {
  return E164_RE.test(phone);
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return;
  }

  if (!isValidE164(to)) {
    logError("smsService: invalid E.164 number", { to });
    return;
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      logError("smsService: Twilio API error", { status: res.status, to, body: errBody });
    } else {
      logInfo("smsService: SMS sent", { to });
    }
  } catch (err) {
    logError("smsService: fetch failed", { to, error: String(err) });
  }
}
