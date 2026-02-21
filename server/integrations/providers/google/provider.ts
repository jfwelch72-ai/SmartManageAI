import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const googleProvider: IntegrationProvider = {
  key: "google",
  displayName: "Google Workspace",
  authType: "oauth",
  requiredScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/calendar"],
  featureFlag: "INTEGRATION_GOOGLE",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: this.requiredScopes.join(" "),
      redirect_uri: redirectUri,
      state,
      access_type: "offline",
      prompt: "consent",
    });
    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: stateData.redirectUri || "",
          grant_type: "authorization_code",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errText = await response.text();
        logError("Google token exchange failed", { status: response.status });
        throw new Error(`Google token exchange failed: ${response.status}`);
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
    const clientId = process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
    const metadata = connection.metadata as Record<string, any> || {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: metadata.refreshToken || "",
          grant_type: "refresh_token",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) throw new Error(`Google token refresh failed: ${response.status}`);

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: metadata.refreshToken,
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
      const metadata = connection.metadata as Record<string, any> || {};
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch("https://www.googleapis.com/gmail/v1/users/me/profile", {
        headers: { "Authorization": `Bearer ${metadata.accessToken || ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok
        ? { ok: true, message: "Connected to Google Workspace" }
        : { ok: false, message: `Google API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("Google connection disconnected");
  },
};
