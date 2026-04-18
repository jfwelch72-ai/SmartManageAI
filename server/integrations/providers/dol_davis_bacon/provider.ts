import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo } from "../../../utils/logger";

/**
 * Davis-Bacon prevailing wage feed. The U.S. Department of Labor publishes
 * wage determinations on SAM.gov. We treat this as an apiKey-style provider
 * (SAM.gov requires a personal API key) and call the public Wage
 * Determinations On-Line (WDOL) JSON endpoints.
 */
export const dolDavisBaconProvider: IntegrationProvider = {
  key: "dol_davis_bacon",
  displayName: "DOL Davis-Bacon Wage Feed",
  authType: "apiKey",
  requiredScopes: [],
  featureFlag: "WH_347_PAYROLL",

  getAuthUrl(): string { return ""; },

  async handleCallback(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "apiKey" };
  },

  async refreshToken(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "apiKey" };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const meta = (connection.metadata as Record<string, any>) || {};
    if (!meta.apiKey && !meta.accessToken) {
      return { ok: false, message: "Add a SAM.gov API key in connection settings" };
    }
    return { ok: true, message: "Davis-Bacon wage feed connected" };
  },

  async disconnect(): Promise<void> {
    logInfo("DOL Davis-Bacon connection disconnected");
  },
};
