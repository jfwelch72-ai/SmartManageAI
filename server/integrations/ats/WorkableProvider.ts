import type { ATSProvider, ATSJob, ATSCandidate, ATSSyncResult, ATSWebhookEvent } from "./ATSProvider";

export class WorkableProvider implements ATSProvider {
  readonly providerName = "WORKABLE";

  normalizeJob(raw: Record<string, unknown>): ATSJob {
    return {
      externalId: String(raw["shortcode"] || raw["id"] || ""),
      title: String(raw["title"] || ""),
      status: String(raw["state"] || "published"),
      department: raw["department"] ? String(raw["department"]) : undefined,
      location: raw["location"] ? String((raw["location"] as Record<string, unknown>)["city"] || "") : undefined,
      description: raw["full_description"] ? String(raw["full_description"]) : undefined,
      createdAt: raw["created_at"] ? String(raw["created_at"]) : undefined,
    };
  }

  normalizeCandidate(raw: Record<string, unknown>): ATSCandidate {
    const name = String(raw["name"] || "");
    const parts = name.trim().split(" ");
    const firstName = parts[0] || "Unknown";
    const lastName = parts.slice(1).join(" ") || "Unknown";
    return {
      externalId: String(raw["id"] || ""),
      firstName,
      lastName,
      email: raw["email"] ? String(raw["email"]) : undefined,
      phone: raw["phone"] ? String(raw["phone"]) : undefined,
      currentStage: raw["stage"] ? String(raw["stage"]) : "APPLIED",
      appliedAt: raw["created_at"] ? String(raw["created_at"]) : undefined,
      rawPayload: raw,
    };
  }

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
      return (data.jobs || []).map((j) => this.normalizeJob(j));
    } catch {
      return [];
    }
  }

  async getJob(credentials: Record<string, string>, externalJobId: string): Promise<ATSJob | null> {
    const { apiKey, subdomain } = credentials;
    if (!apiKey || !subdomain) return null;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/jobs/${externalJobId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return null;
      const data = await res.json() as Record<string, unknown>;
      return this.normalizeJob(data);
    } catch {
      return null;
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
      return (data.candidates || []).map((c) => ({ ...this.normalizeCandidate(c), jobExternalId }));
    } catch {
      return [];
    }
  }

  async getCandidate(credentials: Record<string, string>, externalCandidateId: string): Promise<ATSCandidate | null> {
    const { apiKey, subdomain } = credentials;
    if (!apiKey || !subdomain) return null;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/candidates/${externalCandidateId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return null;
      const data = await res.json() as Record<string, unknown>;
      return this.normalizeCandidate(data);
    } catch {
      return null;
    }
  }

  async moveCandidateStage(credentials: Record<string, string>, externalCandidateId: string, stage: string): Promise<boolean> {
    const { apiKey, subdomain } = credentials;
    if (!apiKey || !subdomain) return false;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/candidates/${externalCandidateId}/move`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-WORKABLE-CLIENT-ID": subdomain,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ target_stage: stage }),
      });
      return res.ok;
    } catch {
      return false;
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

  webhookHandler(payload: Record<string, unknown>): ATSWebhookEvent | null {
    const eventType = String(payload["event_type"] || "");
    const data = payload["data"] as Record<string, unknown> | undefined;
    if (!data) return null;
    if (eventType.startsWith("candidate")) {
      return { type: eventType, data: this.normalizeCandidate(data) };
    }
    if (eventType.startsWith("job")) {
      return { type: eventType, data: this.normalizeJob(data) };
    }
    return null;
  }
}
