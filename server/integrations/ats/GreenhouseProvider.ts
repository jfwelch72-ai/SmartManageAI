import type { ATSProvider, ATSJob, ATSCandidate, ATSSyncResult, ATSWebhookEvent } from "./ATSProvider";

export class GreenhouseProvider implements ATSProvider {
  readonly providerName = "GREENHOUSE";

  private getAuthHeader(credentials: Record<string, string>): string {
    return `Basic ${Buffer.from(`${credentials["apiKey"]}:`).toString("base64")}`;
  }

  normalizeJob(raw: Record<string, unknown>): ATSJob {
    const depts = Array.isArray(raw["departments"]) ? raw["departments"] as Record<string, unknown>[] : [];
    const offices = Array.isArray(raw["offices"]) ? raw["offices"] as Record<string, unknown>[] : [];
    return {
      externalId: String(raw["id"] || ""),
      title: String(raw["name"] || ""),
      status: String(raw["status"] || "open"),
      department: depts[0] ? String(depts[0]["name"] || "") : undefined,
      location: offices[0] ? String(offices[0]["name"] || "") : undefined,
      createdAt: raw["created_at"] ? String(raw["created_at"]) : undefined,
    };
  }

  normalizeCandidate(raw: Record<string, unknown>): ATSCandidate {
    const candidate = (raw["candidate"] as Record<string, unknown>) || raw;
    const firstName = String(candidate["first_name"] || "Unknown");
    const lastName = String(candidate["last_name"] || "Unknown");
    const emailObjs = Array.isArray(candidate["email_addresses"]) ? candidate["email_addresses"] as Record<string, unknown>[] : [];
    const phoneObjs = Array.isArray(candidate["phone_numbers"]) ? candidate["phone_numbers"] as Record<string, unknown>[] : [];
    return {
      externalId: String(raw["id"] || ""),
      firstName,
      lastName,
      email: emailObjs[0] ? String(emailObjs[0]["value"] || "") : undefined,
      phone: phoneObjs[0] ? String(phoneObjs[0]["value"] || "") : undefined,
      currentStage: raw["current_stage"] ? String((raw["current_stage"] as Record<string, unknown>)["name"] || "APPLIED") : "APPLIED",
      appliedAt: raw["applied_at"] ? String(raw["applied_at"]) : undefined,
      rawPayload: raw,
    };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    if (!credentials["apiKey"]) return false;
    try {
      const res = await fetch("https://harvest.greenhouse.io/v1/users?per_page=1", {
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
      const res = await fetch("https://harvest.greenhouse.io/v1/jobs?per_page=100&status=open", {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>[];
      return data.map((j) => this.normalizeJob(j));
    } catch {
      return [];
    }
  }

  async getJob(credentials: Record<string, string>, externalJobId: string): Promise<ATSJob | null> {
    if (!credentials["apiKey"]) return null;
    try {
      const res = await fetch(`https://harvest.greenhouse.io/v1/jobs/${externalJobId}`, {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      if (!res.ok) return null;
      return this.normalizeJob(await res.json() as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]> {
    if (!credentials["apiKey"]) return [];
    try {
      const url = jobExternalId
        ? `https://harvest.greenhouse.io/v1/applications?job_id=${jobExternalId}&per_page=100`
        : `https://harvest.greenhouse.io/v1/applications?per_page=100`;
      const res = await fetch(url, { headers: { Authorization: this.getAuthHeader(credentials) } });
      if (!res.ok) return [];
      const data = await res.json() as Record<string, unknown>[];
      return data.map((app) => ({ ...this.normalizeCandidate(app), jobExternalId }));
    } catch {
      return [];
    }
  }

  async getCandidate(credentials: Record<string, string>, externalCandidateId: string): Promise<ATSCandidate | null> {
    if (!credentials["apiKey"]) return null;
    try {
      const res = await fetch(`https://harvest.greenhouse.io/v1/candidates/${externalCandidateId}`, {
        headers: { Authorization: this.getAuthHeader(credentials) },
      });
      if (!res.ok) return null;
      return this.normalizeCandidate(await res.json() as Record<string, unknown>);
    } catch {
      return null;
    }
  }

  async moveCandidateStage(credentials: Record<string, string>, externalCandidateId: string, stage: string): Promise<boolean> {
    if (!credentials["apiKey"]) return false;
    try {
      const res = await fetch(`https://harvest.greenhouse.io/v1/applications/${externalCandidateId}/advance`, {
        method: "POST",
        headers: { Authorization: this.getAuthHeader(credentials), "Content-Type": "application/json" },
        body: JSON.stringify({ from_stage_id: null, to_stage_id: stage }),
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
    const action = String(payload["action"] || "");
    const data = payload["payload"] as Record<string, unknown> | undefined;
    if (!data) return null;
    if (action.includes("candidate") || action.includes("application")) {
      return { type: action, data: this.normalizeCandidate(data) };
    }
    if (action.includes("job")) {
      return { type: action, data: this.normalizeJob(data) };
    }
    return null;
  }
}
