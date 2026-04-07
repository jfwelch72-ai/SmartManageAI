import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import {
  ArrowUp,
  ArrowDown,
  Check,
  CheckCircle,
  AlertTriangle,
  Wrench,
  ChevronDown,
  ChevronUp,
  CalendarDays,
  Briefcase,
  Phone,
  Shield,
  MessageSquareQuote,
  Loader2,
  Star,
  Users,
  TrendingUp,
  MessageSquare,
} from "lucide-react";
import { type WorkerData, RatingStars, getCertStatus } from "./types";

export function OverviewTab({
  user,
  certifications,
  topSkills,
}: {
  user: WorkerData["user"];
  certifications: WorkerData["certifications"];
  topSkills: WorkerData["skills"];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Basic Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Worker ID</span>
            <span className="text-sm font-mono" data-testid="text-worker-id">{user.id.substring(0, 8)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Contact Phone</span>
            <span className="text-sm flex items-center gap-1" data-testid="text-worker-phone">
              <Phone className="h-3.5 w-3.5" />
              {user.phone || "Not provided"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Employment Type</span>
            <span className="text-sm" data-testid="text-employment-type">{user.employmentType || "Not specified"}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Trade</span>
            <span className="text-sm" data-testid="text-trade">{user.tradeSpecialization || "Not specified"}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Certifications</CardTitle>
        </CardHeader>
        <CardContent>
          {certifications.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-certs">No certifications on file</p>
          ) : (
            <div className="space-y-2">
              {certifications.map((cert) => {
                const status = getCertStatus(cert.expiryDate);
                return (
                  <div
                    key={cert.id}
                    className="flex items-center justify-between gap-2"
                    data-testid={`cert-row-${cert.id}`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Check className="h-4 w-4 text-green-600 shrink-0" />
                      <span className="text-sm truncate">{cert.certificationName}</span>
                    </div>
                    <Badge variant="secondary" className={`text-xs shrink-0 ${status.className}`}>
                      {status.label}
                    </Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Skill Highlights</CardTitle>
        </CardHeader>
        <CardContent>
          {topSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-skills">No skills recorded</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between gap-2"
                  data-testid={`skill-highlight-${skill.id}`}
                >
                  <span className="text-sm truncate">{skill.skillName}</span>
                  <RatingStars rating={skill.rating} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function SkillsTab({ skills }: { skills: WorkerData["skills"] }) {
  if (skills.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Wrench className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-skills-full">No skills have been recorded for this worker.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Full Skill Matrix</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {skills.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center justify-between gap-3 py-1.5 border-b last:border-b-0"
              data-testid={`skill-row-${skill.id}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm">{skill.skillName}</span>
                {skill.isVerified && (
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" data-testid={`verified-badge-${skill.id}`} />
                )}
              </div>
              <RatingStars rating={skill.rating} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function PerformanceTab({
  user,
  attendanceLogs,
  attendanceReliability,
  attendanceTrend,
  productivityLabel,
  qualityLabel,
  qualityIssues,
  safetyIncidents,
  supervisorNotes,
  performanceReviews,
}: {
  user: WorkerData["user"];
  attendanceLogs: WorkerData["attendanceLogs"];
  attendanceReliability: number | null;
  attendanceTrend: string | null;
  productivityLabel: string;
  qualityLabel: string;
  qualityIssues: WorkerData["qualityIssues"];
  safetyIncidents: WorkerData["safetyIncidents"];
  supervisorNotes: WorkerData["supervisorNotes"];
  performanceReviews: WorkerData["performanceReviews"];
}) {
  const isSuperintendent = user.role === "SUPERINTENDENT";
  const { toast } = useToast();
  const [newNoteText, setNewNoteText] = useState("");

  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const res = await apiRequest("POST", `/api/auth/manage-workers/${user.id}/notes`, { note });
      return res.json();
    },
    onSuccess: () => {
      setNewNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/manage-workers", user.id] });
      toast({ title: "Note added successfully" });
    },
    onError: () => {
      toast({ title: "Failed to add note", variant: "destructive" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="performance-metrics-grid">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Attendance Reliability</p>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold" data-testid="text-perf-attendance">
                {attendanceReliability !== null ? `${attendanceReliability}%` : "N/A"}
              </span>
              {attendanceTrend === "up" && <ArrowUp className="h-4 w-4 text-green-600" data-testid="icon-trend-up" />}
              {attendanceTrend === "down" && <ArrowDown className="h-4 w-4 text-red-600" data-testid="icon-trend-down" />}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Productivity Rating</p>
            <div className="flex items-center gap-2" data-testid="text-perf-productivity">
              <span className="text-2xl font-bold">{productivityLabel}</span>
              {productivityLabel === "Below Average" && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-prod-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Quality Issues</p>
            <div className="flex items-center gap-2" data-testid="text-perf-quality">
              <span className="text-2xl font-bold">{qualityLabel}</span>
              {qualityLabel === "High" && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-quality-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground mb-1">Safety Incidents</p>
            <div className="flex items-center gap-2" data-testid="text-perf-safety">
              <span className="text-2xl font-bold">{safetyIncidents.length}</span>
              {safetyIncidents.length > 0 && (
                <Badge variant="destructive" className="text-xs" data-testid="badge-safety-warning">
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Warning
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4" />
            Supervisor Notes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2" data-testid="add-note-form">
            <Textarea
              placeholder="Add a supervisor note..."
              value={newNoteText}
              onChange={(e) => setNewNoteText(e.target.value)}
              className="text-sm min-h-[60px]"
              data-testid="textarea-supervisor-note"
            />
            <Button
              size="sm"
              disabled={!newNoteText.trim() || addNoteMutation.isPending}
              onClick={() => addNoteMutation.mutate(newNoteText.trim())}
              data-testid="button-add-supervisor-note"
            >
              {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
            </Button>
          </div>
          {supervisorNotes.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-no-supervisor-notes">No supervisor notes.</p>
          ) : (
            <div className="space-y-3">
              {supervisorNotes.map((n) => (
                <div key={n.id} className="border-b pb-3 last:border-b-0 last:pb-0" data-testid={`supervisor-note-${n.id}`}>
                  <p className="text-sm italic">&ldquo;{n.note}&rdquo;</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    &mdash; {n.createdByName}{n.createdAt ? `, ${new Date(n.createdAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperintendent && performanceReviews.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Superintendent Metrics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(() => {
                const latest = performanceReviews[0];
                return (
                  <>
                    <div>
                      <p className="text-xs text-muted-foreground">Schedule Adherence</p>
                      <p className="text-sm font-medium" data-testid="text-schedule-adherence">
                        {latest.scheduleAdherence || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Cost Impact</p>
                      <p className="text-sm font-medium" data-testid="text-cost-control">
                        {latest.costControl || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Subcontractor Coordination</p>
                      <p className="text-sm font-medium" data-testid="text-sub-coordination">
                        {latest.subcontractorCoordination || "N/A"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Inspection Outcomes</p>
                      <p className="text-sm font-medium" data-testid="text-inspection-outcomes">
                        {latest.clientInspectionOutcomes || "N/A"}
                      </p>
                    </div>
                  </>
                );
              })()}
            </div>
          </CardContent>
        </Card>
      )}

      <PeerRatingsSection userId={user.id} />
      <RateThisWorkerSection userId={user.id} firstName={user.firstName} lastName={user.lastName} role={user.role} />
      <MyPeerScoresSection userId={user.id} />
    </div>
  );
}

const RATING_CATEGORIES = [
  { key: "teamwork", label: "Teamwork", icon: Users, color: "text-blue-500" },
  { key: "reliability", label: "Reliability", icon: CheckCircle, color: "text-green-500" },
  { key: "communication", label: "Communication", icon: MessageSquare, color: "text-purple-500" },
  { key: "helpfulness", label: "Helpfulness", icon: TrendingUp, color: "text-orange-500" },
] as const;

function InlineStarRating({ value, onChange, readonly = false, size = "md" }: {
  value: number;
  onChange?: (v: number) => void;
  readonly?: boolean;
  size?: "sm" | "md";
}) {
  const [hover, setHover] = useState(0);
  const sizeClass = size === "sm" ? "w-4 h-4" : "w-6 h-6";

  return (
    <div className="flex gap-0.5" data-testid="star-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          className={`${readonly ? "cursor-default" : "cursor-pointer hover:scale-110"} transition-transform`}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          onClick={() => onChange?.(star)}
          data-testid={`star-${star}`}
        >
          <Star
            className={`${sizeClass} ${
              star <= (hover || value)
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground/30"
            } transition-colors`}
          />
        </button>
      ))}
    </div>
  );
}

function RateThisWorkerSection({ userId, firstName, lastName, role }: { userId: string; firstName: string; lastName: string; role: string }) {
  const { user: authUser } = useAuth();
  const canSubmit = useFeaturePermission("canSubmitPeerRatings");
  const { toast } = useToast();
  const [ratings, setRatings] = useState({ teamwork: 0, reliability: 0, communication: 0, helpfulness: 0 });
  const [comment, setComment] = useState("");

  const { data: rateableCoworkers } = useQuery<Array<{ id: string; alreadyRated: boolean }>>({
    queryKey: ["/api/peer-ratings/rateable-coworkers"],
    enabled: canSubmit && !!authUser && authUser.id !== userId,
  });

  const alreadyRated = rateableCoworkers?.find(c => c.id === userId)?.alreadyRated ?? false;
  const isRateable = rateableCoworkers?.some(c => c.id === userId) ?? false;

  const submitMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/peer-ratings", {
        rateeId: userId,
        ...ratings,
        comment: comment.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Rating submitted", description: `Your rating for ${firstName} has been recorded.` });
      queryClient.invalidateQueries({ queryKey: ["/api/peer-ratings/rateable-coworkers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/peer-ratings/user", userId, "scores"] });
      setRatings({ teamwork: 0, reliability: 0, communication: 0, helpfulness: 0 });
      setComment("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  if (!canSubmit || !authUser || authUser.id === userId) return null;

  if (!isRateable) return null;

  const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase();
  const allRated = Object.values(ratings).every((v) => v > 0);

  if (alreadyRated) {
    return (
      <Card data-testid="rate-worker-already-rated">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4" />
            Rate This Worker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span data-testid="text-already-rated">You have already rated {firstName} this period.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="rate-worker-form-card">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="text-base" data-testid="text-rate-worker-name">Rate {firstName} {lastName}</CardTitle>
            <CardDescription>{role?.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {RATING_CATEGORIES.map(({ key, label, icon: Icon, color }) => (
          <div key={key} className="flex items-center justify-between" data-testid={`rating-category-${key}`}>
            <div className="flex items-center gap-2">
              <Icon className={`w-5 h-5 ${color}`} />
              <span className="font-medium text-sm">{label}</span>
            </div>
            <InlineStarRating
              value={ratings[key as keyof typeof ratings]}
              onChange={(v) => setRatings((prev) => ({ ...prev, [key]: v }))}
            />
          </div>
        ))}

        <Separator />

        <div className="space-y-2">
          <label className="text-sm font-medium">Comment (optional)</label>
          <Textarea
            placeholder="Share any additional feedback..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            data-testid="input-rating-comment"
          />
        </div>

        <Button
          className="w-full"
          disabled={!allRated || submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
          data-testid="button-submit-rating"
        >
          {submitMutation.isPending ? "Submitting..." : "Submit Rating"}
        </Button>
        {!allRated && (
          <p className="text-xs text-muted-foreground text-center">Please rate all four categories to submit.</p>
        )}
      </CardContent>
    </Card>
  );
}

function MyPeerScoresSection({ userId }: { userId: string }) {
  const { user: authUser } = useAuth();
  const canView = useFeaturePermission("canViewPeerRatings");

  const isOwnProfile = authUser?.id === userId;

  const { data: scores, isLoading } = useQuery<{
    avgTeamwork: number | null;
    avgReliability: number | null;
    avgCommunication: number | null;
    avgHelpfulness: number | null;
    totalRatings: number;
  }>({
    queryKey: ["/api/peer-ratings/my-scores"],
    enabled: canView && isOwnProfile,
  });

  if (!canView || !isOwnProfile) return null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4" />
            My Peer Scores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {RATING_CATEGORIES.map(({ key }) => (
              <div key={key} className="h-16 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!scores || scores.totalRatings === 0) {
    return (
      <Card data-testid="my-peer-scores-empty">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="h-4 w-4" />
            My Peer Scores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <Star className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-my-scores">No ratings received yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Your coworkers haven't rated you this period.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const scoreMap: Record<string, number | null> = {
    teamwork: scores.avgTeamwork,
    reliability: scores.avgReliability,
    communication: scores.avgCommunication,
    helpfulness: scores.avgHelpfulness,
  };

  return (
    <Card data-testid="my-peer-scores-section">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Star className="h-4 w-4" />
          My Peer Scores
          <Badge variant="secondary" className="ml-auto" data-testid="badge-my-total-ratings">
            {scores.totalRatings} rating{scores.totalRatings !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {RATING_CATEGORIES.map(({ key, label, icon: Icon, color }) => {
            const avg = scoreMap[key];
            return (
              <div key={key} className="p-3 bg-muted/50 rounded-lg" data-testid={`my-score-card-${key}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="font-medium text-sm">{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold" data-testid={`text-my-score-${key}`}>
                    {avg != null ? avg.toFixed(1) : "—"}
                  </span>
                  <InlineStarRating value={Math.round(avg || 0)} readonly size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function PeerScoreBar({ label, value }: { label: string; value: number | null }) {
  const displayValue = value !== null ? value.toFixed(1) : "—";
  const pct = value !== null ? (value / 5) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{displayValue}/5</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-yellow-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function PeerRatingsSection({ userId }: { userId: string }) {
  const { data: peerScores, isLoading } = useQuery<{
    avgTeamwork: number | null;
    avgReliability: number | null;
    avgCommunication: number | null;
    avgHelpfulness: number | null;
    totalRatings: number;
    anonymityMode?: string;
    individualRatings?: Array<{
      id: string;
      teamwork: number;
      reliability: number;
      communication: number;
      helpfulness: number;
      comment: string | null;
      period: string;
      createdAt: string;
      raterId?: string | null;
      raterFirstName?: string | null;
      raterLastName?: string | null;
    }>;
  }>({
    queryKey: ["/api/peer-ratings/user", userId, "scores"],
    queryFn: async () => {
      const res = await fetch(`/api/peer-ratings/user/${userId}/scores`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch peer scores");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Peer Ratings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-8 bg-muted rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!peerScores || peerScores.totalRatings === 0) {
    return (
      <Card data-testid="peer-ratings-section-empty">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4" />
            Peer Ratings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" data-testid="text-no-peer-ratings">No peer ratings received yet.</p>
        </CardContent>
      </Card>
    );
  }

  const overallAvg = [
    peerScores.avgTeamwork, peerScores.avgReliability,
    peerScores.avgCommunication, peerScores.avgHelpfulness,
  ].filter(v => v !== null);
  const avgOverall = overallAvg.length > 0
    ? (overallAvg.reduce((s, v) => s + v!, 0) / overallAvg.length).toFixed(1)
    : "—";

  return (
    <Card data-testid="peer-ratings-section">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Peer Ratings
          <Badge variant="secondary" className="ml-auto" data-testid="badge-peer-rating-count">
            {peerScores.totalRatings} rating{peerScores.totalRatings !== 1 ? "s" : ""}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
          <span className="text-xl font-bold" data-testid="text-peer-overall-score">{avgOverall}</span>
          <span className="text-sm text-muted-foreground">overall average</span>
        </div>
        <PeerScoreBar label="Teamwork" value={peerScores.avgTeamwork} />
        <PeerScoreBar label="Reliability" value={peerScores.avgReliability} />
        <PeerScoreBar label="Communication" value={peerScores.avgCommunication} />
        <PeerScoreBar label="Helpfulness" value={peerScores.avgHelpfulness} />

        {peerScores.individualRatings && peerScores.individualRatings.length > 0 && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <h4 className="text-sm font-medium text-muted-foreground">Individual Ratings</h4>
            {peerScores.anonymityMode === "managers_can_see" && (
              <p className="text-xs text-muted-foreground italic">Rater identity visible (managers_can_see mode)</p>
            )}
            {peerScores.individualRatings.map((rating) => (
              <div key={rating.id} className="p-3 bg-muted/50 rounded-lg space-y-1" data-testid={`peer-rating-detail-${rating.id}`}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{rating.period}</span>
                  {rating.raterFirstName ? (
                    <span data-testid={`text-rater-name-${rating.id}`}>
                      Rated by: {rating.raterFirstName} {rating.raterLastName}
                    </span>
                  ) : (
                    <span>Anonymous</span>
                  )}
                </div>
                <div className="flex gap-3 text-xs">
                  <span>T: {rating.teamwork}</span>
                  <span>R: {rating.reliability}</span>
                  <span>C: {rating.communication}</span>
                  <span>H: {rating.helpfulness}</span>
                </div>
                {rating.comment && (
                  <p className="text-sm text-muted-foreground italic">"{rating.comment}"</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ProjectsTab({
  projectGroups,
  projectNameMap,
  currentShift,
  expandedProjects,
  toggleProject,
}: {
  projectGroups: Record<string, WorkerData["timeClockShifts"]>;
  projectNameMap: Record<string, string>;
  currentShift: WorkerData["currentShift"];
  expandedProjects: Set<string>;
  toggleProject: (pid: string) => void;
}) {
  const projectIds = Object.keys(projectGroups);

  if (projectIds.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Briefcase className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-projects">No project history</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {projectIds.map((pid) => {
        const shifts = projectGroups[pid];
        const isCurrent = currentShift?.projectId === pid;
        const totalHours = shifts.reduce((sum, s) => sum + (s.totalHours || 0), 0);
        const expanded = expandedProjects.has(pid);
        const firstShift = shifts.reduce((earliest, s) => {
          return new Date(s.clockIn) < new Date(earliest.clockIn) ? s : earliest;
        }, shifts[0]);
        const lastShift = shifts.reduce((latest, s) => {
          const compare = s.clockOut || s.clockIn;
          const latestCompare = latest.clockOut || latest.clockIn;
          return new Date(compare) > new Date(latestCompare) ? s : latest;
        }, shifts[0]);

        return (
          <Card key={pid}>
            <CardContent className="pt-4">
              <div
                className="flex items-center justify-between gap-2 cursor-pointer"
                onClick={() => toggleProject(pid)}
                data-testid={`project-row-${pid}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Briefcase className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{projectNameMap[pid] || `Project ${pid.substring(0, 8)}`}</span>
                  {isCurrent ? (
                    <Badge variant="secondary" className="text-xs bg-green-500/15 text-green-600 border-transparent shrink-0">
                      Current
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs shrink-0">Past</Badge>
                  )}
                </div>
                {expanded ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </div>
              {expanded && (
                <div className="mt-3 space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Duration</span>
                    <span className="text-sm" data-testid={`text-project-duration-${pid}`}>
                      {new Date(firstShift.clockIn).toLocaleDateString()} &ndash;{" "}
                      {lastShift.clockOut
                        ? new Date(lastShift.clockOut).toLocaleDateString()
                        : "Present"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Total Hours</span>
                    <span className="text-sm font-medium" data-testid={`text-project-hours-${pid}`}>
                      {totalHours.toFixed(1)} hrs
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Shifts Logged</span>
                    <span className="text-sm" data-testid={`text-project-shifts-${pid}`}>
                      {shifts.length}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function LogsTab({
  workerLogs,
  logNote,
  setLogNote,
  logCategory,
  setLogCategory,
  logDate,
  setLogDate,
  addLogMutation,
}: {
  workerLogs: WorkerData["workerLogs"];
  logNote: string;
  setLogNote: (v: string) => void;
  logCategory: string;
  setLogCategory: (v: string) => void;
  logDate: string;
  setLogDate: (v: string) => void;
  addLogMutation: { mutate: () => void; isPending: boolean };
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Add Note</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={logNote}
            onChange={(e) => setLogNote(e.target.value)}
            placeholder="Enter a note about this worker..."
            rows={3}
            className="resize-none"
            data-testid="textarea-log-note"
          />
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Label className="text-xs">Category</Label>
              <Select value={logCategory} onValueChange={setLogCategory}>
                <SelectTrigger data-testid="select-log-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GENERAL">General</SelectItem>
                  <SelectItem value="INCIDENT">Incident</SelectItem>
                  <SelectItem value="PERFORMANCE">Performance</SelectItem>
                  <SelectItem value="SAFETY">Safety</SelectItem>
                  <SelectItem value="ATTENDANCE">Attendance</SelectItem>
                  <SelectItem value="COMMENDATION">Commendation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                data-testid="input-log-date"
              />
            </div>
            <Button
              size="sm"
              onClick={() => addLogMutation.mutate()}
              disabled={addLogMutation.isPending || !logNote.trim()}
              data-testid="button-submit-log"
            >
              {addLogMutation.isPending ? "Saving..." : "Add Note"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {workerLogs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <CalendarDays className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-logs">No log entries yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {[...workerLogs]
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
            .map((log) => (
              <Card key={log.id}>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3" data-testid={`log-row-${log.id}`}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{log.note}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {log.createdByName} &middot; {new Date(log.date).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0" data-testid={`badge-log-category-${log.id}`}>
                      {log.category}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
