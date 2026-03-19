import type { ATSProvider, ATSJob, ATSCandidate, ATSSyncResult } from "./ATSProvider";

export class LeverProvider implements ATSProvider {
  readonly providerName = "LEVER";

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    const { apiKey } = credentials;
    if (!apiKey) return false;
    try {
      const encoded = Buffer.from(`${apiKey}:`).toString("base64");
      const res = await fetch("https://api.lever.co/v1/users?limit=1", {
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
      const res = await fetch("https://api.lever.co/v1/postings?limit=100&state=published", {
        headers: { Authorization: `Basic ${encoded}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Record<string, unknown>[] };
      return (data.data || []).map((j) => ({
        externalId: String(j["id"] || ""),
        title: String(j["text"] || ""),
        status: String(j["state"] || "published"),
        department: j["categories"] ? String((j["categories"] as Record<string, unknown>)["department"] || "") : undefined,
        location: j["categories"] ? String((j["categories"] as Record<string, unknown>)["location"] || "") : undefined,
        description: j["descriptionPlain"] ? String(j["descriptionPlain"]) : undefined,
        createdAt: j["createdAt"] ? new Date(Number(j["createdAt"])).toISOString() : undefined,
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
        ? `https://api.lever.co/v1/opportunities?posting_id=${jobExternalId}&limit=100`
        : `https://api.lever.co/v1/opportunities?limit=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${encoded}` },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Record<string, unknown>[] };
      return (data.data || []).map((opp) => {
        const name = String(opp["name"] || "");
        const parts = name.trim().split(" ");
        const firstName = parts[0] || "Unknown";
        const lastName = parts.slice(1).join(" ") || "Unknown";
        const emails = Array.isArray(opp["emails"]) ? opp["emails"] as string[] : [];
        return {
          externalId: String(opp["id"] || ""),
          firstName,
          lastName,
          email: emails[0],
          currentStage: opp["stage"] ? String((opp["stage"] as Record<string, unknown>)["text"] || "APPLIED") : "APPLIED",
          appliedAt: opp["createdAt"] ? new Date(Number(opp["createdAt"])).toISOString() : undefined,
          jobExternalId,
          rawPayload: opp,
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
