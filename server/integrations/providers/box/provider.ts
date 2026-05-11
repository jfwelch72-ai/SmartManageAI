import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { OAuthPermanentError } from "../oauthErrors";

const BOX_AUTH_URL = "https://account.box.com/api/oauth2/authorize";
const BOX_TOKEN_URL = "https://api.box.com/oauth2/token";
const BOX_REVOKE_URL = "https://api.box.com/oauth2/revoke";
const BOX_USER_URL = "https://api.box.com/2.0/users/me";

export const boxProvider: IntegrationProvider = {
  key: "box",
  displayName: "Box",
  authType: "oauth",
  requiredScopes: ["root_readonly"],
  featureFlag: "INTEGRATION_BOX",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.BOX_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
    });
    return `${BOX_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.BOX_CLIENT_ID || "";
    const clientSecret = process.env.BOX_CLIENT_SECRET || "";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(BOX_TOKEN_URL, {
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
        logError("Box token exchange failed", { status: response.status });
        throw new Error(`Box token exchange failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
        scope: data.scope,
        tokenType: data.token_type,
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const clientId = process.env.BOX_CLIENT_ID || "";
    const clientSecret = process.env.BOX_CLIENT_SECRET || "";
    const metadata = (connection.metadata as Record<string, any>) || {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(BOX_TOKEN_URL, {
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
          throw new OAuthPermanentError(`Box OAuth token permanently revoked: ${response.status}`);
        }
        throw new Error(`Box token refresh failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || metadata.refreshToken,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
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

      const response = await fetch(BOX_USER_URL, {
        headers: { Authorization: `Bearer ${metadata.accessToken || ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok
        ? { ok: true, message: "Connected to Box" }
        : { ok: false, message: `Box API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(connection: IntegrationConnection): Promise<void> {
    try {
      const metadata = (connection.metadata as Record<string, any>) || {};
      const clientId = process.env.BOX_CLIENT_ID || "";
      const clientSecret = process.env.BOX_CLIENT_SECRET || "";
      if (metadata.accessToken) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        await fetch(BOX_REVOKE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            token: metadata.accessToken,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
      }
    } catch (err) {
      logError("Box token revocation failed", { error: String(err) });
    }
    logInfo("Box connection disconnected");
  },
};
