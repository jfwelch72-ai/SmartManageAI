import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { OAuthPermanentError } from "../oauthErrors";

const AUTODESK_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/authorize";
const AUTODESK_TOKEN_URL = "https://developer.api.autodesk.com/authentication/v2/token";

export const autodeskProvider: IntegrationProvider = {
  key: "autodesk",
  displayName: "Autodesk Construction Cloud",
  authType: "oauth",
  requiredScopes: ["data:read", "data:write", "account:read"],
  featureFlag: "INTEGRATION_AUTODESK",

  getAuthUrl(_connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.AUTODESK_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "data:read data:write data:create account:read user-profile:read",
      redirect_uri: redirectUri,
      state,
    });
    return `${AUTODESK_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.AUTODESK_CLIENT_ID || "";
    const clientSecret = process.env.AUTODESK_CLIENT_SECRET || "";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    const redirectUri = stateData.redirectUri || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(AUTODESK_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basicAuth}`,
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
        logError("Autodesk token exchange failed", { status: response.status, body: errText });
        throw new Error(`Autodesk token exchange failed: ${response.status}`);
      }
      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        scope: data.scope || "",
        tokenType: data.token_type || "Bearer",
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const clientId = process.env.AUTODESK_CLIENT_ID || "";
    const clientSecret = process.env.AUTODESK_CLIENT_SECRET || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const metadata = (connection.metadata as Record<string, any>) || {};
    const response = await fetch(AUTODESK_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: metadata.refreshToken || "",
      }),
    });
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      if (response.status === 401 || (response.status === 400 && /invalid_grant|invalid_token/i.test(errBody))) {
        throw new OAuthPermanentError(`Autodesk OAuth token permanently revoked: ${response.status} ${errBody.substring(0, 150)}`);
      }
      throw new Error(`Autodesk token refresh failed: ${response.status}`);
    }
    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || metadata.refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      tokenType: data.token_type || "Bearer",
    };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const metadata = (connection.metadata as Record<string, any>) || {};
    if (!metadata.accessToken) return { ok: false, message: "Not authorized" };
    if (metadata.devMode) return { ok: true, message: "Autodesk Construction Cloud (dev mode)" };
    try {
      const res = await fetch("https://developer.api.autodesk.com/userprofile/v1/users/@me", {
        headers: { Authorization: `Bearer ${metadata.accessToken}` },
      });
      if (res.ok) return { ok: true, message: "Connected to Autodesk Construction Cloud" };
      return { ok: false, message: `Autodesk API returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("Autodesk connection disconnected");
  },
};
