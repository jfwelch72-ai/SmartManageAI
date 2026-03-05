import { Star } from "lucide-react";
import { Label } from "@/components/ui/label";

export type TabKey = "overview" | "skills" | "performance" | "projects" | "logs";

export interface WorkerData {
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
    role: string;
    isActive: boolean;
    avatarUrl: string | null;
    tradeSpecialization: string | null;
    employmentType: string | null;
    birthdate: string | null;
    timezone: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    emergencyContactAddress: string | null;
    emergencyContactEmail: string | null;
    profileDescription: string | null;
    createdAt: string;
  };
  performanceProfile: {
    experienceLevel: string | null;
    pastProjects: string | null;
    productivityTendencies: string | null;
  } | null;
  skills: Array<{
    id: string;
    skillName: string;
    rating: number;
    isVerified: boolean;
    verifiedByUserId: string | null;
    verifiedAt: string | null;
    createdAt: string;
  }>;
  certifications: Array<{
    id: string;
    certificationName: string;
    issuedDate: string | null;
    expiryDate: string | null;
    fileUrl: string | null;
    status: string;
    createdAt: string;
  }>;
  attendanceLogs: Array<{
    id: string;
    date: string;
    status: string;
    notes: string | null;
  }>;
  safetyIncidents: Array<{
    id: string;
    date: string;
    severity: string;
    description: string;
    actionTaken: string | null;
  }>;
  qualityIssues: Array<{
    id: string;
    date: string;
    category: string;
    description: string;
    resolution: string | null;
  }>;
  performanceReviews: Array<{
    id: string;
    reviewDate: string;
    reviewerName: string;
    overallRating: number;
    productivityRating: number | null;
    qualityRating: number | null;
    safetyRating: number | null;
    communicationRating: number | null;
    leadershipRating: number | null;
    notes: string | null;
    scheduleAdherence: string | null;
    costControl: string | null;
    subcontractorCoordination: string | null;
    clientInspectionOutcomes: string | null;
  }>;
  supervisorNotes: Array<{
    id: string;
    note: string;
    createdByName: string;
    createdAt: string;
  }>;
  workerLogs: Array<{
    id: string;
    date: string;
    note: string;
    category: string;
    createdByName: string;
    createdAt: string;
  }>;
  timeClockShifts: Array<{
    id: string;
    projectId: string;
    projectName: string | null;
    clockIn: string;
    clockOut: string | null;
    totalHours: number | null;
    notes: string | null;
  }>;
  currentShift: {
    id: string;
    projectId: string;
    projectName: string | null;
    clockIn: string;
  } | null;
}

export function RatingStars({ rating, max = 5 }: { rating: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          className={`h-4 w-4 ${
            i < rating
              ? "text-yellow-500 fill-yellow-500"
              : "text-muted-foreground/40"
          }`}
        />
      ))}
    </div>
  );
}

export function StarRatingInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="space-y-1" data-testid={`star-rating-input-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      <Label className="text-sm">{label}</Label>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 5 }, (_, i) => {
          const starValue = i + 1;
          return (
            <button
              key={i}
              type="button"
              className="cursor-pointer p-0.5"
              onClick={() => onChange(value === starValue ? 0 : starValue)}
              data-testid={`star-${label.toLowerCase().replace(/\s+/g, "-")}-${starValue}`}
            >
              <Star
                className={`h-5 w-5 ${
                  starValue <= value
                    ? "text-yellow-500 fill-yellow-500"
                    : "text-muted-foreground/40"
                }`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function getCertStatus(expiryDate: string | null): { label: string; className: string } {
  if (!expiryDate) return { label: "Active", className: "bg-green-500/15 text-green-600 border-transparent" };
  const now = Date.now();
  const expiry = new Date(expiryDate).getTime();
  if (expiry < now) return { label: "Expired", className: "bg-red-500/15 text-red-600 border-transparent" };
  const diff = (expiry - now) / (1000 * 60 * 60 * 24);
  if (diff <= 30) return { label: "Expiring Soon", className: "bg-amber-500/15 text-amber-600 border-transparent" };
  return { label: "Active", className: "bg-green-500/15 text-green-600 border-transparent" };
}
