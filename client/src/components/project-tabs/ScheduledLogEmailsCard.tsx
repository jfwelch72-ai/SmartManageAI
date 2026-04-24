import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Mail, Loader2, Send, BellRing } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { COMMON_TIMEZONES } from "@shared/timezones";
import {
  PROJECT_LOG_EMAIL_CADENCES,
  PROJECT_LOG_EMAIL_LOG_TYPES,
  type ProjectLogEmailCadence,
  type ProjectLogEmailLogType,
} from "@shared/schema";

interface ScheduledLogEmailsCardProps {
  projectId: string;
}

// Task #1649 — narrow shape returned by the GET endpoint for each
// user the worker would notify on a failed send. PM is listed first,
// followed by the schedule's last editor (deduped). Email is included
// so the hover-card can disambiguate two users with the same name.
interface FailureNotificationRecipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface ScheduleRow {
  id: string | null;
  organizationId: string;
  projectId: string;
  logType: ProjectLogEmailLogType;
  cadence: ProjectLogEmailCadence;
  weekday: number;
  hour: number;
  timezone: string;
  lastSentAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  failureNotificationRecipients?: FailureNotificationRecipient[];
}

interface SchedulesResponse {
  schedules: ScheduleRow[];
}

const CADENCE_LABELS: Record<ProjectLogEmailCadence, string> = {
  OFF: "Off — don't send",
  DAILY: "Daily",
  WEEKLY: "Weekly",
  BIWEEKLY: "Every other week",
};

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
] as const;

const LOG_TYPE_LABELS: Record<ProjectLogEmailLogType, string> = {
  RFI: "RFI Log",
  SUBMITTAL: "Submittal Log",
};

const LOG_TYPE_DESCRIPTIONS: Record<ProjectLogEmailLogType, string> = {
  RFI: "PDF snapshot of the project's RFI log emailed to your distribution recipients.",
  SUBMITTAL: "PDF snapshot of the project's Submittal log emailed to your distribution recipients.",
};

const DEFAULT_FORM = {
  cadence: "OFF" as ProjectLogEmailCadence,
  weekday: 1,
  hour: 8,
  timezone: "UTC",
};

export default function ScheduledLogEmailsCard({ projectId }: ScheduledLogEmailsCardProps) {
  const { data, isLoading } = useQuery<SchedulesResponse>({
    queryKey: ["/api/projects", projectId, "log-email-schedules"],
    enabled: !!projectId,
  });

  const schedulesByType = useMemo(() => {
    const map = new Map<ProjectLogEmailLogType, ScheduleRow>();
    for (const row of data?.schedules ?? []) {
      map.set(row.logType, row);
    }
    return map;
  }, [data]);

  return (
    <Card data-testid="card-scheduled-log-emails">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <CardTitle className="text-base">Scheduled Log Emails</CardTitle>
        </div>
        <CardDescription>
          Email a PDF of the RFI or Submittal log to the project's distribution recipients on a regular cadence. Default is Off.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <div className="space-y-3" data-testid="skeleton-scheduled-log-emails">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          PROJECT_LOG_EMAIL_LOG_TYPES.map((logType) => (
            <ScheduleRowEditor
              key={logType}
              projectId={projectId}
              logType={logType}
              initial={schedulesByType.get(logType) ?? {
                id: null,
                organizationId: "",
                projectId,
                logType,
                ...DEFAULT_FORM,
                lastSentAt: null,
                createdAt: null,
                updatedAt: null,
                failureNotificationRecipients: [],
              }}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

interface ScheduleRowEditorProps {
  projectId: string;
  logType: ProjectLogEmailLogType;
  initial: ScheduleRow;
}

function ScheduleRowEditor({ projectId, logType, initial }: ScheduleRowEditorProps) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    cadence: initial.cadence,
    weekday: initial.weekday,
    hour: initial.hour,
    timezone: initial.timezone,
  });

  // Keep local edit state in sync if the server payload changes (e.g. after a save).
  useEffect(() => {
    setForm({
      cadence: initial.cadence,
      weekday: initial.weekday,
      hour: initial.hour,
      timezone: initial.timezone,
    });
  }, [initial.cadence, initial.weekday, initial.hour, initial.timezone]);

  const mutation = useMutation({
    mutationFn: async (payload: typeof form) => {
      const res = await apiRequest(
        "PUT",
        `/api/projects/${projectId}/log-email-schedules/${logType}`,
        payload,
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "log-email-schedules"] });
      toast({ title: `${LOG_TYPE_LABELS[logType]} schedule saved` });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to save schedule",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Task #1628 — fires the same PDF + email pipeline the cron uses,
  // immediately, so admins can verify recipients/branding/contents
  // before turning the cadence on.
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/log-email-schedules/${logType}/test`,
      );
      return res.json() as Promise<{ ok: boolean; recipientCount: number }>;
    },
    onSuccess: (data) => {
      const count = data?.recipientCount ?? 0;
      toast({
        title: `Test ${LOG_TYPE_LABELS[logType].toLowerCase()} email sent`,
        description:
          count > 0
            ? `Delivered to ${count} recipient${count === 1 ? "" : "s"}.`
            : "Email queued for delivery.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to send test email",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const isDirty =
    form.cadence !== initial.cadence ||
    form.weekday !== initial.weekday ||
    form.hour !== initial.hour ||
    form.timezone !== initial.timezone;

  const showWeekday = form.cadence === "WEEKLY" || form.cadence === "BIWEEKLY";
  const showHourTz = form.cadence !== "OFF";
  const lowerType = logType.toLowerCase();

  const knownTimezones: readonly string[] = COMMON_TIMEZONES.map((t) => t.value);
  const showCustomTz = !knownTimezones.includes(form.timezone);

  return (
    <div
      className="border rounded-lg p-4 space-y-4"
      data-testid={`row-log-email-schedule-${lowerType}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium" data-testid={`text-log-email-title-${lowerType}`}>
            {LOG_TYPE_LABELS[logType]}
          </div>
          <p className="text-xs text-muted-foreground">{LOG_TYPE_DESCRIPTIONS[logType]}</p>
        </div>
        <div className="text-xs text-muted-foreground text-right space-y-0.5">
          <div
            className="whitespace-nowrap"
            data-testid={`text-log-email-status-${lowerType}`}
          >
            {initial.cadence === "OFF" ? "Currently: Off" : `Currently: ${CADENCE_LABELS[initial.cadence]}`}
          </div>
          {initial.lastSentAt ? (
            <div
              className="whitespace-nowrap"
              data-testid={`text-log-email-last-sent-${lowerType}`}
            >
              Last sent: {formatDistanceToNow(new Date(initial.lastSentAt), { addSuffix: true })}
            </div>
          ) : initial.cadence !== "OFF" ? (
            <div
              className="whitespace-nowrap"
              data-testid={`text-log-email-last-sent-${lowerType}`}
            >
              Hasn't sent yet
            </div>
          ) : null}
        </div>
      </div>

      <FailureNotificationRecipients
        logType={logType}
        recipients={initial.failureNotificationRecipients ?? []}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor={`cadence-${lowerType}`}>Cadence</Label>
          <Select
            value={form.cadence}
            onValueChange={(value) =>
              setForm((prev) => ({ ...prev, cadence: value as ProjectLogEmailCadence }))
            }
          >
            <SelectTrigger
              id={`cadence-${lowerType}`}
              data-testid={`select-log-email-cadence-${lowerType}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PROJECT_LOG_EMAIL_CADENCES.map((value) => (
                <SelectItem
                  key={value}
                  value={value}
                  data-testid={`option-log-email-cadence-${lowerType}-${value.toLowerCase()}`}
                >
                  {CADENCE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {showWeekday && (
          <div className="space-y-2">
            <Label htmlFor={`weekday-${lowerType}`}>Day of week</Label>
            <Select
              value={String(form.weekday)}
              onValueChange={(value) =>
                setForm((prev) => ({ ...prev, weekday: parseInt(value, 10) }))
              }
            >
              <SelectTrigger
                id={`weekday-${lowerType}`}
                data-testid={`select-log-email-weekday-${lowerType}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEKDAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {showHourTz && (
          <>
            <div className="space-y-2">
              <Label htmlFor={`hour-${lowerType}`}>Send time (local hour)</Label>
              <Select
                value={String(form.hour)}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, hour: parseInt(value, 10) }))
                }
              >
                <SelectTrigger
                  id={`hour-${lowerType}`}
                  data-testid={`select-log-email-hour-${lowerType}`}
                >
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
              <Label htmlFor={`timezone-${lowerType}`}>Timezone</Label>
              <Select
                value={form.timezone}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, timezone: value }))
                }
              >
                <SelectTrigger
                  id={`timezone-${lowerType}`}
                  data-testid={`select-log-email-timezone-${lowerType}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMMON_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>
                      {tz.label}
                    </SelectItem>
                  ))}
                  {showCustomTz && (
                    <SelectItem value={form.timezone}>{form.timezone}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending || mutation.isPending}
          data-testid={`button-test-log-email-schedule-${lowerType}`}
        >
          {testMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Send className="h-4 w-4 mr-2" />
          )}
          Send test now
        </Button>
        <Button
          size="sm"
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !isDirty}
          data-testid={`button-save-log-email-schedule-${lowerType}`}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Save
        </Button>
      </div>
    </div>
  );
}

// Task #1649 — surfaces the resolved display names of the project
// manager and the schedule's last editor so admins editing the
// cadence can see who would actually be notified by the worker if
// the next send fails. Mirrors `maybeNotifyProjectLogEmailFailure`'s
// dedupe (PM + last editor, deduped by user id) and shows an explicit
// empty state when both pointers are null so admins know the alert
// would otherwise go nowhere.
interface FailureNotificationRecipientsProps {
  logType: ProjectLogEmailLogType;
  recipients: FailureNotificationRecipient[];
}

function fullName(user: FailureNotificationRecipient): string {
  const name = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
  return name.length > 0 ? name : user.email;
}

function FailureNotificationRecipients({ logType, recipients }: FailureNotificationRecipientsProps) {
  const lowerType = logType.toLowerCase();
  return (
    <div
      className="flex items-start gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs"
      data-testid={`failure-recipients-${lowerType}`}
    >
      <BellRing className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <div className="space-y-0.5">
        <div className="font-medium text-muted-foreground">Failure alerts go to:</div>
        {recipients.length === 0 ? (
          <div
            className="text-muted-foreground"
            data-testid={`failure-recipients-empty-${lowerType}`}
          >
            Nobody — set a project manager or update the cadence to record an editor.
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {recipients.map((user, idx) => (
              <span
                key={user.id}
                className="inline-flex items-center"
                data-testid={`failure-recipient-${lowerType}-${user.id}`}
              >
                <HoverCard openDelay={150}>
                  <HoverCardTrigger asChild>
                    <button
                      type="button"
                      className="underline decoration-dotted underline-offset-2 hover:text-foreground focus:outline-none focus:ring-1 focus:ring-ring rounded-sm"
                      data-testid={`failure-recipient-name-${lowerType}-${user.id}`}
                    >
                      {fullName(user)}
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent className="w-64 text-xs" align="start">
                    <div className="font-medium">{fullName(user)}</div>
                    <a
                      href={`mailto:${user.email}`}
                      className="mt-1 block text-muted-foreground hover:text-foreground break-all"
                      data-testid={`failure-recipient-email-${lowerType}-${user.id}`}
                    >
                      {user.email}
                    </a>
                  </HoverCardContent>
                </HoverCard>
                {idx < recipients.length - 1 ? <span aria-hidden="true">,</span> : null}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
