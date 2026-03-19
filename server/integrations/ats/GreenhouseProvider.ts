import type { ATSProvider, ATSJob, ATSCandidate, ATSSyncResult } from "./ATSProvider";

export class GreenhouseProvider implements ATSProvider {
  readonly providerName = "GREENHOUSE";

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    const { apiKey } = credentials;
    if (!apiKey) return false;
    try {
      const encoded = Buffer.from(`${apiKey}:`).toString("base64");
      const res = await fetch("https://harvest.greenhouse.io/v1/users?per_page=1", {
        headers: { Authorization: `Basic ${encoded}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listJobs(credentials: Record<string, string>): Promise<ATSJob[]> {
    const { apiKey } = credentials;
    if (!apiKey) return [];
    try {
      const encoded = Buffer.from(`${apiKey}:`).toString("base64");
      const res = await fetch("https://harvest.greenhouse.io/v1/jobs?per_page=100&status=open", {
        headers: { Authorization: `Basic ${encoded}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>[];
      return data.map((j) => ({
        externalId: String(j["id"] || ""),
        title: String(j["name"] || ""),
        status: String(j["status"] || "open"),
        department: Array.isArray(j["departments"]) && (j["departments"] as Record<string, unknown>[])[0]
          ? String((j["departments"] as Record<string, unknown>[])[0]["name"] || "")
          : undefined,
        location: Array.isArray(j["offices"]) && (j["offices"] as Record<string, unknown>[])[0]
          ? String((j["offices"] as Record<string, unknown>[])[0]["name"] || "")
          : undefined,
        createdAt: j["created_at"] ? String(j["created_at"]) : undefined,
      }));
    } catch {
      return [];
    }
  }

  async listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]> {
    const { apiKey } = credentials;
    if (!apiKey) return [];
    try {
      const encoded = Buffer.from(`${apiKey}:`).toString("base64");
      const url = jobExternalId
        ? `https://harvest.greenhouse.io/v1/applications?job_id=${jobExternalId}&per_page=100`
        : `https://harvest.greenhouse.io/v1/applications?per_page=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${encoded}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>[];
      return data.map((app) => {
        const candidate = (app["candidate"] as Record<string, unknown>) || {};
        const firstName = String(candidate["first_name"] || "Unknown");
        const lastName = String(candidate["last_name"] || "Unknown");
        const emailObjs = Array.isArray(candidate["email_addresses"]) ? candidate["email_addresses"] as Record<string, unknown>[] : [];
        const email = emailObjs[0] ? String(emailObjs[0]["value"] || "") : undefined;
        const phoneObjs = Array.isArray(candidate["phone_numbers"]) ? candidate["phone_numbers"] as Record<string, unknown>[] : [];
        const phone = phoneObjs[0] ? String(phoneObjs[0]["value"] || "") : undefined;
        return {
          externalId: String(app["id"] || ""),
          firstName,
          lastName,
          email,
          phone,
          currentStage: app["current_stage"] ? String((app["current_stage"] as Record<string, unknown>)["name"] || "APPLIED") : "APPLIED",
          appliedAt: app["applied_at"] ? String(app["applied_at"]) : undefined,
          jobExternalId,
          rawPayload: app,
        };
      });
    } catch {
      return [];
    }
  }

  async syncAll(credentials: Record<string, string>): Promise<ATSSyncResult> {
    const result: ATSSyncResult = {
      provider: this.providerName,
      jobsSynced: 0,
      candidatesSynced: 0,
      errors: [],
    };
    try {
      const jobs = await this.listJobs(credentials);
      result.jobsSynced = jobs.length;
      const candidates = await this.listCandidates(credentials);
      result.candidatesSynced = candidates.length;
    } catch (err) {
      result.errors.push(String(err));
    }
    return result;
  }
}
