import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";

const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const ONEDRIVE_ME_URL = "https://graph.microsoft.com/v1.0/me/drive";

export const onedriveProvider: IntegrationProvider = {
  key: "onedrive",
  displayName: "OneDrive",
  authType: "oauth",
  requiredScopes: ["Files.Read", "offline_access"],
  featureFlag: "INTEGRATION_ONEDRIVE",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: this.requiredScopes.join(" "),
      redirect_uri: redirectUri,
      state,
      response_mode: "query",
    });
    return `${MICROSOFT_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "";
    const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || "";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(MICROSOFT_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: stateData.redirectUri || "",
          grant_type: "authorization_code",
          scope: "Files.Read offline_access",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        logError("OneDrive token exchange failed", { status: response.status });
        throw new Error(`OneDrive token exchange failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        scope: data.scope,
        tokenType: data.token_type,
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const clientId = process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "";
    const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET || process.env.MICROSOFT_CLIENT_SECRET || "";
    const metadata = (connection.metadata as Record<string, any>) || {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(MICROSOFT_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: metadata.refreshToken || "",
          grant_type: "refresh_token",
          scope: "Files.Read offline_access",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`OneDrive token refresh failed: ${response.status}`);

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || metadata.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    try {
      const metadata = (connection.metadata as Record<string, any>) || {};
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(ONEDRIVE_ME_URL, {
        headers: { Authorization: `Bearer ${metadata.accessToken || ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok
        ? { ok: true, message: "Connected to OneDrive" }
        : { ok: false, message: `OneDrive API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("OneDrive connection disconnected");
  },
};
