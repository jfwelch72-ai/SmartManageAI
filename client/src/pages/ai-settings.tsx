import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Settings, Save, Filter, Lightbulb, Trash2 } from "lucide-react";
import { useState, useEffect } from "react";
import type { AISettings } from "@shared/schema";

// Task #2342 — server response shape for the per-org takeoff settings
// endpoint. `suppressionFloor` is a 0..1 decimal; `null` means "off".
interface TakeoffOrgSettingsResponse {
  suppressionFloor: number | null;
  defaults: { recommended: number; minSamples: number };
  bounds: { min: number; max: number };
}

// Task #2415 — lesson rows surfaced on the admin panel. Mirrors the
// shape returned by GET /api/ai-estimator/admin/lessons.
interface LessonRow {
  id: string;
  title: string;
  contentSnippet: string;
  scope: "global" | "cost_code" | "trade" | "surface" | string | null;
  status: "active" | "stale" | "deleted" | string | null;
  surface: string | null;
  costCode: string | null;
  tradeType: string | null;
  numericFacets: Record<string, unknown> | null;
  derivedFromFeedbackIds: string[] | null;
  supersedesRowId: string | null;
  indexedAt: string;
}

export default function AISettingsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<AISettings>({
    queryKey: ["/api/ai-settings"],
    enabled: !!user && user.role === 'ADMIN',
  });

  // Task #2342 — per-org takeoff suppression floor lives on the
  // organizations row (the global ai_settings row is shared across
  // every org); fetch it here so the admin tab is the single
  // settings surface.
  const { data: takeoffOrgSettings } = useQuery<TakeoffOrgSettingsResponse>({
    queryKey: ["/api/ai-features/takeoff/org-settings"],
    enabled: !!user && user.role === 'ADMIN',
  });

  // Empty string = "off" / not set, otherwise a percentage 0..50.
  const [suppressionFloorPct, setSuppressionFloorPct] = useState<string>("");
  useEffect(() => {
    if (takeoffOrgSettings) {
      setSuppressionFloorPct(
        takeoffOrgSettings.suppressionFloor == null
          ? ""
          : (takeoffOrgSettings.suppressionFloor * 100).toFixed(0),
      );
    }
  }, [takeoffOrgSettings]);

  const takeoffSettingsMutation = useMutation({
    mutationFn: async (input: { suppressionFloor: number | null }) => {
      const res = await apiRequest(
        "PUT",
        "/api/ai-features/takeoff/org-settings",
        input,
      );
      return (await res.json()) as TakeoffOrgSettingsResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/ai-features/takeoff/org-settings"],
      });
      toast({
        title: "Takeoff settings saved",
        description: "AI takeoff suppression floor updated.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: error.message || "Failed to update takeoff settings",
      });
    },
  });

  const [formData, setFormData] = useState({
    dailyRunsEnabled: true,
    dailyRunTime: "06:00",
    roleTasksEnabled: true,
    billingAlertsEnabled: true,
    profitabilityWarningsEnabled: true,
    crewSchedulingEnabled: true,
    bidRemindersEnabled: true,
    materialOrderingEnabled: true,
    modelName: "gpt-5",
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        dailyRunsEnabled: settings.dailyRunsEnabled,
        dailyRunTime: settings.dailyRunTime,
        roleTasksEnabled: settings.roleTasksEnabled,
        billingAlertsEnabled: settings.billingAlertsEnabled,
        profitabilityWarningsEnabled: settings.profitabilityWarningsEnabled,
        crewSchedulingEnabled: settings.crewSchedulingEnabled,
        bidRemindersEnabled: settings.bidRemindersEnabled,
        materialOrderingEnabled: settings.materialOrderingEnabled,
        modelName: settings.modelName,
      });
    }
  }, [settings]);

  // Task #2415 — qualitative lessons learned by the AI Estimator.
  // Admin-only list/delete view; the panel is hidden when the org has
  // never produced a lesson (the endpoint just returns an empty array).
  const {
    data: lessonsData,
    isLoading: lessonsLoading,
  } = useQuery<{ lessons: LessonRow[] }>({
    queryKey: ["/api/ai-estimator/admin/lessons"],
    enabled: !!user && user.role === "ADMIN",
  });

  const deleteLessonMutation = useMutation({
    mutationFn: async (lessonId: string) => {
      await apiRequest("DELETE", `/api/ai-estimator/admin/lessons/${lessonId}`);
      return lessonId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/ai-estimator/admin/lessons"],
      });
      toast({
        title: "Lesson deleted",
        description: "The lesson will no longer be injected into AI prompts.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Delete failed",
        description: error.message || "Failed to delete lesson",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<typeof formData>) => {
      return apiRequest("PATCH", "/api/ai-settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai-settings"] });
      toast({
        title: "Settings Updated",
        description: "AI PM settings have been saved successfully",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Update Failed",
        description: error.message || "Failed to update settings",
      });
    },
  });

  if (!user) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Please log in to view AI settings</p>
      </div>
    );
  }

  if (user.role !== 'ADMIN') {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Admin access required</p>
      </div>
    );
  }

  const handleSave = () => {
    updateMutation.mutate(formData);
  };

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="h-8 w-8 text-primary" />
            AI Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure AI PM + CFO system behavior
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          data-testid="button-save-settings"
        >
          <Save className="h-4 w-4 mr-2" />
          {updateMutation.isPending ? "Saving..." : "Save Changes"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Daily Automation</CardTitle>
              <CardDescription>
                Configure when AI analysis runs automatically
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="dailyRuns" className="flex-1">
                  <div className="font-medium">Enable Daily Runs</div>
                  <div className="text-sm text-muted-foreground">
                    Automatically run AI analysis every day
                  </div>
                </Label>
                <Switch
                  id="dailyRuns"
                  checked={formData.dailyRunsEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, dailyRunsEnabled: checked })}
                  data-testid="switch-daily-runs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="runTime">Daily Run Time</Label>
                <Input
                  id="runTime"
                  type="time"
                  value={formData.dailyRunTime}
                  onChange={(e) => setFormData({ ...formData, dailyRunTime: e.target.value })}
                  disabled={!formData.dailyRunsEnabled}
                  data-testid="input-run-time"
                />
                <p className="text-sm text-muted-foreground">
                  Time zone: America/New_York (Eastern Time)
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Feature Toggles</CardTitle>
              <CardDescription>
                Enable or disable specific AI capabilities
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="roleTasks" className="flex-1">
                  <div className="font-medium">Role-Based Tasks</div>
                  <div className="text-sm text-muted-foreground">
                    Generate daily tasks for each user role
                  </div>
                </Label>
                <Switch
                  id="roleTasks"
                  checked={formData.roleTasksEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, roleTasksEnabled: checked })}
                  data-testid="switch-role-tasks"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="billing" className="flex-1">
                  <div className="font-medium">Billing Alerts</div>
                  <div className="text-sm text-muted-foreground">
                    Track invoices, payments, and billing cycles
                  </div>
                </Label>
                <Switch
                  id="billing"
                  checked={formData.billingAlertsEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, billingAlertsEnabled: checked })}
                  data-testid="switch-billing-alerts"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="profitability" className="flex-1">
                  <div className="font-medium">Profitability Warnings</div>
                  <div className="text-sm text-muted-foreground">
                    Monitor budgets and flag cost overruns
                  </div>
                </Label>
                <Switch
                  id="profitability"
                  checked={formData.profitabilityWarningsEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, profitabilityWarningsEnabled: checked })}
                  data-testid="switch-profitability"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="crew" className="flex-1">
                  <div className="font-medium">Crew Scheduling</div>
                  <div className="text-sm text-muted-foreground">
                    Optimize crew assignments and track overtime
                  </div>
                </Label>
                <Switch
                  id="crew"
                  checked={formData.crewSchedulingEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, crewSchedulingEnabled: checked })}
                  data-testid="switch-crew-scheduling"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="bids" className="flex-1">
                  <div className="font-medium">Bid Reminders</div>
                  <div className="text-sm text-muted-foreground">
                    Track bid deadlines and follow-ups
                  </div>
                </Label>
                <Switch
                  id="bids"
                  checked={formData.bidRemindersEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, bidRemindersEnabled: checked })}
                  data-testid="switch-bid-reminders"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="materials" className="flex-1">
                  <div className="font-medium">Material Ordering</div>
                  <div className="text-sm text-muted-foreground">
                    Alert when materials are needed urgently
                  </div>
                </Label>
                <Switch
                  id="materials"
                  checked={formData.materialOrderingEnabled}
                  onCheckedChange={(checked) => setFormData({ ...formData, materialOrderingEnabled: checked })}
                  data-testid="switch-material-ordering"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Model</CardTitle>
              <CardDescription>
                Configure which OpenAI model to use
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Label htmlFor="model">Model Name</Label>
                <Input
                  id="model"
                  value={formData.modelName}
                  onChange={(e) => setFormData({ ...formData, modelName: e.target.value })}
                  placeholder="gpt-5"
                  data-testid="input-model-name"
                />
                <p className="text-sm text-muted-foreground">
                  Recommended: gpt-5 (latest) or gpt-4o
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Task #2342 — per-org AI takeoff suppression floor. */}
          <Card data-testid="card-takeoff-suppression">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Filter className="h-5 w-5 text-primary" />
                AI Takeoff — Auto-Suppress Low-Acceptance Buckets
              </CardTitle>
              <CardDescription>
                Hide AI takeoff suggestions whose confidence-bucket
                acceptance rate is below the floor. Suggestions stay in
                the database (so the calibration job remains accurate)
                — they're just hidden behind a "Show N suppressed"
                disclosure in the takeoff panel. Only buckets with at
                least{" "}
                {takeoffOrgSettings?.defaults.minSamples ?? 30} reviewed
                samples are eligible for suppression.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="suppression-floor">
                  Suppression floor (% empirical acceptance)
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="suppression-floor"
                    type="number"
                    min={(takeoffOrgSettings?.bounds.min ?? 0) * 100}
                    max={(takeoffOrgSettings?.bounds.max ?? 0.5) * 100}
                    step={1}
                    value={suppressionFloorPct}
                    onChange={(e) => setSuppressionFloorPct(e.target.value)}
                    placeholder="Off"
                    className="w-32"
                    data-testid="input-suppression-floor"
                  />
                  <span className="text-sm text-muted-foreground">
                    %
                  </span>
                  {takeoffOrgSettings && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setSuppressionFloorPct(
                          (
                            takeoffOrgSettings.defaults.recommended * 100
                          ).toFixed(0),
                        )
                      }
                      data-testid="button-suppression-recommended"
                    >
                      Use recommended (
                      {(
                        takeoffOrgSettings.defaults.recommended * 100
                      ).toFixed(0)}
                      %)
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSuppressionFloorPct("")}
                    data-testid="button-suppression-off"
                  >
                    Turn off
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Leave blank to disable. Max{" "}
                  {((takeoffOrgSettings?.bounds.max ?? 0.5) * 100).toFixed(
                    0,
                  )}
                  %.
                </p>
              </div>
              <div>
                <Button
                  type="button"
                  onClick={() => {
                    const trimmed = suppressionFloorPct.trim();
                    if (trimmed === "") {
                      takeoffSettingsMutation.mutate({
                        suppressionFloor: null,
                      });
                      return;
                    }
                    const pct = Number(trimmed);
                    if (!Number.isFinite(pct)) {
                      toast({
                        variant: "destructive",
                        title: "Invalid value",
                        description: "Enter a number between 0 and 50.",
                      });
                      return;
                    }
                    const min = (takeoffOrgSettings?.bounds.min ?? 0) * 100;
                    const max =
                      (takeoffOrgSettings?.bounds.max ?? 0.5) * 100;
                    if (pct < min || pct > max) {
                      toast({
                        variant: "destructive",
                        title: "Out of range",
                        description: `Floor must be between ${min}% and ${max}%.`,
                      });
                      return;
                    }
                    takeoffSettingsMutation.mutate({
                      suppressionFloor: pct / 100,
                    });
                  }}
                  disabled={takeoffSettingsMutation.isPending}
                  data-testid="button-save-suppression"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {takeoffSettingsMutation.isPending
                    ? "Saving..."
                    : "Save Takeoff Settings"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Task #2415 — Qualitative lessons learned from edits. */}
          <Card data-testid="card-lessons-learned">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-primary" />
                Lessons learned (AI Estimator)
              </CardTitle>
              <CardDescription>
                Short, structured notes the AI captures whenever someone
                edits an AI suggestion. Active lessons are injected as
                guidance into future AI Estimator prompts. Delete a
                lesson to stop using it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {lessonsLoading ? (
                <Skeleton className="h-24 w-full" data-testid="skeleton-lessons" />
              ) : !lessonsData || lessonsData.lessons.length === 0 ? (
                <p
                  className="text-sm text-muted-foreground"
                  data-testid="text-lessons-empty"
                >
                  No lessons yet. They will appear here automatically as
                  the AI learns from your edits.
                </p>
              ) : (
                <ul className="space-y-3">
                  {lessonsData.lessons.map((lesson) => (
                    <li
                      key={lesson.id}
                      className="rounded-md border p-3"
                      data-testid={`row-lesson-${lesson.id}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div
                            className="font-medium"
                            data-testid={`text-lesson-title-${lesson.id}`}
                          >
                            {lesson.title}
                          </div>
                          <p
                            className="mt-1 text-sm text-muted-foreground"
                            data-testid={`text-lesson-snippet-${lesson.id}`}
                          >
                            {lesson.contentSnippet}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {lesson.scope && (
                              <Badge
                                variant="secondary"
                                data-testid={`badge-lesson-scope-${lesson.id}`}
                              >
                                scope: {lesson.scope}
                              </Badge>
                            )}
                            {lesson.surface && (
                              <Badge
                                variant="outline"
                                data-testid={`badge-lesson-surface-${lesson.id}`}
                              >
                                {lesson.surface}
                              </Badge>
                            )}
                            {lesson.costCode && (
                              <Badge
                                variant="outline"
                                data-testid={`badge-lesson-costcode-${lesson.id}`}
                              >
                                cost code: {lesson.costCode}
                              </Badge>
                            )}
                            {lesson.tradeType && (
                              <Badge
                                variant="outline"
                                data-testid={`badge-lesson-trade-${lesson.id}`}
                              >
                                trade: {lesson.tradeType}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            deleteLessonMutation.mutate(lesson.id)
                          }
                          disabled={deleteLessonMutation.isPending}
                          aria-label="Delete lesson"
                          data-testid={`button-delete-lesson-${lesson.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
