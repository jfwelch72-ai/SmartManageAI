import { useState, useEffect } from "react";
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
import { Calendar, FileText, CheckCircle2, Clock, Loader2, Lock, MessageSquare, AlertCircle, ClipboardCheck } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import type { PayrollSettings } from "./types";
import { DAYS_OF_WEEK } from "./types";
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
        </div>
      )}
    </div>
  );
}
