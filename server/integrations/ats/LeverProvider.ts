import type { ATSProvider, ATSJob, ATSJobInput, ATSCandidate, ATSSyncResult, ATSWebhookEvent } from "./ATSProvider";

export class LeverProvider implements ATSProvider {
  readonly providerName = "LEVER";

  private getAuthHeader(credentials: Record<string, string>): string {
    return `Basic ${Buffer.from(`${credentials["apiKey"]}:`).toString("base64")}`;
  }

  normalizeJob(raw: Record<string, unknown>): ATSJob {
    const cats = raw["categories"] as Record<string, unknown> | undefined;
    return {
      externalId: String(raw["id"] || ""),
      title: String(raw["text"] || ""),
      status: String(raw["state"] || "published"),
      department: cats ? String(cats["department"] || "") : undefined,
      location: cats ? String(cats["location"] || "") : undefined,
      description: raw["descriptionPlain"] ? String(raw["descriptionPlain"]) : undefined,
      createdAt: raw["createdAt"] ? new Date(Number(raw["createdAt"])).toISOString() : undefined,
    };
  }

  normalizeCandidate(raw: Record<string, unknown>): ATSCandidate {
    const name = String(raw["name"] || "");
    const parts = name.trim().split(" ");
    const firstName = parts[0] || "Unknown";
    const lastName = parts.slice(1).join(" ") || "Unknown";
    const emails = Array.isArray(raw["emails"]) ? raw["emails"] as string[] : [];
    return {
      externalId: String(raw["id"] || ""),
      firstName,
      lastName,
      email: emails[0],
      currentStage: raw["stage"] ? String((raw["stage"] as Record<string, unknown>)["text"] || "APPLIED") : "APPLIED",
      appliedAt: raw["createdAt"] ? new Date(Number(raw["createdAt"])).toISOString() : undefined,
      rawPayload: raw,
    };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    if (!credentials["apiKey"]) return false;
    try {
      const res = await fetch("https://api.lever.co/v1/users?limit=1", {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async listJobs(credentials: Record<string, string>): Promise<ATSJob[]> {
    if (!credentials["apiKey"]) return [];
    try {
      const res = await fetch("https://api.lever.co/v1/postings?limit=100&state=published", {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Record<string, unknown>[] };
      return (data.data || []).map((j) => this.normalizeJob(j));
    } catch {
      return [];
    }
  }

  async getJob(credentials: Record<string, string>, externalJobId: string): Promise<ATSJob | null> {
    if (!credentials["apiKey"]) return null;
    try {
      const res = await fetch(`https://api.lever.co/v1/postings/${externalJobId}`, {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Record<string, unknown> };
      return data.data ? this.normalizeJob(data.data) : null;
    } catch {
      return null;
    }
  }

  async listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]> {
    if (!credentials["apiKey"]) return [];
    try {
      const url = jobExternalId
        ? `https://api.lever.co/v1/opportunities?posting_id=${jobExternalId}&limit=100`
        : `https://api.lever.co/v1/opportunities?limit=100`;
      const res = await fetch(url, { headers: { Authorization: this.getAuthHeader(credentials) } });
      if (!res.ok) return [];
      const data = await res.json() as { data?: Record<string, unknown>[] };
      return (data.data || []).map((opp) => ({ ...this.normalizeCandidate(opp), jobExternalId }));
    } catch {
      return [];
    }
  }

  async getCandidate(credentials: Record<string, string>, externalCandidateId: string): Promise<ATSCandidate | null> {
    if (!credentials["apiKey"]) return null;
    try {
      const res = await fetch(`https://api.lever.co/v1/opportunities/${externalCandidateId}`, {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Record<string, unknown> };
      return data.data ? this.normalizeCandidate(data.data) : null;
    } catch {
      return null;
    }
  }

  async moveCandidateStage(credentials: Record<string, string>, externalCandidateId: string, stage: string): Promise<boolean> {
    if (!credentials["apiKey"]) return false;
    try {
      const res = await fetch(`https://api.lever.co/v1/opportunities/${externalCandidateId}/stage`, {
        method: "PUT",
        headers: { Authorization: this.getAuthHeader(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async createJob(credentials: Record<string, string>, job: ATSJobInput): Promise<ATSJob | null> {
    if (!credentials["apiKey"]) return null;
    try {
      const res = await fetch("https://api.lever.co/v1/postings", {
        method: "POST",
        headers: { Authorization: this.getAuthHeader(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ text: job.title, content: { description: job.description || "" } }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Record<string, unknown> };
      return data.data ? this.normalizeJob(data.data) : null;
    } catch {
      return null;
    }
  }

  async updateJob(credentials: Record<string, string>, externalJobId: string, updates: Partial<ATSJobInput>): Promise<ATSJob | null> {
    if (!credentials["apiKey"]) return null;
    try {
      const res = await fetch(`https://api.lever.co/v1/postings/${externalJobId}`, {
        method: "PUT",
        headers: { Authorization: this.getAuthHeader(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ text: updates.title, content: { description: updates.description } }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { data?: Record<string, unknown> };
      return data.data ? this.normalizeJob(data.data) : null;
    } catch {
      return null;
    }
  }

  async publishJob(credentials: Record<string, string>, externalJobId: string): Promise<boolean> {
    if (!credentials["apiKey"]) return false;
    try {
      const res = await fetch(`https://api.lever.co/v1/postings/${externalJobId}/apply`, {
        method: "POST",
        headers: { Authorization: this.getAuthHeader(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ state: "published" }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async archiveJob(credentials: Record<string, string>, externalJobId: string): Promise<boolean> {
    if (!credentials["apiKey"]) return false;
    try {
      const res = await fetch(`https://api.lever.co/v1/postings/${externalJobId}/state`, {
        method: "PUT",
        headers: { Authorization: this.getAuthHeader(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ state: "closed" }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async syncAll(credentials: Record<string, string>): Promise<ATSSyncResult> {
    const result: ATSSyncResult = { provider: this.providerName, jobsSynced: 0, candidatesSynced: 0, errors: [] };
    try {
      result.jobsSynced = (await this.listJobs(credentials)).length;
      result.candidatesSynced = (await this.listCandidates(credentials)).length;
    } catch (err) {
      result.errors.push(String(err));
    }
    return result;
  }

  webhookHandler(payload: Record<string, unknown>): ATSWebhookEvent | null {
    const eventType = String(payload["event"] || "");
    const data = payload["data"] as Record<string, unknown> | undefined;
    if (!data) return null;
    if (eventType.includes("candidate") || eventType.includes("opportunity")) {
      return { type: eventType, data: this.normalizeCandidate(data) };
    }
    if (eventType.includes("posting")) {
      return { type: eventType, data: this.normalizeJob(data) };
    }
    return null;
  }
}
