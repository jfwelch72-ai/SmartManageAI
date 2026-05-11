import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { OAuthPermanentError } from "../oauthErrors";

const DOCUSIGN_AUTH_URL = "https://account-d.docusign.com/oauth/auth";
const DOCUSIGN_TOKEN_URL = "https://account-d.docusign.com/oauth/token";

export interface ESignEnvelope {
  envelopeId: string;
  status: "created" | "sent" | "delivered" | "signed" | "completed" | "declined" | "voided";
}

export interface ESignRecipient {
  email: string;
  name: string;
  routingOrder?: number;
}

export const esignProvider: IntegrationProvider = {
  key: "docusign",
  displayName: "DocuSign",
  authType: "oauth",
  requiredScopes: ["signature", "impersonation"],
  featureFlag: "INTEGRATION_ESIGN",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.DOCUSIGN_CLIENT_ID || "";
    const params = new URLSearchParams({
      response_type: "code",
      scope: "signature",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
    });
    return `${DOCUSIGN_AUTH_URL}?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.DOCUSIGN_CLIENT_ID || "";
    const clientSecret = process.env.DOCUSIGN_CLIENT_SECRET || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(DOCUSIGN_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        logError("DocuSign token exchange failed", { status: response.status });
        throw new Error(`DocuSign token exchange failed: ${response.status}`);
      }

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  },

  async refreshToken(connection: IntegrationConnection): Promise<TokenSet> {
    const clientId = process.env.DOCUSIGN_CLIENT_ID || "";
    const clientSecret = process.env.DOCUSIGN_CLIENT_SECRET || "";
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    const metadata = connection.metadata as Record<string, any> || {};

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(DOCUSIGN_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: metadata.refreshToken || "",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        if (response.status === 401 || response.status === 400) {
          throw new OAuthPermanentError(`DocuSign OAuth token permanently revoked: ${response.status}`);
        }
        throw new Error(`DocuSign token refresh failed: ${response.status}`);
      }

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
      const metadata = connection.metadata as Record<string, any> || {};
      const baseUrl = process.env.DOCUSIGN_BASE_URL || "https://demo.docusign.net/restapi";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(`${baseUrl}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID || ""}`, {
        headers: { "Authorization": `Bearer ${metadata.accessToken || ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok
        ? { ok: true, message: "Connected to DocuSign" }
        : { ok: false, message: `DocuSign API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("DocuSign connection disconnected");
  },
};
