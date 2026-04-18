import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo } from "../../../utils/logger";

/**
 * Surety bond verification. Most surety carriers expose a small REST
 * endpoint (or Treasury Listing T-List) for verifying bond status. We
 * model this as a manual provider with a configurable verification URL +
 * optional API key per organization.
 */
export const suretyVerificationProvider: IntegrationProvider = {
  key: "surety_verification",
  displayName: "Surety Bond Verification",
  authType: "manual",
  requiredScopes: [],
  featureFlag: "SURETY_BONDS",

  getAuthUrl(): string { return ""; },

  async handleCallback(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "manual" };
  },

  async refreshToken(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "manual" };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const meta = (connection.metadata as Record<string, any>) || {};
    if (!meta.verificationUrl) {
      return { ok: false, message: "Set a surety verification URL in connection settings" };
    }
    return { ok: true, message: "Surety verification endpoint configured" };
  },

  async disconnect(): Promise<void> {
    logInfo("Surety verification connection disconnected");
  },
};
