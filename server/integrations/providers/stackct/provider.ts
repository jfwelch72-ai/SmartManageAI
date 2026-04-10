import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { testApiConnection } from "./client";

const STACKCT_TOKEN_URL = "https://api.stackct.com/oauth/token";

export async function acquireTokenWithCredentials(
  clientId: string,
  clientSecret: string
): Promise<TokenSet> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(STACKCT_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      logError("STACK CT token exchange failed", { status: response.status, body: errText });
      throw new Error(`STACK CT token exchange failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || undefined,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      scope: data.scope || "projects files takeoffs",
      tokenType: data.token_type || "Bearer",
      raw: { clientId },
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

export const stackctProvider: IntegrationProvider = {
  key: "stackct",
  displayName: "STACK CT",
  authType: "manual",
  requiredScopes: ["projects", "files", "takeoffs"],
  featureFlag: "INTEGRATION_STACKCT",

  getAuthUrl(_connectionId: string, _redirectUri: string, _state: string): string {
    return "";
  },

  async handleCallback(_code: string, _state: string): Promise<TokenSet> {
    throw new Error("STACK CT uses manual credential flow, not OAuth callback");
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const metadata = (connection.metadata as Record<string, any>) || {};
    const clientId = metadata.clientId;
    const clientSecret = metadata.clientSecret;

    if (!clientId || !clientSecret) {
      throw new Error("Missing STACK CT client credentials for token refresh");
    }

    return acquireTokenWithCredentials(clientId, clientSecret);
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    try {
      const metadata = (connection.metadata as Record<string, any>) || {};
      const accessToken = metadata.accessToken;
      if (!accessToken) return { ok: false, message: "No access token found" };
      return testApiConnection(accessToken);
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("STACK CT connection disconnected");
  },
};
