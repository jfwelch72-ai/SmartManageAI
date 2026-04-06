import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Calendar, FileText, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { PayrollSettings } from "./types";
import { DAYS_OF_WEEK } from "./types";

export function CompanyNotificationsTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  const { data: payrollSettings, isLoading: loadingPayroll } = useQuery<PayrollSettings>({
    queryKey: ["/api/payroll/settings"],
    enabled: !!user && ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(user.role)
  });

  const [payrollForm, setPayrollForm] = useState({
    workWeekStartDay: "SUNDAY" as PayrollSettings["workWeekStartDay"],
    overtimeThresholdHours: 40,
    notifyOnWeekComplete: true
  });

  const updatePayrollMutation = useMutation({
    mutationFn: async (data: typeof payrollForm) => {
      return await apiRequest("PUT", "/api/payroll/settings", {
        workWeekStartDay: data.workWeekStartDay,
        overtimeThresholdHours: String(data.overtimeThresholdHours),
        workWeekEndNotificationEnabled: data.notifyOnWeekComplete,
        autoGenerateWeeklyReports: data.notifyOnWeekComplete,
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
        notifyOnWeekComplete: payrollSettings.workWeekEndNotificationEnabled
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
        </div>
      )}
    </div>
  );
}
