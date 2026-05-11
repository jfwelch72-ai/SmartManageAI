import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { OAuthPermanentError } from "../oauthErrors";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_DRIVE_ABOUT_URL = "https://www.googleapis.com/drive/v3/about?fields=user";

export const gdriveProvider: IntegrationProvider = {
  key: "gdrive",
  displayName: "Google Drive",
  authType: "oauth",
  requiredScopes: ["https://www.googleapis.com/auth/drive.readonly"],
  featureFlag: "INTEGRATION_GDRIVE",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.GDRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
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
    const clientId = process.env.GDRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.GDRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
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
        logError("Google Drive token exchange failed", { status: response.status });
        throw new Error(`Google Drive token exchange failed: ${response.status}`);
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
    const clientId = process.env.GDRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = process.env.GDRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
    const metadata = (connection.metadata as Record<string, any>) || {};

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

      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          const errBody = await response.text();
          if (/invalid_grant|invalid_client|Token has been expired or revoked/i.test(errBody)) {
            throw new OAuthPermanentError(`Google Drive OAuth token permanently revoked: ${response.status} ${errBody.substring(0, 150)}`);
          }
        }
        throw new Error(`Google Drive token refresh failed: ${response.status}`);
      }

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
      const metadata = (connection.metadata as Record<string, any>) || {};
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(GOOGLE_DRIVE_ABOUT_URL, {
        headers: { Authorization: `Bearer ${metadata.accessToken || ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok
        ? { ok: true, message: "Connected to Google Drive" }
        : { ok: false, message: `Google Drive API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(connection: IntegrationConnection): Promise<void> {
    try {
      const metadata = (connection.metadata as Record<string, any>) || {};
      if (metadata.accessToken) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        await fetch(`${GOOGLE_REVOKE_URL}?token=${metadata.accessToken}`, {
          method: "POST",
          signal: controller.signal,
        });
        clearTimeout(timeout);
      }
    } catch (err) {
      logError("Google Drive token revocation failed", { error: String(err) });
    }
    logInfo("Google Drive connection disconnected");
  },
};
