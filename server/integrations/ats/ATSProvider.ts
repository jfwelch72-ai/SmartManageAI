export interface ATSJob {
  externalId: string;
  title: string;
  status: string;
  department?: string;
  location?: string;
  description?: string;
  createdAt?: string;
}

export interface ATSCandidate {
  externalId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  currentStage?: string;
  appliedAt?: string;
  jobExternalId?: string;
  rawPayload?: Record<string, unknown>;
}

export interface ATSSyncResult {
  provider: string;
  jobsSynced: number;
  candidatesSynced: number;
  errors: string[];
}

export interface ATSWebhookEvent {
  type: string;
  data: ATSJob | ATSCandidate;
}

export interface ATSProvider {
  readonly providerName: string;

  /** Verify credentials are valid and the integration is reachable */
  testConnection(credentials: Record<string, string>): Promise<boolean>;

  /** Fetch all open jobs */
  listJobs(credentials: Record<string, string>): Promise<ATSJob[]>;

  /** Fetch a single job by its external ID */
  getJob(credentials: Record<string, string>, externalJobId: string): Promise<ATSJob | null>;

  /** Fetch all candidates, optionally scoped to a job */
  listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]>;

  /** Fetch a single candidate by external ID */
  getCandidate(credentials: Record<string, string>, externalCandidateId: string): Promise<ATSCandidate | null>;

  /** Push a stage change back to the ATS (returns success flag) */
  moveCandidateStage(credentials: Record<string, string>, externalCandidateId: string, stage: string): Promise<boolean>;

  /** Pull all jobs + candidates and return a summary */
  syncAll(credentials: Record<string, string>): Promise<ATSSyncResult>;

  /** Normalize a raw job API response to ATSJob */
  normalizeJob(raw: Record<string, unknown>): ATSJob;

  /** Normalize a raw candidate API response to ATSCandidate */
  normalizeCandidate(raw: Record<string, unknown>): ATSCandidate;

  /** Parse an inbound webhook payload (optional — providers that don't support webhooks return null) */
  webhookHandler?(payload: Record<string, unknown>): ATSWebhookEvent | null;
}
