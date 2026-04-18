import type { IntegrationProvider, TokenSet } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { logInfo } from "../../../utils/logger";

/**
 * FHWA / state-DOT DBE certification directory lookup. Each state runs its
 * own UCP directory; we model it as a manual provider that takes a base URL
 * and optional API key per organization. SUPER_ADMIN can pre-populate the
 * URL for common state UCPs.
 */
export const dbeDirectoryProvider: IntegrationProvider = {
  key: "dbe_directory",
  displayName: "FHWA / State DBE Directory",
  authType: "manual",
  requiredScopes: [],
  featureFlag: "DBE_TRACKING",

  getAuthUrl(): string { return ""; },

  async handleCallback(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "manual" };
  },

  async refreshToken(): Promise<TokenSet> {
    return { accessToken: "", tokenType: "manual" };
  },

  async testConnection(connection: IntegrationConnection): Promise<{ ok: boolean; message: string }> {
    const meta = (connection.metadata as Record<string, any>) || {};
    if (!meta.directoryUrl && !meta.apiKey) {
      return { ok: false, message: "Set a directory URL (and API key if required) in connection settings" };
    }
    return { ok: true, message: `DBE directory configured${meta.state ? ` for ${meta.state}` : ""}` };
  },

  async disconnect(): Promise<void> {
    logInfo("DBE directory connection disconnected");
  },
};
