import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Star,
  ClipboardCheck,
  ShieldAlert,
  AlertTriangle,
  FileCheck,
  Briefcase,
  TrendingUp,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type {
  EmployeePerformanceProfile,
  AttendanceLog,
  SafetyIncident,
  QualityIssue,
  PerformanceReview,
} from "@shared/schema";

function RatingStars({ rating, size = "sm" }: { rating: number; size?: "sm" | "md" }) {
  const dim = size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`${dim} ${s <= rating ? "text-yellow-500 fill-yellow-500" : "text-muted-foreground/40"}`}
        />
      ))}
    </div>
  );
}

function CollapsibleSection({
  title,
  icon: Icon,
  badge,
  children,
  defaultOpen = false,
  testId,
}: {
  title: string;
  icon: React.ElementType;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  testId: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader
        className="pb-3 cursor-pointer flex flex-row items-center justify-between gap-2"
        onClick={() => setOpen(!open)}
        data-testid={testId}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">{title}</CardTitle>
          {badge && (
            <Badge variant="secondary" className="text-xs">
              {badge}
            </Badge>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export default function PerformanceHistoryTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isManager = ["SUPERINTENDENT", "MANAGER", "OFFICE_MANAGER", "ADMIN"].includes(user?.role || "");
  const isSuperintendent = user?.role === "SUPERINTENDENT";

  const [editingOverview, setEditingOverview] = useState(false);
  const [expLevel, setExpLevel] = useState("");
  const [prodTendencies, setProdTendencies] = useState("");
  const [pastProj, setPastProj] = useState("");

  const { data: perfProfile, isLoading: loadingProfile } = useQuery<EmployeePerformanceProfile | null>({
    queryKey: ["/api/auth/my-performance-profile"],
  });

  const { data: attendanceLogs = [], isLoading: loadingAttendance } = useQuery<AttendanceLog[]>({
    queryKey: ["/api/auth/my-attendance-logs"],
  });

  const { data: safetyIncidents = [], isLoading: loadingSafety } = useQuery<SafetyIncident[]>({
    queryKey: ["/api/auth/my-safety-incidents"],
  });

  const { data: qualityIssues = [], isLoading: loadingQuality } = useQuery<QualityIssue[]>({
    queryKey: ["/api/auth/my-quality-issues"],
  });

  const { data: perfReviews = [], isLoading: loadingReviews } = useQuery<PerformanceReview[]>({
    queryKey: ["/api/auth/my-performance-reviews"],
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/auth/my-performance-profile", {
        experienceLevel: expLevel || null,
        productivityTendencies: prodTendencies || null,
        pastProjects: pastProj || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/my-performance-profile"] });
      toast({ title: "Employee overview updated" });
      setEditingOverview(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const startEdit = () => {
    setExpLevel(perfProfile?.experienceLevel || "");
    setProdTendencies(perfProfile?.productivityTendencies || "");
    setPastProj(perfProfile?.pastProjects || "");
    setEditingOverview(true);
  };

  const attendanceStats = {
    present: attendanceLogs.filter((l) => l.status === "PRESENT").length,
    absent: attendanceLogs.filter((l) => l.status === "ABSENT").length,
    late: attendanceLogs.filter((l) => l.status === "LATE").length,
    excused: attendanceLogs.filter((l) => l.status === "EXCUSED").length,
    total: attendanceLogs.length,
  };

  const avgOverallRating = perfReviews.length > 0
    ? (perfReviews.reduce((sum, r) => sum + r.overallRating, 0) / perfReviews.length).toFixed(1)
    : null;

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Employee Overview"
        icon={Briefcase}
        defaultOpen={true}
        testId="section-employee-overview"
      >
        {loadingProfile ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : editingOverview ? (
          <div className="space-y-4">
            <div>
              <Label htmlFor="expLevel">Experience Level</Label>
              <Select value={expLevel} onValueChange={setExpLevel}>
                <SelectTrigger id="expLevel" data-testid="select-experience-level">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="JUNIOR">Junior</SelectItem>
                  <SelectItem value="MID">Mid-Level</SelectItem>
                  <SelectItem value="SENIOR">Senior</SelectItem>
                  <SelectItem value="LEAD">Lead / Foreman</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="pastProj">Past Projects Worked On</Label>
              <Textarea
                id="pastProj"
                value={pastProj}
                onChange={(e) => setPastProj(e.target.value)}
                placeholder="List past projects, one per line"
                rows={3}
                className="resize-none"
                data-testid="textarea-past-projects"
              />
            </div>
            <div>
              <Label htmlFor="prodTendencies">Productivity Tendencies</Label>
              <Textarea
                id="prodTendencies"
                value={prodTendencies}
                onChange={(e) => setProdTendencies(e.target.value)}
                placeholder="e.g. Fast installer, detail-oriented, excels at finish work"
                rows={2}
                className="resize-none"
                data-testid="textarea-productivity-tendencies"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => updateProfileMutation.mutate()}
                disabled={updateProfileMutation.isPending}
                data-testid="button-save-overview"
              >
                {updateProfileMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button variant="outline" onClick={() => setEditingOverview(false)} data-testid="button-cancel-overview">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Experience Level</p>
                <p className="text-sm font-medium" data-testid="text-experience-level">
                  {perfProfile?.experienceLevel
                    ? { JUNIOR: "Junior", MID: "Mid-Level", SENIOR: "Senior", LEAD: "Lead / Foreman" }[perfProfile.experienceLevel] || perfProfile.experienceLevel
                    : "Not set"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Rating</p>
                <div className="flex items-center gap-1.5">
                  {avgOverallRating ? (
                    <>
                      <RatingStars rating={Math.round(Number(avgOverallRating))} />
                      <span className="text-sm font-medium" data-testid="text-avg-rating">{avgOverallRating}</span>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground" data-testid="text-avg-rating">No reviews yet</span>
                  )}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Safety Record</p>
                <p className="text-sm font-medium" data-testid="text-safety-count">
                  {safetyIncidents.length === 0 ? "Clean record" : `${safetyIncidents.length} incident${safetyIncidents.length > 1 ? "s" : ""}`}
                </p>
              </div>
            </div>
            {perfProfile?.pastProjects && (
              <div>
                <p className="text-xs text-muted-foreground">Past Projects</p>
                <p className="text-sm whitespace-pre-line" data-testid="text-past-projects">{perfProfile.pastProjects}</p>
              </div>
            )}
            {perfProfile?.productivityTendencies && (
              <div>
                <p className="text-xs text-muted-foreground">Productivity Tendencies</p>
                <p className="text-sm" data-testid="text-productivity-tendencies">{perfProfile.productivityTendencies}</p>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={startEdit} data-testid="button-edit-overview">
              Edit Overview
            </Button>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Attendance & Reliability"
        icon={ClipboardCheck}
        badge={attendanceStats.total > 0 ? `${attendanceStats.total} entries` : undefined}
        testId="section-attendance"
      >
        {loadingAttendance ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ) : (
          <div className="space-y-4">
            {attendanceStats.total > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="text-center">
                  <p className="text-lg font-bold text-green-600" data-testid="text-present-count">{attendanceStats.present}</p>
                  <p className="text-xs text-muted-foreground">Present</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-red-600" data-testid="text-absent-count">{attendanceStats.absent}</p>
                  <p className="text-xs text-muted-foreground">Absent</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-amber-600" data-testid="text-late-count">{attendanceStats.late}</p>
                  <p className="text-xs text-muted-foreground">Late</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-blue-600" data-testid="text-excused-count">{attendanceStats.excused}</p>
                  <p className="text-xs text-muted-foreground">Excused</p>
                </div>
              </div>
            )}
            {attendanceLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendance records yet.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {attendanceLogs.slice(0, 20).map((log) => (
                  <div key={log.id} className="flex items-center justify-between gap-2 py-1.5 border-b last:border-b-0" data-testid={`row-attendance-${log.id}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-muted-foreground shrink-0">{log.date}</span>
                      <Badge
                        variant="secondary"
                        className={`text-xs ${
                          log.status === "PRESENT" ? "bg-green-500/15 text-green-600 border-transparent" :
                          log.status === "ABSENT" ? "bg-red-500/15 text-red-600 border-transparent" :
                          log.status === "LATE" ? "bg-amber-500/15 text-amber-600 border-transparent" :
                          "bg-blue-500/15 text-blue-600 border-transparent"
                        }`}
                      >
                        {log.status.replace("_", " ")}
                      </Badge>
                    </div>
                    {log.notes && <span className="text-xs text-muted-foreground truncate max-w-[200px]">{log.notes}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Safety Record"
        icon={ShieldAlert}
        badge={safetyIncidents.length > 0 ? `${safetyIncidents.length} incident${safetyIncidents.length > 1 ? "s" : ""}` : undefined}
        testId="section-safety"
      >
        {loadingSafety ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ) : safetyIncidents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No safety incidents recorded. Clean record.</p>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {safetyIncidents.map((incident) => (
              <div key={incident.id} className="border-b pb-3 last:border-b-0 last:pb-0" data-testid={`row-safety-${incident.id}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm text-muted-foreground">{incident.date}</span>
                  <Badge
                    variant="secondary"
                    className={`text-xs ${
                      incident.severity === "CRITICAL" ? "bg-red-500/15 text-red-600 border-transparent" :
                      incident.severity === "HIGH" ? "bg-orange-500/15 text-orange-600 border-transparent" :
                      incident.severity === "MEDIUM" ? "bg-amber-500/15 text-amber-600 border-transparent" :
                      "bg-blue-500/15 text-blue-600 border-transparent"
                    }`}
                  >
                    {incident.severity}
                  </Badge>
                </div>
                <p className="text-sm">{incident.description}</p>
                {incident.actionTaken && (
                  <p className="text-xs text-muted-foreground mt-1">Action: {incident.actionTaken}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Quality & Rework History"
        icon={AlertTriangle}
        badge={qualityIssues.length > 0 ? `${qualityIssues.length} issue${qualityIssues.length > 1 ? "s" : ""}` : undefined}
        testId="section-quality"
      >
        {loadingQuality ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ) : qualityIssues.length === 0 ? (
          <p className="text-sm text-muted-foreground">No quality issues recorded.</p>
        ) : (
          <div className="space-y-3 max-h-60 overflow-y-auto">
            {qualityIssues.map((issue) => (
              <div key={issue.id} className="border-b pb-3 last:border-b-0 last:pb-0" data-testid={`row-quality-${issue.id}`}>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm text-muted-foreground">{issue.date}</span>
                  <Badge variant="outline" className="text-xs">
                    {issue.category.replace("_", " ")}
                  </Badge>
                </div>
                <p className="text-sm">{issue.description}</p>
                {issue.resolution && (
                  <p className="text-xs text-muted-foreground mt-1">Resolution: {issue.resolution}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Performance Reviews"
        icon={FileCheck}
        badge={perfReviews.length > 0 ? `${perfReviews.length} review${perfReviews.length > 1 ? "s" : ""}` : undefined}
        testId="section-reviews"
      >
        {loadingReviews ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
          </div>
        ) : perfReviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">No performance reviews yet.</p>
        ) : (
          <div className="space-y-4 max-h-80 overflow-y-auto">
            {perfReviews.map((review) => (
              <div key={review.id} className="border-b pb-4 last:border-b-0 last:pb-0" data-testid={`row-review-${review.id}`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <p className="text-sm font-medium">{review.reviewerName}</p>
                    <p className="text-xs text-muted-foreground">{review.reviewDate}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <RatingStars rating={review.overallRating} size="md" />
                    <span className="text-sm font-medium">{review.overallRating}/5</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
                  {review.productivityRating && (
                    <div>
                      <p className="text-xs text-muted-foreground">Productivity</p>
                      <RatingStars rating={review.productivityRating} />
                    </div>
                  )}
                  {review.qualityRating && (
                    <div>
                      <p className="text-xs text-muted-foreground">Quality</p>
                      <RatingStars rating={review.qualityRating} />
                    </div>
                  )}
                  {review.safetyRating && (
                    <div>
                      <p className="text-xs text-muted-foreground">Safety</p>
                      <RatingStars rating={review.safetyRating} />
                    </div>
                  )}
                  {review.communicationRating && (
                    <div>
                      <p className="text-xs text-muted-foreground">Communication</p>
                      <RatingStars rating={review.communicationRating} />
                    </div>
                  )}
                  {review.leadershipRating && (
                    <div>
                      <p className="text-xs text-muted-foreground">Leadership</p>
                      <RatingStars rating={review.leadershipRating} />
                    </div>
                  )}
                </div>
                {review.notes && <p className="text-sm">{review.notes}</p>}

                {(review.scheduleAdherence || review.costControl || review.subcontractorCoordination || review.clientInspectionOutcomes) && (
                  <div className="mt-3 pt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Superintendent Metrics</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {review.scheduleAdherence && (
                        <div>
                          <p className="text-xs text-muted-foreground">Schedule Adherence</p>
                          <p className="text-sm">{review.scheduleAdherence}</p>
                        </div>
                      )}
                      {review.costControl && (
                        <div>
                          <p className="text-xs text-muted-foreground">Cost Control</p>
                          <p className="text-sm">{review.costControl}</p>
                        </div>
                      )}
                      {review.subcontractorCoordination && (
                        <div>
                          <p className="text-xs text-muted-foreground">Subcontractor Coordination</p>
                          <p className="text-sm">{review.subcontractorCoordination}</p>
                        </div>
                      )}
                      {review.clientInspectionOutcomes && (
                        <div>
                          <p className="text-xs text-muted-foreground">Client / Inspection Outcomes</p>
                          <p className="text-sm">{review.clientInspectionOutcomes}</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {isSuperintendent && (
        <CollapsibleSection
          title="Leadership & Project Management"
          icon={TrendingUp}
          testId="section-superintendent-metrics"
        >
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Superintendent-specific metrics are included in performance reviews above. This section provides an at-a-glance summary.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Projects Reviewed</p>
                <p className="text-sm font-medium" data-testid="text-super-projects-count">
                  {perfReviews.filter((r) => r.scheduleAdherence || r.costControl).length} reviews with project data
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Leadership Rating</p>
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const leadershipReviews = perfReviews.filter((r) => r.leadershipRating);
                    if (leadershipReviews.length === 0) return <span className="text-sm text-muted-foreground">No data yet</span>;
                    const avg = leadershipReviews.reduce((s, r) => s + (r.leadershipRating || 0), 0) / leadershipReviews.length;
                    return (
                      <>
                        <RatingStars rating={Math.round(avg)} />
                        <span className="text-sm font-medium">{avg.toFixed(1)}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Communication Rating</p>
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const commReviews = perfReviews.filter((r) => r.communicationRating);
                    if (commReviews.length === 0) return <span className="text-sm text-muted-foreground">No data yet</span>;
                    const avg = commReviews.reduce((s, r) => s + (r.communicationRating || 0), 0) / commReviews.length;
                    return (
                      <>
                        <RatingStars rating={Math.round(avg)} />
                        <span className="text-sm font-medium">{avg.toFixed(1)}</span>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Safety Incidents</p>
                <p className="text-sm font-medium" data-testid="text-super-safety-count">
                  {safetyIncidents.length === 0 ? "Zero incidents" : `${safetyIncidents.length} recorded`}
                </p>
              </div>
            </div>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}
