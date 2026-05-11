import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo, logError } from "../../../utils/logger";
import { OAuthPermanentError } from "../oauthErrors";

/**
 * Task #2755 — Microsoft-specific subclass of OAuthPermanentError, thrown when
 * Microsoft returns a permanent token-refresh failure (invalid_grant, AADSTS
 * error codes, revoked consent). Extends the shared base so callers can test
 * `instanceof OAuthPermanentError` without knowing the provider.
 */
export class MicrosoftOAuthPermanentError extends OAuthPermanentError {
  constructor(message: string) {
    super(message);
    this.name = "MicrosoftOAuthPermanentError";
  }
}

const MS_AUTH_URL = "https://login.microsoftonline.com";
const MS_TOKEN_URL_TEMPLATE = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token";

export const microsoftProvider: IntegrationProvider = {
  key: "microsoft",
  displayName: "Microsoft 365",
  authType: "oauth",
  requiredScopes: ["Mail.Read", "Mail.ReadBasic", "Calendars.ReadWrite", "offline_access"],
  featureFlag: "INTEGRATION_MICROSOFT",

  getAuthUrl(connectionId: string, redirectUri: string, state: string): string {
    const clientId = process.env.MICROSOFT_CLIENT_ID || "";
    const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: this.requiredScopes.join(" "),
      state,
      response_mode: "query",
    });
    return `${MS_AUTH_URL}/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
  },

  async handleCallback(code: string, state: string): Promise<TokenSet> {
    const clientId = process.env.MICROSOFT_CLIENT_ID || "";
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
    const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
    const stateData = JSON.parse(Buffer.from(state, "base64url").toString());
    const tokenUrl = MS_TOKEN_URL_TEMPLATE.replace("{tenant}", tenantId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: stateData.redirectUri || "",
          grant_type: "authorization_code",
          scope: "Mail.Read Mail.ReadBasic Calendars.ReadWrite offline_access",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        logError("Microsoft token exchange failed", { status: response.status });
        throw new Error(`Microsoft token exchange failed: ${response.status}`);
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
    const clientId = process.env.MICROSOFT_CLIENT_ID || "";
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
    const tenantId = process.env.MICROSOFT_TENANT_ID || "common";
    const metadata = connection.metadata as Record<string, any> || {};
    const tokenUrl = MS_TOKEN_URL_TEMPLATE.replace("{tenant}", tenantId);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: metadata.refreshToken || "",
          grant_type: "refresh_token",
          scope: "Mail.Read Mail.ReadBasic Calendars.ReadWrite offline_access",
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text();
        // Permanent failures (invalid_grant, AADSTS codes) cannot be retried —
        // the user must re-authorize. Surface as MicrosoftOAuthPermanentError so
        // callers can mark the connection needs_reconnect instead of ERROR.
        if (
          response.status >= 400 &&
          response.status < 500 &&
          /invalid_grant|AADSTS|consent_required|interaction_required/i.test(errBody)
        ) {
          throw new MicrosoftOAuthPermanentError(
            `Microsoft OAuth token permanently revoked: ${response.status} ${errBody.substring(0, 150)}`,
          );
        }
        logError("Microsoft token refresh failed", { status: response.status, body: errBody.substring(0, 200) });
        throw new Error(`Microsoft token refresh failed: ${response.status}`);
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch("https://graph.microsoft.com/v1.0/me", {
        headers: { "Authorization": `Bearer ${metadata.accessToken || ""}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      return response.ok
        ? { ok: true, message: "Connected to Microsoft 365" }
        : { ok: false, message: `Microsoft Graph API returned ${response.status}` };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  },

  async disconnect(_connection: IntegrationConnection): Promise<void> {
    logInfo("Microsoft connection disconnected");
  },
};
