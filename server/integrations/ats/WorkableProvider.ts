import type { ATSProvider, ATSJob, ATSCandidate, ATSSyncResult } from "./ATSProvider";

export class WorkableProvider implements ATSProvider {
  readonly providerName = "WORKABLE";

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    const { apiKey, subdomain } = credentials;
    if (!apiKey || !subdomain) return false;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/accounts/${subdomain}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listJobs(credentials: Record<string, string>): Promise<ATSJob[]> {
    const { apiKey, subdomain } = credentials;
    if (!apiKey || !subdomain) return [];
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/jobs?limit=100`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return [];
      const data = await res.json() as { jobs?: Record<string, unknown>[] };
      return (data.jobs || []).map((j) => ({
        externalId: String(j["shortcode"] || j["id"] || ""),
        title: String(j["title"] || ""),
        status: String(j["state"] || "published"),
        department: j["department"] ? String(j["department"]) : undefined,
        location: j["location"] ? String((j["location"] as Record<string, unknown>)["city"] || "") : undefined,
        description: j["full_description"] ? String(j["full_description"]) : undefined,
        createdAt: j["created_at"] ? String(j["created_at"]) : undefined,
      }));
    } catch {
      return [];
    }
  }

  async listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]> {
    const { apiKey, subdomain } = credentials;
    if (!apiKey || !subdomain) return [];
    try {
      const url = jobExternalId
        ? `https://www.workable.com/spi/v3/jobs/${jobExternalId}/candidates?limit=100`
        : `https://www.workable.com/spi/v3/candidates?limit=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return [];
      const data = await res.json() as { candidates?: Record<string, unknown>[] };
      return (data.candidates || []).map((c) => {
        const name = String(c["name"] || "");
        const parts = name.trim().split(" ");
        const firstName = parts[0] || "Unknown";
        const lastName = parts.slice(1).join(" ") || "Unknown";
        return {
          externalId: String(c["id"] || ""),
          firstName,
          lastName,
          email: c["email"] ? String(c["email"]) : undefined,
          phone: c["phone"] ? String(c["phone"]) : undefined,
          currentStage: c["stage"] ? String(c["stage"]) : "APPLIED",
          appliedAt: c["created_at"] ? String(c["created_at"]) : undefined,
          jobExternalId: jobExternalId,
          rawPayload: c,
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
