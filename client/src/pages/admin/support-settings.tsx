// Support routing & escalation settings card — Task #2962
// Rendered inside the admin support tickets page as a separate tab/section.

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, Bell, UserPlus, Star, X, Plus, Save } from "lucide-react";

const IANA_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Honolulu",
  "America/Phoenix",
  "America/Puerto_Rico",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Moscow",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Singapore",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
] as const;

interface SupportSettingsData {
  supportTimezone: string;
  escalationEmails: string[];
  escalationThresholdPct: number;
  autoAssignGraceMinutes: number;
  enterpriseAgentIds: string[];
}

const DEFAULT: SupportSettingsData = {
  supportTimezone: "UTC",
  escalationEmails: [],
  escalationThresholdPct: 75,
  autoAssignGraceMinutes: 60,
  enterpriseAgentIds: [],
};

export default function SupportSettingsCard() {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [newAgentId, setNewAgentId] = useState("");

  const { data, isLoading } = useQuery<{ settings: SupportSettingsData }>({
    queryKey: ["/api/support/settings"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/support/settings");
      return res.json();
    },
  });

  const settings = data?.settings ?? DEFAULT;

  const mutation = useMutation({
    mutationFn: async (patch: Partial<SupportSettingsData>) => {
      const res = await apiRequest("PATCH", "/api/support/settings", patch);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to save settings");
      }
      return res.json() as Promise<{ settings: SupportSettingsData }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/settings"] });
      toast({ title: "Support settings saved" });
    },
    onError: (e: Error) =>
      toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const save = (patch: Partial<SupportSettingsData>) => mutation.mutate(patch);

  const handleAddEmail = () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    if (settings.escalationEmails.includes(email)) return;
    save({ escalationEmails: [...settings.escalationEmails, email] });
    setNewEmail("");
  };

  const handleRemoveEmail = (email: string) => {
    save({ escalationEmails: settings.escalationEmails.filter((e) => e !== email) });
  };

  const handleAddAgentId = () => {
    const id = newAgentId.trim();
    if (!id) return;
    if (settings.enterpriseAgentIds.includes(id)) return;
    save({ enterpriseAgentIds: [...settings.enterpriseAgentIds, id] });
    setNewAgentId("");
  };

  const handleRemoveAgentId = (id: string) => {
    save({ enterpriseAgentIds: settings.enterpriseAgentIds.filter((a) => a !== id) });
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Timezone */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-muted-foreground" />
            Business Timezone
          </CardTitle>
          <CardDescription>
            SLA business-hour windows (09:00–18:00) are calculated in this timezone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Select
              value={settings.supportTimezone}
              onValueChange={(tz) => save({ supportTimezone: tz })}
              disabled={mutation.isPending}
            >
              <SelectTrigger className="w-64" data-testid="select-support-timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IANA_TIMEZONES.map((tz) => (
                  <SelectItem key={tz} value={tz} data-testid={`tz-option-${tz.replace("/", "-")}`}>
                    {tz}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mutation.isPending && (
              <span className="text-xs text-muted-foreground">Saving…</span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Escalation */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-muted-foreground" />
            Escalation Policy
          </CardTitle>
          <CardDescription>
            When a ticket's first-response SLA window is this % consumed without a reply,
            priority is automatically bumped one level and the escalation contacts are notified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Escalation Threshold</Label>
              <span
                className="text-sm font-semibold tabular-nums"
                data-testid="text-escalation-threshold-value"
              >
                {settings.escalationThresholdPct}%
              </span>
            </div>
            <Slider
              value={[settings.escalationThresholdPct]}
              min={10}
              max={99}
              step={5}
              onValueCommit={([v]) => save({ escalationThresholdPct: v })}
              disabled={mutation.isPending}
              data-testid="slider-escalation-threshold"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              At {settings.escalationThresholdPct}% of the SLA window, priority escalates and contacts are notified.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Escalation Contacts</Label>
            <div className="flex flex-wrap gap-2 min-h-[2rem]">
              {settings.escalationEmails.map((email) => (
                <Badge
                  key={email}
                  variant="secondary"
                  className="gap-1 pr-1"
                  data-testid={`badge-escalation-email-${email}`}
                >
                  {email}
                  <button
                    onClick={() => handleRemoveEmail(email)}
                    className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                    aria-label={`Remove ${email}`}
                    data-testid={`button-remove-email-${email}`}
                    disabled={mutation.isPending}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {settings.escalationEmails.length === 0 && (
                <span className="text-xs text-muted-foreground italic" data-testid="text-no-escalation-emails">
                  No escalation contacts configured — only the global support inbox is notified.
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="engineer@yourcompany.com"
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddEmail()}
                disabled={mutation.isPending}
                className="flex-1 max-w-xs"
                data-testid="input-escalation-email"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleAddEmail}
                disabled={!newEmail.trim() || mutation.isPending}
                data-testid="button-add-escalation-email"
                className="gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Auto-assignment */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            Auto-Assignment
          </CardTitle>
          <CardDescription>
            Unassigned tickets are automatically distributed round-robin across admin agents
            after the grace period elapses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Grace Period (minutes)</Label>
              <span
                className="text-sm font-semibold tabular-nums"
                data-testid="text-grace-period-value"
              >
                {settings.autoAssignGraceMinutes} min
              </span>
            </div>
            <Slider
              value={[settings.autoAssignGraceMinutes]}
              min={0}
              max={480}
              step={15}
              onValueCommit={([v]) => save({ autoAssignGraceMinutes: v })}
              disabled={mutation.isPending}
              data-testid="slider-grace-period"
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              {settings.autoAssignGraceMinutes === 0
                ? "Tickets will be auto-assigned immediately."
                : `Tickets will be auto-assigned ${settings.autoAssignGraceMinutes} minutes after creation if still unassigned.`}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Enterprise routing */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Star className="h-4 w-4 text-muted-foreground" />
            Enterprise Ticket Routing
          </CardTitle>
          <CardDescription>
            Enterprise-tier tickets are routed to these agents first before falling back to
            the general agent pool. Enter user IDs from your organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2 min-h-[2rem]">
            {settings.enterpriseAgentIds.map((id) => (
              <Badge
                key={id}
                variant="outline"
                className="gap-1 pr-1 font-mono text-xs"
                data-testid={`badge-enterprise-agent-${id}`}
              >
                {id.slice(0, 8)}…
                <button
                  onClick={() => handleRemoveAgentId(id)}
                  className="ml-1 rounded-full hover:bg-destructive/20 p-0.5"
                  aria-label={`Remove agent ${id}`}
                  data-testid={`button-remove-agent-${id}`}
                  disabled={mutation.isPending}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {settings.enterpriseAgentIds.length === 0 && (
              <span className="text-xs text-muted-foreground italic" data-testid="text-no-enterprise-agents">
                No enterprise agents configured — enterprise tickets go to the general pool.
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="User ID (UUID)"
              value={newAgentId}
              onChange={(e) => setNewAgentId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddAgentId()}
              disabled={mutation.isPending}
              className="flex-1 max-w-xs font-mono text-sm"
              data-testid="input-enterprise-agent-id"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddAgentId}
              disabled={!newAgentId.trim() || mutation.isPending}
              data-testid="button-add-enterprise-agent"
              className="gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
