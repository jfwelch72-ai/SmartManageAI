export type HiringJobStatus = "DRAFT" | "PUBLISHED" | "PAUSED" | "ARCHIVED";
export type HiringEmploymentType = "FULL_TIME" | "PART_TIME" | "CONTRACT" | "TEMP" | "SEASONAL";
export type HiringCompensationType = "HOURLY" | "SALARY" | "PREVAILING_WAGE" | "PIECE_RATE";
export type HiringCandidateStage =
  | "APPLIED"
  | "SCREENING"
  | "PHONE_INTERVIEW"
  | "IN_PERSON_INTERVIEW"
  | "SKILLS_ASSESSMENT"
  | "BACKGROUND_CHECK"
  | "REFERENCE_CHECK"
  | "OFFER_EXTENDED"
  | "HIRED"
  | "REJECTED"
  | "ARCHIVED";

export type HiringCandidateSource =
  | "INDEED"
  | "LINKEDIN"
  | "REFERRAL"
  | "DIRECT"
  | "CRAIGSLIST"
  | "COMPANY_WEBSITE"
  | "ATS_SYNC"
  | "OTHER";

export type ATSProvider = "WORKABLE" | "GREENHOUSE" | "LEVER";
export type HiringSyncStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "PARTIAL";
export type HiringInterviewStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export interface HiringJob {
  id: string;
  organizationId: string;
  title: string;
  department: string | null;
  trade: string | null;
  location: string | null;
  employmentType: HiringEmploymentType | null;
  compensationType: HiringCompensationType | null;
  compensationMin: string | null;
  compensationMax: string | null;
  description: string | null;
  requirements: string | null;
  certifications: string[] | null;
  screeningQuestions: Record<string, unknown>[] | null;
  postingDestinations: string[] | null;
  status: HiringJobStatus;
  externalJobId: string | null;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HiringCandidate {
  id: string;
  organizationId: string;
  jobId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  stage: HiringCandidateStage;
  source: HiringCandidateSource | null;
  applicationAnswers: Record<string, unknown> | null;
  resumeUrl: string | null;
  linkedinUrl: string | null;
  aiScore: number | null;
  aiScoreSummary: string | null;
  reviewerUserId: string | null;
  notes: string | null;
  externalCandidateId: string | null;
  appliedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface HiringIntegration {
  id: string;
  organizationId: string;
  provider: ATSProvider;
  status: "CONNECTED" | "DISCONNECTED" | "ERROR";
  lastSyncedAt: string | null;
  syncStatus: HiringSyncStatus | null;
  syncErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HiringSyncLog {
  id: string;
  integrationId: string;
  status: HiringSyncStatus;
  jobsSynced: number | null;
  candidatesSynced: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}

export interface HiringInterview {
  id: string;
  organizationId: string;
  candidateId: string;
  jobId: string | null;
  scheduledAt: string;
  durationMinutes: number | null;
  interviewType: string | null;
  status: HiringInterviewStatus;
  location: string | null;
  notes: string | null;
  interviewerUserIds: string[] | null;
  createdAt: string;
  updatedAt: string;
}

export interface HiringActivityLog {
  id: string;
  organizationId: string;
  actorId: string | null;
  actorName: string | null;
  activityType: string;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface HiringDashboardStats {
  openRoles: number;
  draftRoles: number;
  publishedRoles: number;
  totalApplicants: number;
  newInLast7Days: number;
  scheduledInterviews: number;
  offerReady: number;
  overdueHiringTasks: number;
}

export interface HiringJobTemplate {
  id: string;
  organizationId: string;
  title: string;
  trade: string | null;
  employmentType: HiringEmploymentType | null;
  description: string | null;
  requirements: string | null;
  isGlobal: boolean;
  createdAt: string;
}
