import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  RefreshCw, Loader2, Plus, Trash2, MapPin, CalendarClock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Connection, AccountMapping, QboAccount, SyncSchedule, SyncHistoryResponse } from "./types";

const SCHEDULE_OPERATIONS = [
  { value: "chart_of_accounts", label: "Chart of Accounts" },
  { value: "customers", label: "Customers" },
  { value: "subcontractor_payments", label: "Subcontractor Bills" },
  { value: "purchase_orders", label: "Purchase Orders" },
  { value: "reconcile_payments", label: "Payment Reconciliation" },
];

const FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Every Hour" },
  { value: "every_6h", label: "Every 6 Hours" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

export function AccountMappingPanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [newCostCode, setNewCostCode] = useState("");
  const [selectedAccount, setSelectedAccount] = useState("");

  const { data: mappings, isLoading } = useQuery<AccountMapping[]>({
    queryKey: ["/api/integrations/connections", connection.id, "account-mappings"],
    enabled: connection.status === "active",
  });

  const { data: syncHistory } = useQuery<SyncHistoryResponse>({
    queryKey: ["/api/integrations/connections", connection.id, "sync-history"],
    enabled: connection.status === "active",
  });

  const accounts: QboAccount[] = (syncHistory as any)?.chartOfAccounts
    ? []
    : [];

  const { data: coaData } = useQuery<{ accounts: QboAccount[] }>({
    queryKey: ["/api/integrations/connections", connection.id, "chart-of-accounts"],
    enabled: false,
  });

  const allAccounts = coaData?.accounts || [];

  const saveMutation = useMutation({
    mutationFn: async ({ costCode, qboAccountId, qboAccountName }: { costCode: string; qboAccountId: string; qboAccountName: string }) => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/account-mappings`, {
        costCode,
        qboAccountId,
        qboAccountName,
        mappingType: "cost_code",
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "account-mappings"] });
      setNewCostCode("");
      setSelectedAccount("");
    },
    onError: (error: Error) => {
      toast({ title: "Save Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mappingId: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/connections/${connection.id}/account-mappings/${mappingId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Mapping Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "account-mappings"] });
    },
  });

  const autoMapMutation = useMutation({
    mutationFn: async () => {
      const costCodes = (mappings || []).map(m => m.costCode);
      if (newCostCode && !costCodes.includes(newCostCode)) costCodes.push(newCostCode);
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/account-mappings/auto-map`, {
        costCodes: costCodes.length > 0 ? costCodes : ["General", "Labor", "Materials", "Equipment", "Subcontractor", "Overhead"],
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Auto-Map Complete",
        description: `${data.created} new mappings created from ${data.suggestions?.length || 0} matches`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "account-mappings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Auto-Map Failed", description: error.message, variant: "destructive" });
    },
  });

  if (!syncHistory?.chartOfAccounts) {
    return null;
  }

  return (
    <Card data-testid="card-account-mappings">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Cost Code Mappings
            </CardTitle>
            <CardDescription>Map your cost codes to QuickBooks accounts for accurate categorization</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => autoMapMutation.mutate()}
            disabled={autoMapMutation.isPending}
            data-testid="button-auto-map"
          >
            {autoMapMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Auto-Map
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {(mappings || []).map((mapping) => (
                <div
                  key={mapping.id}
                  className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                  data-testid={`mapping-row-${mapping.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" data-testid={`text-cost-code-${mapping.id}`}>{mapping.costCode}</p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-mapping-type-${mapping.id}`}>{mapping.mappingType}</p>
                  </div>
                  <div className="text-right flex-1 min-w-0">
                    <p className="text-sm truncate" data-testid={`text-qbo-account-${mapping.id}`}>{mapping.qboAccountName}</p>
                    <p className="text-xs text-muted-foreground">ID: {mapping.qboAccountId}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(mapping.id)}
                    disabled={deleteMutation.isPending}
                    data-testid={`button-delete-mapping-${mapping.id}`}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}

              <div className="flex gap-2 items-end pt-2 border-t">
                <div className="flex-1">
                  <Label className="text-xs">Cost Code</Label>
                  <Input
                    value={newCostCode}
                    onChange={(e) => setNewCostCode(e.target.value)}
                    placeholder="e.g. Labor, Materials, 01-100"
                    className="h-9"
                    data-testid="input-new-cost-code"
                  />
                </div>
                <div className="flex-1">
                  <Label className="text-xs">QBO Account</Label>
                  <Input
                    value={selectedAccount}
                    onChange={(e) => setSelectedAccount(e.target.value)}
                    placeholder="Account name from QBO"
                    className="h-9"
                    data-testid="input-qbo-account"
                  />
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (newCostCode && selectedAccount) {
                      saveMutation.mutate({
                        costCode: newCostCode,
                        qboAccountId: selectedAccount,
                        qboAccountName: selectedAccount,
                      });
                    }
                  }}
                  disabled={!newCostCode || !selectedAccount || saveMutation.isPending}
                  data-testid="button-add-mapping"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SyncSchedulePanel({ connection }: { connection: Connection }) {
  const { toast } = useToast();
  const [newOp, setNewOp] = useState("");
  const [newFreq, setNewFreq] = useState("daily");

  const { data: schedules, isLoading } = useQuery<SyncSchedule[]>({
    queryKey: ["/api/integrations/connections", connection.id, "schedules"],
    enabled: connection.status === "active",
  });

  const saveMutation = useMutation({
    mutationFn: async ({ operation, frequency, isActive }: { operation: string; frequency: string; isActive?: boolean }) => {
      const res = await apiRequest("POST", `/api/integrations/connections/${connection.id}/schedules`, {
        operation,
        frequency,
        isActive,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "schedules"] });
      setNewOp("");
      setNewFreq("daily");
    },
    onError: (error: Error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await apiRequest("DELETE", `/api/integrations/connections/${connection.id}/schedules/${scheduleId}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Schedule Removed" });
      queryClient.invalidateQueries({ queryKey: ["/api/integrations/connections", connection.id, "schedules"] });
    },
  });

  return (
    <Card data-testid="card-sync-schedules">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Automatic Sync Schedules
        </CardTitle>
        <CardDescription>Configure operations to run automatically on a schedule</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {(schedules || []).map((schedule) => {
                const opInfo = SCHEDULE_OPERATIONS.find(o => o.value === schedule.operation);
                const freqInfo = FREQUENCY_OPTIONS.find(f => f.value === schedule.frequency);
                return (
                  <div
                    key={schedule.id}
                    className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                    data-testid={`schedule-row-${schedule.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" data-testid={`text-schedule-op-${schedule.id}`}>{opInfo?.label || schedule.operation}</p>
                      <p className="text-xs text-muted-foreground">
                        {freqInfo?.label || schedule.frequency}
                        {schedule.lastRunAt && ` · Last: ${new Date(schedule.lastRunAt).toLocaleString()}`}
                        {schedule.nextRunAt && ` · Next: ${new Date(schedule.nextRunAt).toLocaleString()}`}
                      </p>
                    </div>
                    <Switch
                      checked={schedule.isActive}
                      onCheckedChange={(checked) => saveMutation.mutate({
                        operation: schedule.operation,
                        frequency: schedule.frequency,
                        isActive: checked,
                      })}
                      data-testid={`switch-schedule-active-${schedule.id}`}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteMutation.mutate(schedule.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-schedule-${schedule.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                );
              })}

              <div className="flex gap-2 items-end pt-2 border-t">
                <div className="flex-1">
                  <Label className="text-xs">Operation</Label>
                  <Select value={newOp} onValueChange={setNewOp}>
                    <SelectTrigger className="h-9" data-testid="select-schedule-operation">
                      <SelectValue placeholder="Select operation" />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_OPERATIONS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex-1">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={newFreq} onValueChange={setNewFreq}>
                    <SelectTrigger className="h-9" data-testid="select-schedule-frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    if (newOp) {
                      saveMutation.mutate({ operation: newOp, frequency: newFreq });
                    }
                  }}
                  disabled={!newOp || saveMutation.isPending}
                  data-testid="button-add-schedule"
                >
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
