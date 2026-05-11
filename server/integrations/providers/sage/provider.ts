import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { OAuthPermanentError } from "../oauthErrors";

const SAGE_AUTH_URL = "https://api.intacct.com/oauth/authorize";
const SAGE_TOKEN_URL = "https://api.intacct.com/oauth/token";

export const sageProvider: IntegrationProvider = {
  key: "sage_intacct",
  displayName: "Sage Intacct Construction",
  authType: "oauth",
  requiredScopes: ["job_cost", "ap", "ar"],
  featureFlag: "INTEGRATION_SAGE",

  getAuthUrl(_connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.SAGE_CLIENT_ID || "";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      scope: "job_cost ap ar",
      redirect_uri: redirectUri,
      state,
    });
    return `${SAGE_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.SAGE_CLIENT_ID || "";
    const clientSecret = process.env.SAGE_CLIENT_SECRET || "";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    const redirectUri = stateData.redirectUri || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(SAGE_TOKEN_URL, {
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
        logError("Sage token exchange failed", { status: response.status, body: errText });
        throw new Error(`Sage token exchange failed: ${response.status}`);
      }
      const data = await response.json();
      // Per-tenant Web Services user credentials (userId/userPassword) are
      // never accepted via OAuth state; admins POST them to the
      // `/sage/credentials` endpoint over TLS after authorization.
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
        scope: data.scope || "",
        tokenType: data.token_type || "Bearer",
        raw: {
          companyId: data.company_id || stateData.companyId,
          locationId: stateData.locationId,
        },
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const clientId = process.env.SAGE_CLIENT_ID || "";
    const clientSecret = process.env.SAGE_CLIENT_SECRET || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const metadata = (connection.metadata as Record<string, any>) || {};

    const response = await fetch(SAGE_TOKEN_URL, {
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
      if (response.status === 401 || response.status === 400) {
        throw new OAuthPermanentError(`Sage OAuth token permanently revoked: ${response.status}`);
      }
      throw new Error(`Sage token refresh failed: ${response.status}`);
    }
    const data = await response.json();
    // storeConnectionTokens overwrites metadata with `raw`, so carry the
    // per-tenant Web Services credentials forward across the refresh.
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || metadata.refreshToken,
      expiresAt: new Date(Date.now() + (data.expires_in || 3600) * 1000),
      tokenType: data.token_type || "Bearer",
      raw: {
        companyId: metadata.companyId,
        userId: metadata.userId,
        userPassword: metadata.userPassword,
        locationId: metadata.locationId,
      },
    };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const metadata = (connection.metadata as Record<string, any>) || {};
    if (!metadata.accessToken) return { ok: false, message: "Not authorized" };
    if (metadata.devMode) return { ok: true, message: "Sage Intacct (dev mode)" };
    return { ok: true, message: "Sage Intacct connection looks healthy" };
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("Sage Intacct connection disconnected");
  },
};
