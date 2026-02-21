import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";

const QBO_AUTH_BASE = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

export const qboProvider: IntegrationProvider = {
  key: "qbo",
  displayName: "QuickBooks Online",
  authType: "oauth",
  requiredScopes: ["com.intuit.quickbooks.accounting"],
  featureFlag: "INTEGRATION_QBO",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.QBO_CLIENT_ID || "";
    const scope = "com.intuit.quickbooks.accounting";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope,
      redirect_uri: redirectUri,
      state,
    });
    return `${QBO_AUTH_BASE}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.QBO_CLIENT_ID || "";
    const clientSecret = process.env.QBO_CLIENT_SECRET || "";
    
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    const redirectUri = stateData.redirectUri || "";

    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(QBO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basicAuth}`,
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        logError("QBO token exchange failed", { status: response.status, body: errText });
        throw new Error(`QBO token exchange failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scope: data.scope || "",
        tokenType: data.token_type || "Bearer",
        raw: { realmId: data.realmId || stateData.realmId },
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const clientId = process.env.QBO_CLIENT_ID || "";
    const clientSecret = process.env.QBO_CLIENT_SECRET || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const metadata = connection.metadata as Record<string, any> || {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(QBO_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basicAuth}`,
          "Accept": "application/json",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: metadata.refreshToken || "",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`QBO token refresh failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type || "Bearer",
        raw: { realmId: metadata.realmId },
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    try {
      const metadata = connection.metadata as Record<string, any> || {};
      const realmId = metadata.realmId;
      if (!realmId) return { ok: false, message: "No realm ID found" };

      const baseUrl = process.env.QBO_ENVIRONMENT === "production"
        ? "https://quickbooks.api.intuit.com"
        : "https://sandbox-quickbooks.api.intuit.com";

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`, {
        headers: {
          "Authorization": `Bearer ${metadata.accessToken || ""}`,
          "Accept": "application/json",
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        return { ok: true, message: "Connected to QuickBooks Online" };
      }
      return { ok: false, message: `QBO API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("QBO connection disconnected");
  },
};
