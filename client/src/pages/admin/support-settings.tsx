// Support routing & escalation settings card — Task #2962
// Holiday calendar section added — Task #2973
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
import { Globe, Bell, UserPlus, Star, X, Plus, CalendarDays, Trash2 } from "lucide-react";

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

interface Holiday {
  id: string;
  date: string;
  name: string;
  country: string;
}

const DEFAULT: SupportSettingsData = {
  supportTimezone: "UTC",
  escalationEmails: [],
  escalationThresholdPct: 75,
  autoAssignGraceMinutes: 60,
  enterpriseAgentIds: [],
};

const CURRENT_YEAR = new Date().getFullYear();

// ─── Holiday Calendar sub-component ─────────────────────────────────────────

function HolidayCalendarCard() {
  const { toast } = useToast();
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [newCountry, setNewCountry] = useState("US");

  const yearOptions = [
    String(CURRENT_YEAR - 1),
    String(CURRENT_YEAR),
    String(CURRENT_YEAR + 1),
    String(CURRENT_YEAR + 2),
  ];

  const { data, isLoading } = useQuery<{ holidays: Holiday[] }>({
    queryKey: ["/api/support/holidays", selectedYear],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/support/holidays?year=${selectedYear}`);
      return res.json();
    },
  });

  const holidays = data?.holidays ?? [];

  const addMutation = useMutation({
    mutationFn: async (body: { date: string; name: string; country: string }) => {
      const res = await apiRequest("POST", "/api/support/holidays", body);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to add holiday");
      }
      return res.json() as Promise<Holiday>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/holidays"] });
      setNewDate("");
      setNewName("");
      toast({ title: "Holiday added" });
    },
    onError: (e: Error) =>
      toast({ title: "Add failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/support/holidays/${id}`);
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "Failed to delete holiday");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/support/holidays"] });
      toast({ title: "Holiday removed" });
    },
    onError: (e: Error) =>
      toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const handleAdd = () => {
    if (!newDate || !newName.trim()) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      toast({ title: "Invalid date", description: "Use YYYY-MM-DD format", variant: "destructive" });
      return;
    }
    addMutation.mutate({ date: newDate, name: newName.trim(), country: newCountry.toUpperCase() });
  };

  const isMutating = addMutation.isPending || deleteMutation.isPending;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          Holiday Calendar
        </CardTitle>
        <CardDescription>
          Holidays are excluded from SLA business-hour calculations. Changes take effect immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Label className="shrink-0">Year</Label>
          <Select
            value={selectedYear}
            onValueChange={setSelectedYear}
            data-testid="select-holiday-year"
          >
            <SelectTrigger className="w-32" data-testid="trigger-holiday-year">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={y} data-testid={`option-year-${y}`}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : holidays.length === 0 ? (
          <p
            className="text-sm text-muted-foreground italic py-2"
            data-testid="text-no-holidays"
          >
            No holidays configured for {selectedYear}.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border" data-testid="list-holidays">
            {holidays.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
                data-testid={`holiday-row-${h.id}`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="font-mono text-xs text-muted-foreground shrink-0"
                    data-testid={`text-holiday-date-${h.id}`}
                  >
                    {h.date}
                  </span>
                  <span
                    className="text-sm truncate"
                    data-testid={`text-holiday-name-${h.id}`}
                  >
                    {h.name}
                  </span>
                  <Badge variant="outline" className="text-xs shrink-0">
                    {h.country}
                  </Badge>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => deleteMutation.mutate(h.id)}
                  disabled={isMutating}
                  aria-label={`Remove ${h.name}`}
                  data-testid={`button-delete-holiday-${h.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2 pt-1">
          <Label>Add Holiday</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="w-40"
              disabled={isMutating}
              data-testid="input-holiday-date"
            />
            <Input
              placeholder="Holiday name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1 min-w-[160px]"
              disabled={isMutating}
              data-testid="input-holiday-name"
            />
            <Input
              placeholder="Country"
              value={newCountry}
              onChange={(e) => setNewCountry(e.target.value.toUpperCase().slice(0, 2))}
              className="w-20 uppercase"
              maxLength={2}
              disabled={isMutating}
              data-testid="input-holiday-country"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleAdd}
              disabled={!newDate || !newName.trim() || isMutating}
              className="gap-1 shrink-0"
              data-testid="button-add-holiday"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Use ISO 8601 date format (YYYY-MM-DD) and a 2-letter country code (e.g. US).
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main settings component ─────────────────────────────────────────────────

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

      {/* Holiday Calendar */}
      <HolidayCalendarCard />
    </div>
  );
}
