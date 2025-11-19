import { useQuery, useMutation } from "@tanstack/react-query";
import { useUser } from "@/hooks/use-user";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Settings, Save } from "lucide-react";
import { useState, useEffect } from "react";
import type { AISettings } from "@shared/schema";

export default function AISettingsPage() {
  const { user } = useUser();
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<AISettings>({
    queryKey: ["/api/ai-settings"],
    enabled: !!user && user.role === 'ADMIN',
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
    modelName: "gpt-4o",
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

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<AISettings>) => {
      return apiRequest("/api/ai-settings", {
        method: "PATCH",
        body: data,
      });
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
                  placeholder="gpt-4o"
                  data-testid="input-model-name"
                />
                <p className="text-sm text-muted-foreground">
                  Recommended: gpt-4o (latest) or gpt-4-turbo-preview
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
