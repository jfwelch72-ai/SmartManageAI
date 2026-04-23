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
import { Calendar, FileText, CheckCircle2, Clock, Loader2, Lock, MessageSquare, AlertCircle, ClipboardCheck, ShieldAlert } from "lucide-react";
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
        </div>
      )}
    </div>
  );
}
