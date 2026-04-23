export interface DocumentType {
  value: string;
  label: string;
  category: string;
}

export interface DocumentSummary {
  branding: {
    total: number;
    uploaded: number;
  };
  insurance: {
    total: number;
    uploaded: number;
    expiringSoon: number;
    expired: number;
  };
  compliance: {
    total: number;
    uploaded: number;
  };
}

export interface OrganizationDocument {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  description: string | null;
  fileUrl: string;
  objectKey: string | null;
  mimeType: string | null;
  fileSize: number | null;
  visibility: string;
  version: number;
  uploadedById: string | null;
  effectiveDate: string | null;
  expiresAt: string | null;
  notes: string | null;
  replacesDocumentId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
  typeLabel: string;
  visibilityLabel: string;
  uploadedByName: string | null;
  isExpired: boolean;
  isExpiringSoon: boolean;
  category: string;
}

export interface TypesResponse {
  types: DocumentType[];
  visibilities: { value: string; label: string }[];
  categories: { value: string; label: string; types: string[] }[];
}

export interface TradeConfigResponse {
  organization: {
    id: string;
    name: string;
    tradeType: string;
    tradeName: string | null;
  };
  sowItemCount: number;
  tradeTypes: { value: string; label: string }[];
}

export interface HustlerLinkRequest {
  id: string;
  hustlerUserId: string | null;
  hustlerEmail: string | null;
  requestType: string;
  status: string;
  roleOverride: string | null;
  message: string | null;
  expiresAt: string | null;
  createdAt: string;
  respondedAt: string | null;
}

export interface PayrollSettings {
  id: string;
  organizationId: string;
  workWeekStartDay: "SUNDAY" | "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY";
  overtimeThresholdHours: string;
  workWeekEndNotificationEnabled: boolean;
  autoGenerateWeeklyReports: boolean;
  signerName: string | null;
  signerTitle: string | null;
  contractorAddress: string | null;
  defaultFringeOption: "PLAN" | "CASH" | "NONE";
  certifiedPayrollDigestCadence: "OFF" | "DAILY" | "WEEKLY" | "BIWEEKLY";
  certifiedPayrollDigestWeekday: number;
  certifiedPayrollDigestHour: number;
  certifiedPayrollDigestTimezone: string;
  certifiedPayrollDigestLastSentAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export const DIGEST_CADENCES = [
  { value: "OFF", label: "Off — don't send the digest" },
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every other week" },
] as const;

export const DIGEST_WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

export const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Australia/Sydney",
  "Asia/Tokyo",
  "Asia/Singapore",
] as const;

export const DAYS_OF_WEEK = [
  { value: "SUNDAY", label: "Sunday" },
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
];
