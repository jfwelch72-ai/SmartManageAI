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
  createdAt: string;
  updatedAt: string | null;
}

export const DAYS_OF_WEEK = [
  { value: "SUNDAY", label: "Sunday" },
  { value: "MONDAY", label: "Monday" },
  { value: "TUESDAY", label: "Tuesday" },
  { value: "WEDNESDAY", label: "Wednesday" },
  { value: "THURSDAY", label: "Thursday" },
  { value: "FRIDAY", label: "Friday" },
  { value: "SATURDAY", label: "Saturday" },
];
