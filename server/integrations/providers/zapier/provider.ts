import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo } from "../../../utils/logger";
import crypto from "crypto";

export const zapierProvider: IntegrationProvider = {
  key: "zapier",
  displayName: "Zapier",
  authType: "apiKey",
  requiredScopes: [],
  featureFlag: "INTEGRATION_ZAPIER",

  getAuthUrl(_connectionId: string, _redirectUri: string, _state: string): string {
    return "";
  },

  async handleCallback(_code: string, _state: string): Promise<TokenSet> {
    return {
      accessToken: "",
      tokenType: "apiKey",
    };
  },

  async refreshToken(_connection: IntegrationConnection): Promise<TokenSet> {
    return {
      accessToken: "",
      tokenType: "apiKey",
    };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const metadata = (connection.metadata as Record<string, any>) || {};
    if (metadata.apiKey) {
      return { ok: true, message: "Zapier webhook integration is configured" };
    }
    return { ok: true, message: "Zapier connection active (webhook-based)" };
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("Zapier connection disconnected");
  },
};

export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function signZapierPayload(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export async function deliverZapierWebhook(
  webhookUrl: string,
  eventType: string,
  data: Record<string, any>,
  secret: string
): Promise<{ ok: boolean; status: number }> {
  const payload = JSON.stringify({
    event: eventType,
    data,
    timestamp: new Date().toISOString(),
    source: "smartmanage-ai",
  });

  const signature = signZapierPayload(payload, secret);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SmartManage-Signature": signature,
        "X-SmartManage-Event": eventType,
        "X-SmartManage-Timestamp": new Date().toISOString(),
      },
      body: payload,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { ok: response.ok, status: response.status };
  } catch (err) {
    clearTimeout(timeout);
    return { ok: false, status: 0 };
  }
}
