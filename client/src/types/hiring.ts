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
export type HiringSyncStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
export type HiringInterviewStatus = "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

export interface HiringJob {
  id: string;
  organizationId: string;
  externalProvider: ATSProvider | null;
  externalJobId: string | null;
  title: string;
  department: string | null;
  trade: string | null;
  employmentType: HiringEmploymentType | null;
  location: string | null;
  compensationType: HiringCompensationType | null;
  compensationMin: string | null;
  compensationMax: string | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
  certificationsRequired: string | null;
  screeningQuestionsJson: string | null;
  postingDestinationsJson: string | null;
  internalNotes: string | null;
  status: HiringJobStatus;
  assignedOwnerUserId: string | null;
  createdByUserId: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HiringAiReview {
  id: string;
  candidateId: string;
  score: number | null;
  tradeFitScore: number | null;
  roleFitScore: number | null;
  confidenceScore: number | null;
  recommendation: "YES" | "MAYBE" | "NO" | null;
  summary: string | null;
  strengthsJson: string | null;
  concernsJson: string | null;
  redFlagsJson: string | null;
  extractedSkillsJson: string | null;
  extractedCertsJson: string | null;
  extractedEquipmentJson: string | null;
  interviewRecommendation: string | null;
  promptVersion: string | null;
  modelName: string | null;
  generatedAt: string | null;
}

export interface HiringCandidate {
  id: string;
  organizationId: string;
  jobId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  source: string | null;
  currentStage: HiringCandidateStage;
  appliedAt: string;
  reviewerUserId: string | null;
  aiScore: number | null;
  aiRecommendation: string | null;
  status: string;
  resumeStorageKey: string | null;
  applicationAnswersJson: string | null;
  externalCandidateId: string | null;
  externalProvider: ATSProvider | null;
  createdAt: string;
  updatedAt: string;
  latestAiReview?: HiringAiReview | null;
}

export interface HiringIntegration {
  id: string;
  organizationId: string;
  providerName: ATSProvider;
  status: string;
  lastSyncAt: string | null;
  lastTestAt: string | null;
  defaultConfigJson: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HiringSyncLog {
  id: string;
  organizationId: string;
  integrationId: string | null;
  provider: ATSProvider | null;
  status: HiringSyncStatus;
  entityType: string | null;
  recordsProcessed: number;
  recordsFailed: number;
  errorSummary: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface HiringInterview {
  id: string;
  organizationId: string;
  candidateId: string;
  jobId: string | null;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  interviewType: string;
  status: HiringInterviewStatus;
  location: string | null;
  videoLink: string | null;
  notes: string | null;
  interviewerUserIdsJson: string | null;
  reminderSentAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  candidateName: string | null;
  jobTitle: string | null;
}

export interface HiringActivityLog {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorName: string | null;
  activityType: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export interface HiringCandidateNote {
  id: string;
  organizationId: string;
  candidateId: string;
  authorUserId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface HiringCandidateNote {
  id: string;
  organizationId: string;
  candidateId: string;
  authorUserId: string | null;
  authorName: string;
  body: string;
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
