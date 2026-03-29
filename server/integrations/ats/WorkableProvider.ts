import { logWarn } from "../../utils/logger";
import type { ATSProvider, ATSJob, ATSJobInput, ATSCandidate, ATSSyncResult, ATSWebhookEvent } from "./ATSProvider";

/**
 * Workable ATS integration.
 *
 * Graceful no-op stub semantics: when WORKABLE_API_TOKEN / WORKABLE_SUBDOMAIN
 * environment variables are absent AND no credentials are passed, all methods
 * return empty results or `false` without throwing. This mirrors the pattern
 * used by SMS/Teams/Slack services in this codebase.
 */
export class WorkableProvider implements ATSProvider {
  readonly providerName = "WORKABLE";

  private resolveCredentials(credentials: Record<string, string>): { apiKey: string; subdomain: string } {
    return {
      apiKey: credentials["apiKey"] || process.env["WORKABLE_API_TOKEN"] || "",
      subdomain: credentials["subdomain"] || process.env["WORKABLE_SUBDOMAIN"] || "",
    };
  }

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
    return {
      externalId: String(raw["id"] || ""),
      firstName: parts[0] || "Unknown",
      lastName: parts.slice(1).join(" ") || "Unknown",
      email: raw["email"] ? String(raw["email"]) : undefined,
      phone: raw["phone"] ? String(raw["phone"]) : undefined,
      currentStage: raw["stage"] ? String(raw["stage"]) : "APPLIED",
      appliedAt: raw["created_at"] ? String(raw["created_at"]) : undefined,
      rawPayload: raw,
    };
  }

  async testConnection(credentials: Record<string, string>): Promise<boolean> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return false;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/accounts/${subdomain}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return res.ok;
    } catch {
      logWarn("Non-critical operation failed");
      return false;
    }
  }

  async listJobs(credentials: Record<string, string>): Promise<ATSJob[]> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return [];
    try {
      const res = await fetch("https://www.workable.com/spi/v3/jobs?limit=100", {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return [];
      const data = await res.json() as { jobs?: Record<string, unknown>[] };
      return (data.jobs || []).map((j) => this.normalizeJob(j));
    } catch {
      logWarn("Non-critical operation failed");
      return [];
    }
  }

  async getJob(credentials: Record<string, string>, externalJobId: string): Promise<ATSJob | null> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return null;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/jobs/${externalJobId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return null;
      return this.normalizeJob(await res.json() as Record<string, unknown>);
    } catch {
      logWarn("Non-critical operation failed");
      return null;
    }
  }

  async listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
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
      logWarn("Non-critical operation failed");
      return [];
    }
  }

  async getCandidate(credentials: Record<string, string>, externalCandidateId: string): Promise<ATSCandidate | null> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return null;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/candidates/${externalCandidateId}`, {
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      if (!res.ok) return null;
      return this.normalizeCandidate(await res.json() as Record<string, unknown>);
    } catch {
      logWarn("Non-critical operation failed");
      return null;
    }
  }

  async createJob(credentials: Record<string, string>, job: ATSJobInput): Promise<ATSJob | null> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return null;
    try {
      const res = await fetch("https://www.workable.com/spi/v3/jobs", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain, "Content-Type": "application/json" },
        body: JSON.stringify({ job: { title: job.title, description: job.description || "" } }),
      });
      if (!res.ok) return null;
      return this.normalizeJob(await res.json() as Record<string, unknown>);
    } catch {
      logWarn("Non-critical operation failed");
      return null;
    }
  }

  async updateJob(credentials: Record<string, string>, externalJobId: string, updates: Partial<ATSJobInput>): Promise<ATSJob | null> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return null;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/jobs/${externalJobId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain, "Content-Type": "application/json" },
        body: JSON.stringify({ job: updates }),
      });
      if (!res.ok) return null;
      return this.normalizeJob(await res.json() as Record<string, unknown>);
    } catch {
      logWarn("Non-critical operation failed");
      return null;
    }
  }

  async publishJob(credentials: Record<string, string>, externalJobId: string): Promise<boolean> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return false;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/jobs/${externalJobId}/publish`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      return res.ok;
    } catch {
      logWarn("Non-critical operation failed");
      return false;
    }
  }

  async archiveJob(credentials: Record<string, string>, externalJobId: string): Promise<boolean> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return false;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/jobs/${externalJobId}/archive`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain },
      });
      return res.ok;
    } catch {
      logWarn("Non-critical operation failed");
      return false;
    }
  }

  async moveCandidateStage(credentials: Record<string, string>, externalCandidateId: string, stage: string): Promise<boolean> {
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return false;
    try {
      const res = await fetch(`https://www.workable.com/spi/v3/candidates/${externalCandidateId}/move`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "X-WORKABLE-CLIENT-ID": subdomain, "Content-Type": "application/json" },
        body: JSON.stringify({ target_stage: stage }),
      });
      return res.ok;
    } catch {
      logWarn("Non-critical operation failed");
      return false;
    }
  }

  async syncAll(credentials: Record<string, string>): Promise<ATSSyncResult> {
    const result: ATSSyncResult = { provider: this.providerName, jobsSynced: 0, candidatesSynced: 0, errors: [] };
    const { apiKey, subdomain } = this.resolveCredentials(credentials);
    if (!apiKey || !subdomain) return result;
    try {
      result.jobsSynced = (await this.listJobs(credentials)).length;
      result.candidatesSynced = (await this.listCandidates(credentials)).length;
    } catch (err) {
      result.errors.push(String(err));
    }
    return result;
  }

  webhookHandler(payload: Record<string, unknown>): ATSWebhookEvent | null {
    const eventType = String(payload["event_type"] || "");
    const data = payload["data"] as Record<string, unknown> | undefined;
    if (!data) return null;
    if (eventType.startsWith("candidate")) return { type: eventType, data: this.normalizeCandidate(data) };
    if (eventType.startsWith("job")) return { type: eventType, data: this.normalizeJob(data) };
    return null;
  }
}
