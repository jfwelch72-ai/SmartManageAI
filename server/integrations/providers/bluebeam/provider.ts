import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";

const BLUEBEAM_AUTH_URL = "https://authentication.bluebeam.com/oauth2/v1/authorize";
const BLUEBEAM_TOKEN_URL = "https://authentication.bluebeam.com/oauth2/v1/token";

export const bluebeamProvider: IntegrationProvider = {
  key: "bluebeam",
  displayName: "Bluebeam Studio",
  authType: "oauth",
  requiredScopes: ["full_user", "full_studio"],
  featureFlag: "INTEGRATION_BLUEBEAM",

  getAuthUrl(_connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.BLUEBEAM_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "full_user full_studio offline_access jobs",
      redirect_uri: redirectUri,
      state,
    });
    return `${BLUEBEAM_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.BLUEBEAM_CLIENT_ID || "";
    const clientSecret = process.env.BLUEBEAM_CLIENT_SECRET || "";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    const redirectUri = stateData.redirectUri || "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(BLUEBEAM_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          client_id: clientId,
          client_secret: clientSecret,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (!response.ok) {
        const errText = await response.text();
        logError("Bluebeam token exchange failed", { status: response.status, body: errText });
        throw new Error(`Bluebeam token exchange failed: ${response.status}`);
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
    const clientId = process.env.BLUEBEAM_CLIENT_ID || "";
    const clientSecret = process.env.BLUEBEAM_CLIENT_SECRET || "";
    const metadata = (connection.metadata as Record<string, any>) || {};
    const response = await fetch(BLUEBEAM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: metadata.refreshToken || "",
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!response.ok) throw new Error(`Bluebeam token refresh failed: ${response.status}`);
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
    if (metadata.devMode) return { ok: true, message: "Bluebeam Studio (dev mode)" };
    try {
      const res = await fetch("https://studioapi.bluebeam.com/publicapi/v1/users/me", {
        headers: { Authorization: `Bearer ${metadata.accessToken}` },
      });
      if (res.ok) return { ok: true, message: "Connected to Bluebeam Studio" };
      return { ok: false, message: `Bluebeam API returned ${res.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("Bluebeam connection disconnected");
  },
};
