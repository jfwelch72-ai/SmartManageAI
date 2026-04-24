import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useEntitlements } from "@/hooks/useEntitlements";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Calendar, FileText, CheckCircle2, Clock, Loader2, Lock, MessageSquare, AlertCircle, ClipboardCheck, ShieldAlert, MailWarning } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { PayrollSettings } from "./types";
import { DAYS_OF_WEEK, DIGEST_CADENCES, DIGEST_WEEKDAYS, COMMON_TIMEZONES } from "./types";
import { useIntegrationStatus } from "@/hooks/use-integration-status";

export function CompanyNotificationsTab() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { can } = useEntitlements();
  const hasEnterpriseNotifications = can("ENTERPRISE_NOTIFICATIONS");
  const { status: integrationStatus } = useIntegrationStatus();

  const { data: payrollSettings, isLoading: loadingPayroll } = useQuery<PayrollSettings>({
    queryKey: ["/api/payroll/settings"],
    enabled: !!user && ["ADMIN", "MANAGER"].includes(user.role)
  });

  const [payrollForm, setPayrollForm] = useState({
    workWeekStartDay: "SUNDAY" as PayrollSettings["workWeekStartDay"],
    overtimeThresholdHours: 40,
    notifyOnWeekComplete: true,
    signerName: "",
    signerTitle: "",
    contractorAddress: "",
    defaultFringeOption: "PLAN" as PayrollSettings["defaultFringeOption"],
    certifiedPayrollDigestCadence: "WEEKLY" as PayrollSettings["certifiedPayrollDigestCadence"],
    certifiedPayrollDigestWeekday: 1,
    certifiedPayrollDigestHour: 8,
    certifiedPayrollDigestTimezone: "UTC",
  });

  const updatePayrollMutation = useMutation({
    mutationFn: async (data: typeof payrollForm) => {
      return await apiRequest("PUT", "/api/payroll/settings", {
        workWeekStartDay: data.workWeekStartDay,
        overtimeThresholdHours: String(data.overtimeThresholdHours),
        workWeekEndNotificationEnabled: data.notifyOnWeekComplete,
        autoGenerateWeeklyReports: data.notifyOnWeekComplete,
        signerName: data.signerName.trim() || null,
        signerTitle: data.signerTitle.trim() || null,
        contractorAddress: data.contractorAddress.trim() || null,
        defaultFringeOption: data.defaultFringeOption,
        certifiedPayrollDigestCadence: data.certifiedPayrollDigestCadence,
        certifiedPayrollDigestWeekday: data.certifiedPayrollDigestWeekday,
        certifiedPayrollDigestHour: data.certifiedPayrollDigestHour,
        certifiedPayrollDigestTimezone: data.certifiedPayrollDigestTimezone,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/settings"] });
      toast({ title: "Payroll settings updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update payroll settings", variant: "destructive" });
    }
  });

  // SWPPP overdue reminder settings (Task #1286) — admins can dial
  // how many follow-up reminders the nightly job sends per overdue
  // cycle and the minimum interval between them.
  type SwpppSettings = {
    organizationId: string;
    overdueReminderMaxCount: number;
    overdueReminderIntervalHours: number;
    defaults: { overdueReminderMaxCount: number; overdueReminderIntervalHours: number };
    bounds: {
      maxCount: { min: number; max: number };
      intervalHours: { min: number; max: number };
    };
  };
  const { data: swpppSettings, isLoading: loadingSwppp } = useQuery<SwpppSettings>({
    queryKey: ["/api/swppp/settings"],
    enabled: !!user && ["ADMIN", "MANAGER"].includes(user.role),
  });
  const [swpppForm, setSwpppForm] = useState({
    overdueReminderMaxCount: 5,
    overdueReminderIntervalHours: 22,
  });
  useEffect(() => {
    if (swpppSettings) {
      setSwpppForm({
        overdueReminderMaxCount: swpppSettings.overdueReminderMaxCount,
        overdueReminderIntervalHours: swpppSettings.overdueReminderIntervalHours,
      });
    }
  }, [swpppSettings]);
  // Task #1317: surface recent overdue-reminder activity so admins can
  // calibrate the cap/cadence above instead of guessing.
  type SwpppOverdueActivity = {
    windowDays: number;
    generatedAt: string;
    recentFanoutInspections: number;
    activeEscalatingInspections: number;
    topEscalating: Array<{
      id: string;
      projectId: string;
      projectName: string | null;
      projectCode: string | null;
      inspectionDate: string;
      correctiveActionDueDate: string | null;
      overdueReminderCount: number;
      lastOverdueNotifiedAt: string | null;
      status: string;
    }>;
  };
  const { data: swpppActivity, isLoading: loadingSwpppActivity } = useQuery<SwpppOverdueActivity>({
    queryKey: ["/api/swppp/overdue-reminders/activity"],
    enabled: !!user && ["ADMIN", "MANAGER"].includes(user.role),
  });

  const updateSwpppMutation = useMutation({
    mutationFn: async (data: typeof swpppForm) => {
      return await apiRequest("PUT", "/api/swppp/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/swppp/settings"] });
      toast({ title: "SWPPP reminder settings updated" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update SWPPP reminder settings", variant: "destructive" });
    },
  });

  // Task #1668 — per-org override for the repeated-failure backstop
  // notification threshold on the per-project scheduled RFI / submittal
  // log email worker. NULL means "use the global default" (env var
  // when set, otherwise the platform fallback of 3); a positive
  // integer in the bounds range overrides it for this org's
  // schedules only.
  type ProjectLogEmailSettings = {
    organizationId: string;
    failureThreshold: number | null;
    effectiveThreshold: number;
    defaults: {
      envThreshold: number | null;
      hardcodedDefault: number;
      globalDefault: number;
    };
    bounds: { min: number; max: number };
    // Task #1688 — schedules currently at or one shy of the
    // effective threshold, so admins can see who's been triggered
    // most recently and tune the cap with real data.
    streakingSchedules: Array<{
      scheduleId: string;
      projectId: string;
      projectName: string;
      projectCode: string | null;
      logType: "RFI" | "SUBMITTAL";
      consecutiveFailureCount: number;
      lastFailureNotifiedAt: string | null;
      lastFailureNotifiedStatus: string | null;
      lastAttemptAt: string | null;
      lastAttemptStatus: string | null;
    }>;
    streakingCutoff: number;
    // Task #1732 — per-org schedule for the failures-digest fan-out
    // (`processProjectLogEmailFailuresDigest`). Defaults preserve the
    // original "08:00 UTC daily" behavior so existing orgs see no
    // change until they edit the card.
    failuresDigest: {
      cadence: "OFF" | "DAILY" | "WEEKLY";
      weekday: number;
      hour: number;
      timezone: string;
      allowedCadences: ReadonlyArray<"OFF" | "DAILY" | "WEEKLY">;
      defaults: {
        cadence: "OFF" | "DAILY" | "WEEKLY";
        weekday: number;
        hour: number;
        timezone: string;
      };
    };
  };
  const { data: projectLogEmailSettings, isLoading: loadingProjectLogEmail } =
    useQuery<ProjectLogEmailSettings>({
      queryKey: ["/api/organizations/project-log-email-settings"],
      enabled: !!user && ["ADMIN", "MANAGER", "SUPER_ADMIN", "SUPERINTENDENT"].includes(user.role),
    });
  // Write access mirrors the PUT route's role list. SUPERINTENDENT can
  // see the current threshold but cannot change it, so we render the
  // controls disabled rather than showing a save button that would
  // 403 on click.
  const canEditProjectLogEmailThreshold = !!user
    && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role);
  // Local form state. `useGlobalDefault === true` means "save NULL,
  // fall back to the platform default"; `false` means "save this
  // explicit number". Two-piece state keeps the input editable even
  // when the org currently uses the global default (so admins can
  // type a number then flip the toggle to save it).
  const [projectLogEmailForm, setProjectLogEmailForm] = useState<{
    useGlobalDefault: boolean;
    threshold: number;
    // Task #1732 — per-org failures-digest schedule. Defaults match
    // the column defaults shipped with the migration so the form
    // renders sensibly even before the GET response arrives.
    failuresDigestCadence: "OFF" | "DAILY" | "WEEKLY";
    failuresDigestWeekday: number;
    failuresDigestHour: number;
    failuresDigestTimezone: string;
  }>({
    useGlobalDefault: true,
    threshold: 3,
    failuresDigestCadence: "DAILY",
    failuresDigestWeekday: 1,
    failuresDigestHour: 8,
    failuresDigestTimezone: "UTC",
  });
  useEffect(() => {
    if (projectLogEmailSettings) {
      setProjectLogEmailForm({
        useGlobalDefault: projectLogEmailSettings.failureThreshold === null,
        threshold: projectLogEmailSettings.failureThreshold
          ?? projectLogEmailSettings.defaults.globalDefault,
        failuresDigestCadence: projectLogEmailSettings.failuresDigest.cadence,
        failuresDigestWeekday: projectLogEmailSettings.failuresDigest.weekday,
        failuresDigestHour: projectLogEmailSettings.failuresDigest.hour,
        failuresDigestTimezone: projectLogEmailSettings.failuresDigest.timezone,
      });
    }
  }, [projectLogEmailSettings]);
  const updateProjectLogEmailMutation = useMutation({
    mutationFn: async (data: typeof projectLogEmailForm) => {
      // Send `null` when reverting to the global default, otherwise
      // the chosen integer. The PUT endpoint validates bounds. The
      // four digest fields ride on the same payload so a single Save
      // commits both halves of the card.
      return await apiRequest("PUT", "/api/organizations/project-log-email-settings", {
        threshold: data.useGlobalDefault ? null : data.threshold,
        failuresDigestCadence: data.failuresDigestCadence,
        failuresDigestWeekday: data.failuresDigestWeekday,
        failuresDigestHour: data.failuresDigestHour,
        failuresDigestTimezone: data.failuresDigestTimezone,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations/project-log-email-settings"] });
      toast({ title: "Scheduled log email settings updated" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update scheduled log email settings",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (payrollSettings) {
      setPayrollForm({
        workWeekStartDay: payrollSettings.workWeekStartDay,
        overtimeThresholdHours: parseInt(payrollSettings.overtimeThresholdHours) || 40,
        notifyOnWeekComplete: payrollSettings.workWeekEndNotificationEnabled,
        signerName: payrollSettings.signerName || "",
        signerTitle: payrollSettings.signerTitle || "",
        contractorAddress: payrollSettings.contractorAddress || "",
        defaultFringeOption: payrollSettings.defaultFringeOption || "PLAN",
        certifiedPayrollDigestCadence: payrollSettings.certifiedPayrollDigestCadence || "WEEKLY",
        certifiedPayrollDigestWeekday: payrollSettings.certifiedPayrollDigestWeekday ?? 1,
        certifiedPayrollDigestHour: payrollSettings.certifiedPayrollDigestHour ?? 8,
        certifiedPayrollDigestTimezone: payrollSettings.certifiedPayrollDigestTimezone || "UTC",
      });
    }
  }, [payrollSettings]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Payroll & Work Week Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure your work week schedule for time tracking and payroll reports
          </p>
        </div>
      </div>

      {loadingPayroll ? (
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-48" />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Work Week Configuration
              </CardTitle>
              <CardDescription>
                Define when your work week starts and overtime thresholds
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="work-week-start">Work Week Start Day</Label>
                <Select
                  value={payrollForm.workWeekStartDay}
                  onValueChange={(value: PayrollSettings["workWeekStartDay"]) => 
                    setPayrollForm(prev => ({ ...prev, workWeekStartDay: value }))
                  }
                >
                  <SelectTrigger data-testid="select-work-week-start">
                    <SelectValue placeholder="Select start day" />
                  </SelectTrigger>
                  <SelectContent>
                    {DAYS_OF_WEEK.map(day => (
                      <SelectItem key={day.value} value={day.value}>{day.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Weekly reports will be generated for the 7-day period starting on this day
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="overtime-threshold">Weekly Overtime Threshold (hours)</Label>
                <Input
                  id="overtime-threshold"
                  type="number"
                  min={1}
                  max={168}
                  value={payrollForm.overtimeThresholdHours}
                  onChange={(e) => setPayrollForm(prev => ({ ...prev, overtimeThresholdHours: parseInt(e.target.value) || 40 }))}
                  data-testid="input-overtime-threshold"
                />
                <p className="text-xs text-muted-foreground">
                  Hours worked beyond this threshold will be classified as overtime
                </p>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input
                  type="checkbox"
                  id="notify-week-complete"
                  checked={payrollForm.notifyOnWeekComplete}
                  onChange={(e) => setPayrollForm(prev => ({ ...prev, notifyOnWeekComplete: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300"
                  data-testid="checkbox-notify-week-complete"
                />
                <div className="space-y-0.5">
                  <Label htmlFor="notify-week-complete" className="cursor-pointer">
                    Notify office administrators when weekly reports are ready
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Send notifications when all shifts for a week have been approved
                  </p>
                </div>
              </div>

              <Button
                onClick={() => updatePayrollMutation.mutate(payrollForm)}
                disabled={updatePayrollMutation.isPending}
                className="mt-4"
                data-testid="button-save-payroll"
              >
                {updatePayrollMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Settings
              </Button>
            </CardContent>
          </Card>

          <Card data-testid="card-certified-payroll-settings">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Certified Payroll (WH-347)
              </CardTitle>
              <CardDescription>
                Signer info, contractor address, and default fringe-benefit option used on generated certified payroll PDFs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="signer-name">Authorized Signer Name</Label>
                  <Input
                    id="signer-name"
                    value={payrollForm.signerName}
                    onChange={(e) => setPayrollForm(prev => ({ ...prev, signerName: e.target.value }))}
                    placeholder="e.g., Jane Doe"
                    data-testid="input-signer-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signer-title">Signer Title</Label>
                  <Input
                    id="signer-title"
                    value={payrollForm.signerTitle}
                    onChange={(e) => setPayrollForm(prev => ({ ...prev, signerTitle: e.target.value }))}
                    placeholder="e.g., Payroll Officer"
                    data-testid="input-signer-title"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contractor-address">Contractor Mailing Address</Label>
                <Textarea
                  id="contractor-address"
                  value={payrollForm.contractorAddress}
                  onChange={(e) => setPayrollForm(prev => ({ ...prev, contractorAddress: e.target.value }))}
                  placeholder="Street, City, State ZIP"
                  rows={2}
                  data-testid="input-contractor-address"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-fringe-option">Default Fringe Benefit Option</Label>
                <Select
                  value={payrollForm.defaultFringeOption}
                  onValueChange={(value: PayrollSettings["defaultFringeOption"]) =>
                    setPayrollForm(prev => ({ ...prev, defaultFringeOption: value }))
                  }
                >
                  <SelectTrigger data-testid="select-fringe-option">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PLAN" data-testid="option-fringe-plan">Fringe benefits paid to approved plan(s)</SelectItem>
                    <SelectItem value="CASH" data-testid="option-fringe-cash">Fringe benefits paid in cash</SelectItem>
                    <SelectItem value="NONE" data-testid="option-fringe-none">No fringe benefits required</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pre-checked on the Statement of Compliance section of every generated certified payroll PDF.
                </p>
              </div>
              <Button
                onClick={() => updatePayrollMutation.mutate(payrollForm)}
                disabled={updatePayrollMutation.isPending}
                className="mt-2"
                data-testid="button-save-certified-payroll"
              >
                {updatePayrollMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Certified Payroll Settings
              </Button>
            </CardContent>
          </Card>

          <Card data-testid="card-certified-payroll-digest-schedule">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Certified Payroll Digest Schedule
              </CardTitle>
              <CardDescription>
                Choose how often payroll administrators receive the certified payroll digest summarizing recently generated PDFs, and what local day/time it should arrive.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="digest-cadence">Cadence</Label>
                <Select
                  value={payrollForm.certifiedPayrollDigestCadence}
                  onValueChange={(value: PayrollSettings["certifiedPayrollDigestCadence"]) =>
                    setPayrollForm(prev => ({ ...prev, certifiedPayrollDigestCadence: value }))
                  }
                >
                  <SelectTrigger data-testid="select-digest-cadence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIGEST_CADENCES.map(c => (
                      <SelectItem key={c.value} value={c.value} data-testid={`option-digest-cadence-${c.value.toLowerCase()}`}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Daily covers the last 24 hours; weekly covers the last 7 days; every other week covers the last 14 days.
                </p>
              </div>

              {(payrollForm.certifiedPayrollDigestCadence === "WEEKLY" || payrollForm.certifiedPayrollDigestCadence === "BIWEEKLY") && (
                <div className="space-y-2">
                  <Label htmlFor="digest-weekday">Day of week</Label>
                  <Select
                    value={String(payrollForm.certifiedPayrollDigestWeekday)}
                    onValueChange={(value) =>
                      setPayrollForm(prev => ({ ...prev, certifiedPayrollDigestWeekday: parseInt(value, 10) }))
                    }
                  >
                    <SelectTrigger data-testid="select-digest-weekday">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIGEST_WEEKDAYS.map(d => (
                        <SelectItem key={d.value} value={String(d.value)}>{d.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {payrollForm.certifiedPayrollDigestCadence !== "OFF" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="digest-hour">Send time (local hour)</Label>
                    <Select
                      value={String(payrollForm.certifiedPayrollDigestHour)}
                      onValueChange={(value) =>
                        setPayrollForm(prev => ({ ...prev, certifiedPayrollDigestHour: parseInt(value, 10) }))
                      }
                    >
                      <SelectTrigger data-testid="select-digest-hour">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 24 }).map((_, i) => (
                          <SelectItem key={i} value={String(i)}>
                            {i.toString().padStart(2, "0")}:00
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="digest-timezone">Timezone</Label>
                    <Select
                      value={payrollForm.certifiedPayrollDigestTimezone}
                      onValueChange={(value) =>
                        setPayrollForm(prev => ({ ...prev, certifiedPayrollDigestTimezone: value }))
                      }
                    >
                      <SelectTrigger data-testid="select-digest-timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMON_TIMEZONES.map(tz => (
                          <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                        ))}
                        {(() => {
                          const knownTimezones: readonly string[] = COMMON_TIMEZONES;
                          return !knownTimezones.includes(payrollForm.certifiedPayrollDigestTimezone) ? (
                            <SelectItem value={payrollForm.certifiedPayrollDigestTimezone}>{payrollForm.certifiedPayrollDigestTimezone}</SelectItem>
                          ) : null;
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <Button
                onClick={() => updatePayrollMutation.mutate(payrollForm)}
                disabled={updatePayrollMutation.isPending}
                className="mt-2"
                data-testid="button-save-digest-schedule"
              >
                {updatePayrollMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save Digest Schedule
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Weekly Reports
              </CardTitle>
              <CardDescription>Automated end-of-week hour summaries</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  Weekly payroll reports are automatically generated when all time clock shifts 
                  for a work week have been approved by a superintendent or manager.
                </AlertDescription>
              </Alert>
              <div className="text-sm space-y-2">
                <h4 className="font-medium">Report includes:</h4>
                <ul className="list-disc list-inside text-muted-foreground space-y-1">
                  <li>Total hours worked per employee</li>
                  <li>Regular hours and overtime breakdown</li>
                  <li>Week start and end dates</li>
                </ul>
              </div>
              <div className="text-sm space-y-2">
                <h4 className="font-medium">Current work week:</h4>
                <p className="text-muted-foreground">
                  Starts on {DAYS_OF_WEEK.find(d => d.value === payrollForm.workWeekStartDay)?.label || "Sunday"}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Notification Channels
              </CardTitle>
              <CardDescription>Available notification delivery channels for your organization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between py-1" data-testid="row-company-channel-email">
                  <div>
                    <p className="text-sm font-medium">Email</p>
                    <p className="text-xs text-muted-foreground">Available to all users</p>
                  </div>
                  <Badge variant="secondary" className="text-xs" data-testid="badge-available-email">Available</Badge>
                </div>
                <div className="flex items-center justify-between py-1" data-testid="row-company-channel-push">
                  <div>
                    <p className="text-sm font-medium">Web Push</p>
                    <p className="text-xs text-muted-foreground">Available to all users</p>
                  </div>
                  <Badge variant="secondary" className="text-xs" data-testid="badge-available-push">Available</Badge>
                </div>
                <div className="flex items-center justify-between py-1" data-testid="row-company-channel-sms">
                  <div>
                    <p className="text-sm font-medium">SMS</p>
                    <p className="text-xs text-muted-foreground">Text message alerts for critical notifications</p>
                  </div>
                  {!integrationStatus.twilio ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-unavailable-sms">
                          <AlertCircle className="h-3 w-3" />
                          Not configured
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>SMS requires additional setup by your administrator</TooltipContent>
                    </Tooltip>
                  ) : hasEnterpriseNotifications ? (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-available-sms">Available</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-sms">
                      <Lock className="h-3 w-3" />
                      Enterprise
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between py-1" data-testid="row-company-channel-teams">
                  <div>
                    <p className="text-sm font-medium">Microsoft Teams</p>
                    <p className="text-xs text-muted-foreground">Deliver notifications to Teams channels</p>
                  </div>
                  {hasEnterpriseNotifications ? (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-available-teams">Available</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-teams">
                      <Lock className="h-3 w-3" />
                      Enterprise
                    </Badge>
                  )}
                </div>
                <div className="flex items-center justify-between py-1" data-testid="row-company-channel-slack">
                  <div>
                    <p className="text-sm font-medium">Slack</p>
                    <p className="text-xs text-muted-foreground">Deliver notifications to Slack channels</p>
                  </div>
                  {hasEnterpriseNotifications ? (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-available-slack">Available</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-slack">
                      <Lock className="h-3 w-3" />
                      Enterprise
                    </Badge>
                  )}
                </div>
              </div>
              {!hasEnterpriseNotifications && (
                <Alert data-testid="alert-enterprise-upgrade">
                  <Lock className="h-4 w-4" />
                  <AlertDescription>
                    SMS, Microsoft Teams, and Slack notification channels are available on the Scale plan. 
                    Upgrade to unlock these channels for your organization.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2" data-testid="card-swppp-overdue-reminders">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                SWPPP Overdue Reminders
              </CardTitle>
              <CardDescription>
                Choose how aggressively the nightly job nags assignees about overdue
                SWPPP corrective actions. Defaults: {swpppSettings?.defaults.overdueReminderMaxCount ?? 5} reminders,
                every {swpppSettings?.defaults.overdueReminderIntervalHours ?? 22} hours.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingSwppp ? (
                <Skeleton className="h-24" />
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="swppp-max-count">Maximum follow-up reminders per overdue cycle</Label>
                      <Input
                        id="swppp-max-count"
                        type="number"
                        min={swpppSettings?.bounds.maxCount.min ?? 1}
                        max={swpppSettings?.bounds.maxCount.max ?? 365}
                        value={swpppForm.overdueReminderMaxCount}
                        onChange={(e) => {
                          const min = swpppSettings?.bounds.maxCount.min ?? 1;
                          const max = swpppSettings?.bounds.maxCount.max ?? 365;
                          const raw = parseInt(e.target.value, 10);
                          const next = Number.isFinite(raw) ? raw : min;
                          setSwpppForm((prev) => ({
                            ...prev,
                            overdueReminderMaxCount: Math.min(max, Math.max(min, next)),
                          }));
                        }}
                        data-testid="input-swppp-max-count"
                      />
                      <p className="text-xs text-muted-foreground">
                        After this many reminders the job stops escalating until the
                        item is closed or its due date changes.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="swppp-interval-hours">Minimum hours between reminders</Label>
                      <Input
                        id="swppp-interval-hours"
                        type="number"
                        min={swpppSettings?.bounds.intervalHours.min ?? 1}
                        max={swpppSettings?.bounds.intervalHours.max ?? 720}
                        value={swpppForm.overdueReminderIntervalHours}
                        onChange={(e) => {
                          const min = swpppSettings?.bounds.intervalHours.min ?? 1;
                          const max = swpppSettings?.bounds.intervalHours.max ?? 720;
                          const raw = parseInt(e.target.value, 10);
                          const next = Number.isFinite(raw) ? raw : min;
                          setSwpppForm((prev) => ({
                            ...prev,
                            overdueReminderIntervalHours: Math.min(max, Math.max(min, next)),
                          }));
                        }}
                        data-testid="input-swppp-interval-hours"
                      />
                      <p className="text-xs text-muted-foreground">
                        Set just under your daily cron interval (e.g. 22h for a
                        nightly job) so cron jitter doesn't skip a day.
                      </p>
                    </div>
                  </div>
                  <div
                    className="rounded-md border border-border bg-muted/40 p-4 space-y-3"
                    data-testid="section-swppp-overdue-activity"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Recent activity</h4>
                      <span className="text-xs text-muted-foreground">
                        Last {swpppActivity?.windowDays ?? 7} days
                      </span>
                    </div>
                    {loadingSwpppActivity ? (
                      <Skeleton className="h-16" />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="rounded border border-border bg-background p-3">
                            <p className="text-xs text-muted-foreground">
                              Inspections notified (last 7 days)
                            </p>
                            <p
                              className="text-2xl font-semibold"
                              data-testid="stat-swppp-recent-fanouts"
                            >
                              {swpppActivity?.recentFanoutInspections ?? 0}
                            </p>
                          </div>
                          <div className="rounded border border-border bg-background p-3">
                            <p className="text-xs text-muted-foreground">
                              Active escalation cycles
                            </p>
                            <p
                              className="text-2xl font-semibold"
                              data-testid="stat-swppp-active-escalating"
                            >
                              {swpppActivity?.activeEscalatingInspections ?? 0}
                            </p>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                            Currently escalating
                          </h5>
                          {swpppActivity && swpppActivity.topEscalating.length > 0 ? (
                            <ul
                              className="divide-y divide-border rounded border border-border bg-background"
                              data-testid="list-swppp-escalating"
                            >
                              {swpppActivity.topEscalating.map((item) => {
                                const cap = swpppSettings?.overdueReminderMaxCount
                                  ?? swpppSettings?.defaults.overdueReminderMaxCount
                                  ?? 5;
                                const atCap = item.overdueReminderCount >= cap;
                                const lastSent = item.lastOverdueNotifiedAt
                                  ? new Date(item.lastOverdueNotifiedAt).toLocaleString()
                                  : "—";
                                const params = new URLSearchParams();
                                if (item.projectId) params.set("projectId", item.projectId);
                                if (item.id) params.set("inspectionId", item.id);
                                const href = `/swppp-inspections${params.toString() ? `?${params.toString()}` : ""}`;
                                return (
                                  <li
                                    key={item.id}
                                    className="text-sm"
                                    data-testid={`row-swppp-escalating-${item.id}`}
                                  >
                                    <Link
                                      href={href}
                                      className="flex items-center justify-between gap-3 px-3 py-2 hover-elevate active-elevate-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                      data-testid={`link-swppp-escalating-${item.id}`}
                                    >
                                      <div className="min-w-0">
                                        <p className="truncate font-medium">
                                          {item.projectName || item.projectCode || "Unknown project"}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          Last reminder: {lastSent}
                                        </p>
                                      </div>
                                      <Badge
                                        variant={atCap ? "destructive" : "secondary"}
                                        className="shrink-0"
                                        data-testid={`badge-swppp-reminders-${item.id}`}
                                      >
                                        {item.overdueReminderCount} / {cap}
                                      </Badge>
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p
                              className="text-sm text-muted-foreground"
                              data-testid="text-swppp-escalating-empty"
                            >
                              No inspections are currently mid-escalation.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <Button
                      onClick={() => updateSwpppMutation.mutate(swpppForm)}
                      disabled={updateSwpppMutation.isPending}
                      data-testid="button-save-swppp-reminders"
                    >
                      {updateSwpppMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        "Save SWPPP Reminder Settings"
                      )}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2" data-testid="card-project-log-email-failure-threshold">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <MailWarning className="h-5 w-5" />
                Scheduled Log Email — Repeated Failure Alerts
              </CardTitle>
              <CardDescription>
                Choose how many failed sends in a row should trigger an
                in-app alert to all admins, managers, and super-admins
                for a project's scheduled RFI / submittal log emails.
                Platform default:{" "}
                <span data-testid="text-project-log-email-platform-default">
                  {projectLogEmailSettings?.defaults.globalDefault ?? 3}
                </span>{" "}
                consecutive failures.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingProjectLogEmail ? (
                <Skeleton className="h-24" />
              ) : (
                <>
                  <div className="flex items-start space-x-2">
                    <input
                      type="checkbox"
                      id="project-log-email-use-default"
                      checked={projectLogEmailForm.useGlobalDefault}
                      disabled={!canEditProjectLogEmailThreshold}
                      onChange={(e) =>
                        setProjectLogEmailForm((prev) => ({
                          ...prev,
                          useGlobalDefault: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 mt-1 rounded border-gray-300"
                      data-testid="checkbox-project-log-email-use-default"
                    />
                    <div className="space-y-0.5">
                      <Label
                        htmlFor="project-log-email-use-default"
                        className="cursor-pointer"
                      >
                        Use platform default ({projectLogEmailSettings?.defaults.globalDefault ?? 3} consecutive failures)
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Uncheck to set an organization-specific threshold below.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="project-log-email-threshold">
                      Consecutive failures before alerting admins
                    </Label>
                    <Input
                      id="project-log-email-threshold"
                      type="number"
                      min={projectLogEmailSettings?.bounds.min ?? 1}
                      max={projectLogEmailSettings?.bounds.max ?? 50}
                      value={projectLogEmailForm.threshold}
                      disabled={projectLogEmailForm.useGlobalDefault || !canEditProjectLogEmailThreshold}
                      onChange={(e) => {
                        const min = projectLogEmailSettings?.bounds.min ?? 1;
                        const max = projectLogEmailSettings?.bounds.max ?? 50;
                        const raw = parseInt(e.target.value, 10);
                        const next = Number.isFinite(raw) ? raw : min;
                        setProjectLogEmailForm((prev) => ({
                          ...prev,
                          threshold: Math.min(max, Math.max(min, next)),
                        }));
                      }}
                      data-testid="input-project-log-email-threshold"
                    />
                    <p className="text-xs text-muted-foreground">
                      Lower values surface broken distribution lists faster but
                      can be noisy. Higher values wait longer before paging the
                      whole admin pool. Allowed range:{" "}
                      {projectLogEmailSettings?.bounds.min ?? 1}–
                      {projectLogEmailSettings?.bounds.max ?? 50}.
                    </p>
                  </div>

                  <Alert data-testid="alert-project-log-email-effective-threshold">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Effective threshold for this organization:{" "}
                      <strong data-testid="text-project-log-email-effective-threshold">
                        {projectLogEmailForm.useGlobalDefault
                          ? (projectLogEmailSettings?.defaults.globalDefault ?? 3)
                          : projectLogEmailForm.threshold}
                      </strong>{" "}
                      consecutive failure
                      {(
                        projectLogEmailForm.useGlobalDefault
                          ? (projectLogEmailSettings?.defaults.globalDefault ?? 3)
                          : projectLogEmailForm.threshold
                      ) === 1
                        ? ""
                        : "s"}{" "}
                      will trigger the backstop alert.
                    </AlertDescription>
                  </Alert>

                  {/*
                    Task #1688 — surface schedules currently in a streaking-failure state
                    so admins can see who's been triggered (or is about to trigger) and
                    tune the threshold above with real data instead of guessing. The
                    server includes any schedule with consecutive_failure_count >=
                    max(1, effectiveThreshold - 1) so the list shows BOTH already-alerted
                    streaks and approaching-the-line streaks.
                  */}
                  <div
                    className="rounded-md border border-border bg-muted/40 p-4 space-y-3"
                    data-testid="section-project-log-email-streaks"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">
                        Currently in a failing streak
                      </h4>
                      <span className="text-xs text-muted-foreground">
                        Schedules at{" "}
                        {projectLogEmailSettings?.streakingCutoff ?? Math.max(
                          1,
                          (projectLogEmailSettings?.effectiveThreshold ?? 3) - 1,
                        )}
                        + consecutive failures
                      </span>
                    </div>
                    {projectLogEmailSettings && projectLogEmailSettings.streakingSchedules.length > 0 ? (
                      <ul
                        className="divide-y divide-border rounded border border-border bg-background"
                        data-testid="list-project-log-email-streaks"
                      >
                        {projectLogEmailSettings.streakingSchedules.map((s) => {
                          const effective = projectLogEmailSettings.effectiveThreshold;
                          const atOrAboveThreshold = s.consecutiveFailureCount >= effective;
                          const lastAlert = s.lastFailureNotifiedAt
                            ? new Date(s.lastFailureNotifiedAt).toLocaleString()
                            : "Not yet alerted";
                          const lastAttempt = s.lastAttemptAt
                            ? new Date(s.lastAttemptAt).toLocaleString()
                            : "—";
                          const projectLabel = s.projectName
                            || s.projectCode
                            || "Unknown project";
                          const scheduleName = `${s.logType === "SUBMITTAL" ? "Submittal" : "RFI"} log`;
                          // The project route is keyed by project code
                          // (`/projects/:code`); fall back to id when the
                          // project has no code so the link still resolves.
                          const href = `/projects/${s.projectCode ?? s.projectId}`;
                          return (
                            <li
                              key={s.scheduleId}
                              className="text-sm"
                              data-testid={`row-project-log-email-streak-${s.scheduleId}`}
                            >
                              <Link
                                href={href}
                                className="flex items-start justify-between gap-3 px-3 py-2 hover-elevate active-elevate-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                                data-testid={`link-project-log-email-streak-${s.scheduleId}`}
                              >
                                <div className="min-w-0 space-y-0.5">
                                  <p
                                    className="truncate font-medium"
                                    data-testid={`text-project-log-email-streak-project-${s.scheduleId}`}
                                  >
                                    {projectLabel}
                                    {s.projectCode && s.projectName ? (
                                      <span className="text-muted-foreground font-normal">
                                        {" "}({s.projectCode})
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {scheduleName} · Last alert sent:{" "}
                                    <span data-testid={`text-project-log-email-streak-last-alert-${s.scheduleId}`}>
                                      {lastAlert}
                                    </span>
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    Last attempt: {lastAttempt}
                                  </p>
                                </div>
                                <Badge
                                  variant={atOrAboveThreshold ? "destructive" : "secondary"}
                                  className="shrink-0"
                                  data-testid={`badge-project-log-email-streak-count-${s.scheduleId}`}
                                >
                                  {s.consecutiveFailureCount} / {effective}
                                </Badge>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p
                        className="text-sm text-muted-foreground"
                        data-testid="text-project-log-email-streaks-empty"
                      >
                        No schedules are currently at or near the threshold. Your scheduled log emails are healthy.
                      </p>
                    )}
                  </div>

                  {/*
                    Task #1732 — per-org schedule for the daily failures-digest
                    fan-out (`processProjectLogEmailFailuresDigest`). Defaults
                    preserve the original 08:00 UTC daily behavior so existing
                    orgs see no change until they edit the controls below.
                  */}
                  <div
                    className="rounded-md border border-border bg-muted/40 p-4 space-y-4"
                    data-testid="section-project-log-email-failures-digest"
                  >
                    <div className="space-y-1">
                      <h4 className="text-sm font-semibold">
                        Failures-digest schedule
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Roll-up email of every scheduled log that's currently
                        failing or has no recipients, sent to all admins. The
                        per-failure ping and the streak alert above run
                        independently — this knob only controls the digest.
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="project-log-email-failures-digest-cadence">
                        Send the digest
                      </Label>
                      <Select
                        value={projectLogEmailForm.failuresDigestCadence}
                        disabled={!canEditProjectLogEmailThreshold}
                        onValueChange={(value) =>
                          setProjectLogEmailForm((prev) => ({
                            ...prev,
                            failuresDigestCadence: value as "OFF" | "DAILY" | "WEEKLY",
                          }))
                        }
                      >
                        <SelectTrigger
                          id="project-log-email-failures-digest-cadence"
                          data-testid="select-project-log-email-failures-digest-cadence"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OFF" data-testid="option-failures-digest-cadence-off">
                            Off — don't send the digest
                          </SelectItem>
                          <SelectItem value="DAILY" data-testid="option-failures-digest-cadence-daily">
                            Daily
                          </SelectItem>
                          <SelectItem value="WEEKLY" data-testid="option-failures-digest-cadence-weekly">
                            Weekly
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {projectLogEmailForm.failuresDigestCadence !== "OFF" ? (
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        {projectLogEmailForm.failuresDigestCadence === "WEEKLY" ? (
                          <div className="space-y-2">
                            <Label htmlFor="project-log-email-failures-digest-weekday">
                              Day of week
                            </Label>
                            <Select
                              value={String(projectLogEmailForm.failuresDigestWeekday)}
                              disabled={!canEditProjectLogEmailThreshold}
                              onValueChange={(value) =>
                                setProjectLogEmailForm((prev) => ({
                                  ...prev,
                                  failuresDigestWeekday: parseInt(value, 10),
                                }))
                              }
                            >
                              <SelectTrigger
                                id="project-log-email-failures-digest-weekday"
                                data-testid="select-project-log-email-failures-digest-weekday"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {DIGEST_WEEKDAYS.map((d) => (
                                  <SelectItem
                                    key={d.value}
                                    value={String(d.value)}
                                    data-testid={`option-failures-digest-weekday-${d.value}`}
                                  >
                                    {d.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}

                        <div className="space-y-2">
                          <Label htmlFor="project-log-email-failures-digest-hour">
                            Local hour
                          </Label>
                          <Select
                            value={String(projectLogEmailForm.failuresDigestHour)}
                            disabled={!canEditProjectLogEmailThreshold}
                            onValueChange={(value) =>
                              setProjectLogEmailForm((prev) => ({
                                ...prev,
                                failuresDigestHour: parseInt(value, 10),
                              }))
                            }
                          >
                            <SelectTrigger
                              id="project-log-email-failures-digest-hour"
                              data-testid="select-project-log-email-failures-digest-hour"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Array.from({ length: 24 }, (_, h) => (
                                <SelectItem
                                  key={h}
                                  value={String(h)}
                                  data-testid={`option-failures-digest-hour-${h}`}
                                >
                                  {h.toString().padStart(2, "0")}:00
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="project-log-email-failures-digest-timezone">
                            Timezone
                          </Label>
                          <Select
                            value={projectLogEmailForm.failuresDigestTimezone}
                            disabled={!canEditProjectLogEmailThreshold}
                            onValueChange={(value) =>
                              setProjectLogEmailForm((prev) => ({
                                ...prev,
                                failuresDigestTimezone: value,
                              }))
                            }
                          >
                            <SelectTrigger
                              id="project-log-email-failures-digest-timezone"
                              data-testid="select-project-log-email-failures-digest-timezone"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-72">
                              {COMMON_TIMEZONES.map((tz) => (
                                <SelectItem
                                  key={tz}
                                  value={tz}
                                  data-testid={`option-failures-digest-timezone-${tz.replace(/\//g, "-")}`}
                                >
                                  {tz}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ) : (
                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="text-project-log-email-failures-digest-off-notice"
                      >
                        The digest is disabled. Admins still get the per-failure
                        ping and the streak alert above.
                      </p>
                    )}
                  </div>

                  {canEditProjectLogEmailThreshold ? (
                    <div className="flex justify-end">
                      <Button
                        onClick={() => updateProjectLogEmailMutation.mutate(projectLogEmailForm)}
                        disabled={updateProjectLogEmailMutation.isPending}
                        data-testid="button-save-project-log-email-threshold"
                      >
                        {updateProjectLogEmailMutation.isPending ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          "Save Settings"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <p
                      className="text-xs text-muted-foreground text-right"
                      data-testid="text-project-log-email-readonly-notice"
                    >
                      Read-only — your role cannot change these settings.
                    </p>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
