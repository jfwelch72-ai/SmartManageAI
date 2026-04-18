import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo } from "../../../utils/logger";

export const aashtowareProvider: IntegrationProvider = {
  key: "aashtoware",
  displayName: "AASHTOWare Project (ebsx)",
  authType: "manual",
  requiredScopes: [],
  featureFlag: "DOT_PAY_ITEMS",

  getAuthUrl(): string { return ""; },

  async handleCallback(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "manual" };
  },

  async refreshToken(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "manual" };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const meta = (connection.metadata as Record<string, any>) || {};
    if (meta.agencyCode || meta.agencyId) {
      return { ok: true, message: `AASHTOWare ebsx connection configured for ${meta.agencyCode || meta.agencyId}` };
    }
    return { ok: true, message: "AASHTOWare ebsx connection active (file exchange)" };
  },

  async disconnect(): Promise<void> {
    logInfo("AASHTOWare connection disconnected");
  },
};
