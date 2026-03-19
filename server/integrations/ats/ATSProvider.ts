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

export interface ATSProvider {
  readonly providerName: string;
  testConnection(credentials: Record<string, string>): Promise<boolean>;
  listJobs(credentials: Record<string, string>): Promise<ATSJob[]>;
  listCandidates(credentials: Record<string, string>, jobExternalId?: string): Promise<ATSCandidate[]>;
  syncAll(credentials: Record<string, string>): Promise<ATSSyncResult>;
}
