import { useState, useEffect, useMemo, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useEntitlements } from "@/hooks/useEntitlements";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Bell, Loader2, Lock, AlertCircle, Cake, AlarmClock, Moon, Eye, Mail, Download } from "lucide-react";
import { useIntegrationStatus } from "@/hooks/use-integration-status";
import { useAuth } from "@/hooks/use-auth";

type BirthdayReminderCadence = "OFF" | "DAILY_TODAY" | "DAILY_LOOKAHEAD" | "WEEKLY";

interface ChannelPrefsData {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  teamsEnabled: boolean;
  slackEnabled: boolean;
  smsPhoneNumber: string | null;
  teamsWebhookUrl: string | null;
  slackWebhookUrl: string | null;
  birthdayReminderCadence: BirthdayReminderCadence;
}

const BIRTHDAY_CADENCE_OPTIONS: { value: BirthdayReminderCadence; label: string; description: string }[] = [
  { value: "OFF", label: "Off", description: "Don't email me about CRM contact birthdays." },
  { value: "DAILY_TODAY", label: "Daily — today only", description: "Email each morning, but only when a contact's birthday is today." },
  { value: "DAILY_LOOKAHEAD", label: "Daily — today + next few days", description: "Email each morning, including birthdays in the next two days." },
  { value: "WEEKLY", label: "Weekly digest", description: "One Monday-morning summary of birthdays for the week ahead." },
];

interface TypeOverride {
  notificationType: string;
  emailEnabled: boolean;
  smsEnabled?: boolean;
  pushEnabled?: boolean;
}

interface TypeChannelPrefs {
  emailEnabled?: boolean;
  smsEnabled?: boolean;
  pushEnabled?: boolean;
}

const CRM_CONTACT_REASSIGNED = "CRM_CONTACT_REASSIGNED";

const NOTIFICATION_TYPE_GROUPS: { label: string; types: string[] }[] = [
  {
    label: "Approvals & Change Orders",
    types: [
      "CHANGE_ORDER_PENDING", "CHANGE_ORDER_APPROVED", "CHANGE_ORDER_REJECTED",
      "APPROVAL_REQUEST_NEW", "APPROVAL_REQUEST_APPROVED", "APPROVAL_REQUEST_REJECTED",
      "OVERTIME_REQUESTED", "OVERTIME_APPROVED", "OVERTIME_REJECTED",
      "TM_TICKET_SUBMITTED", "TM_TICKET_APPROVED", "TM_TICKET_REJECTED",
      "PAYABLE_SUBMITTED", "PAYABLE_CREATED", "PAYABLE_APPROVED", "PAYABLE_REJECTED",
      "SUBMITTAL_SUBMITTED", "SUBMITTAL_APPROVED", "SUBMITTAL_REJECTED", "SUBMITTAL_REVISION_REQUESTED",
    ],
  },
  {
    label: "Projects & Bids",
    types: [
      "PROJECT_ASSIGNMENT", "BID_AWARDED", "BID_INVITATION_RECEIVED", "BID_RESPONSE_RECEIVED",
      "BID_CLARIFICATION_NEW", "PROGRESS_MILESTONE", "DAILY_PROGRESS_LOGGED", "SOV_ITEM_COMPLETED",
      "DEADLINE_WARNING", "REMINDER",
    ],
  },
  {
    label: "Payroll & Procurement",
    types: [
      "BILLING_READY",
      "PROCUREMENT_PR_SUBMITTED", "PROCUREMENT_PR_APPROVED", "PROCUREMENT_PR_REJECTED",
      "PROCUREMENT_PO_SUBMITTED", "PROCUREMENT_PO_APPROVED", "PROCUREMENT_PO_REJECTED",
    ],
  },
  {
    label: "CRM & Messaging",
    types: ["CRM_STAGE_CHANGE", "CRM_IDLE_OPPORTUNITY", "TASK_MENTIONED", "PORTAL_CHAT_MESSAGE", "PORTAL_ACTIVITY"],
  },
  {
    label: "General",
    types: ["GENERAL", "DELAY_SUBMITTED", "DELAY_ACKNOWLEDGED", "MATERIAL_OVERAGE"],
  },
];

/**
 * Task #753: Compute the next quiet-hours window so admins can see
 * exactly when the window they just configured will fire.
 *
 * Mirrors the server-side semantics of `isInJobMetricAlertQuietWindow`
 * (server/utils/jobMetricAlerts.ts): wrap-around windows (start > end)
 * span midnight, weekday filters key off the day the window *starts*,
 * and an empty weekday list means "every day". Times are interpreted
 * in the configured `timezone`; the returned start/end are absolute
 * Date instants suitable for formatting in the user's local timezone.
 */
interface QuietWindowPreview {
  start: Date;
  end: Date;
  active: boolean;
}

function parseHHMMToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Return the absolute UTC instant corresponding to the given
 * year/month/day/hour/minute interpreted in `timeZone`. Uses an
 * iterative correction so DST transitions resolve cleanly.
 */
function zonedDateTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 2; i++) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(new Date(guess))) parts[p.type] = p.value;
    const observedHour = parseInt(parts.hour ?? "0", 10) === 24 ? 0 : parseInt(parts.hour ?? "0", 10);
    const observedMs = Date.UTC(
      parseInt(parts.year ?? "0", 10),
      parseInt(parts.month ?? "1", 10) - 1,
      parseInt(parts.day ?? "1", 10),
      observedHour,
      parseInt(parts.minute ?? "0", 10),
    );
    const targetMs = Date.UTC(year, month - 1, day, hour, minute);
    const diff = observedMs - targetMs;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

const WEEKDAY_TO_IDX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

function computeNextQuietWindow(
  enabled: boolean,
  startHHMM: string,
  endHHMM: string,
  timezone: string,
  weekdays: number[],
  now: Date,
): QuietWindowPreview | null {
  if (!enabled) return null;
  const startMin = parseHHMMToMinutes(startHHMM);
  const endMin = parseHHMMToMinutes(endHHMM);
  if (startMin === null || endMin === null || startMin === endMin) return null;

  let tz = timezone || "UTC";
  let todayParts: Record<string, string>;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      weekday: "short",
    });
    todayParts = {};
    for (const p of fmt.formatToParts(now)) todayParts[p.type] = p.value;
  } catch {
    return null;
  }

  const baseYear = parseInt(todayParts.year ?? "0", 10);
  const baseMonth = parseInt(todayParts.month ?? "1", 10);
  const baseDay = parseInt(todayParts.day ?? "1", 10);

  const startH = Math.floor(startMin / 60);
  const startM = startMin % 60;
  const endH = Math.floor(endMin / 60);
  const endM = endMin % 60;
  const wraps = startMin > endMin;

  const dayMatches = (idx: number) =>
    !weekdays || weekdays.length === 0 ? true : weekdays.includes(idx);

  // Look back one day so a currently-active wrap-around window (whose
  // start was yesterday) is still surfaced as the "current" window.
  for (let offset = -1; offset <= 14; offset++) {
    const probeStart = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay + offset, 12, 0));
    const probeFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    });
    const dParts: Record<string, string> = {};
    for (const p of probeFmt.formatToParts(probeStart)) dParts[p.type] = p.value;
    const y = parseInt(dParts.year ?? "0", 10);
    const m = parseInt(dParts.month ?? "1", 10);
    const d = parseInt(dParts.day ?? "1", 10);
    const wd = WEEKDAY_TO_IDX[dParts.weekday ?? ""] ?? -1;
    if (wd < 0 || !dayMatches(wd)) continue;

    const start = zonedDateTimeToInstant(y, m, d, startH, startM, tz);
    const endProbe = wraps
      ? new Date(Date.UTC(y, m - 1, d + 1, 12, 0))
      : probeStart;
    const eParts: Record<string, string> = {};
    for (const p of probeFmt.formatToParts(endProbe)) eParts[p.type] = p.value;
    const ey = parseInt(eParts.year ?? "0", 10);
    const em = parseInt(eParts.month ?? "1", 10);
    const ed = parseInt(eParts.day ?? "1", 10);
    const end = zonedDateTimeToInstant(ey, em, ed, endH, endM, tz);

    if (end.getTime() <= now.getTime()) continue;
    return { start, end, active: start.getTime() <= now.getTime() };
  }
  return null;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export default function NotificationPrefsSection() {
  const { toast } = useToast();
  const { user: authUser } = useAuth();
  const isSuperAdmin = authUser?.role === "SUPER_ADMIN";
  const { can } = useEntitlements();
  const hasEnterpriseNotifications = can("ENTERPRISE_NOTIFICATIONS");
  const { status: integrationStatus } = useIntegrationStatus();
  const smsAvailable = integrationStatus.twilio;

  const { data: notifPrefs, isLoading: loadingNotifPrefs } = useQuery<{ channel: ChannelPrefsData; typeOverrides: TypeOverride[] }>({
    queryKey: ["/api/notifications/preferences"],
  });

  // Task #696: per-user opt-out for the weekly CRM contact birthday digest.
  // Stored in user_settings (separate from notification channel/type prefs).
  const { data: userSettingsData, isLoading: loadingUserSettings } = useQuery<{ crmBirthdayDigestOptOut?: boolean }>({
    queryKey: ["/api/user-settings"],
  });
  const [crmBirthdayDigestOptOut, setCrmBirthdayDigestOptOut] = useState(false);
  useEffect(() => {
    if (userSettingsData) {
      setCrmBirthdayDigestOptOut(Boolean(userSettingsData.crmBirthdayDigestOptOut));
    }
  }, [userSettingsData]);

  const updateCrmBirthdayDigestMutation = useMutation({
    mutationFn: async (optOut: boolean) => {
      return await apiRequest("PATCH", "/api/user-settings", { crmBirthdayDigestOptOut: optOut });
    },
    onSuccess: (_data, optOut) => {
      queryClient.invalidateQueries({ queryKey: ["/api/user-settings"] });
      toast({
        title: optOut ? "CRM birthday digest silenced" : "CRM birthday digest re-enabled",
        description: optOut
          ? "You will no longer receive the weekly CRM contact birthday digest."
          : "You will receive the weekly CRM contact birthday digest on Monday mornings.",
      });
    },
    onError: (error: Error, _optOut) => {
      // Roll the local state back so the switch reflects the persisted value.
      setCrmBirthdayDigestOptOut(Boolean(userSettingsData?.crmBirthdayDigestOptOut));
      toast({ title: "Failed to update CRM birthday digest preference", description: error.message, variant: "destructive" });
    },
  });

  function handleCrmBirthdayDigestToggle(receive: boolean) {
    // Switch represents "receive" — invert to store opt-out flag.
    const optOut = !receive;
    setCrmBirthdayDigestOptOut(optOut);
    updateCrmBirthdayDigestMutation.mutate(optOut);
  }

  // Task #740: Super-Admin-only toggle for escalated job-metric alert emails.
  // Backed by `users.receivesJobMetricAlertEmails`; server defaults to true
  // for existing admins so disabling it is an explicit opt-out.
  const [receivesJobMetricAlertEmails, setReceivesJobMetricAlertEmails] = useState(true);
  useEffect(() => {
    if (authUser) {
      setReceivesJobMetricAlertEmails(Boolean(authUser.receivesJobMetricAlertEmails ?? true));
    }
  }, [authUser]);

  const updateJobMetricAlertEmailsMutation = useMutation({
    mutationFn: async (receives: boolean) => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        receivesJobMetricAlertEmails: receives,
      });
    },
    onSuccess: (_data, receives) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: receives ? "Job-alert emails enabled" : "Job-alert emails silenced",
        description: receives
          ? "You will receive escalated job-metric alert emails."
          : "You will no longer receive job-metric alert emails. In-app alerts will still appear.",
      });
    },
    onError: (error: Error) => {
      setReceivesJobMetricAlertEmails(Boolean(authUser?.receivesJobMetricAlertEmails ?? true));
      toast({
        title: "Failed to update job-alert email preference",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleJobMetricAlertEmailsToggle(receive: boolean) {
    setReceivesJobMetricAlertEmails(receive);
    updateJobMetricAlertEmailsMutation.mutate(receive);
  }

  // Task #748: Super-Admin quiet-hours window for job-metric alert emails.
  // Stored on users.* via PATCH /api/auth/profile alongside the opt-out
  // toggle above. The alert engine consults these fields and skips email
  // delivery (in-app still fires) inside the window.
  const detectedTimezone = (() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
    catch { return "UTC"; }
  })();
  const supportedTimezones: string[] = (() => {
    try {
      const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
      if (typeof fn === "function") return fn("timeZone");
    } catch { /* fall through */ }
    return [];
  })();
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const [quietEnabled, setQuietEnabled] = useState(false);
  const [quietStart, setQuietStart] = useState("22:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [quietTimezone, setQuietTimezone] = useState(detectedTimezone);
  // weekdays = days of week (0=Sun … 6=Sat) the quiet window applies on.
  // Empty array means "every day" — matches the server-side helper.
  const [quietWeekdays, setQuietWeekdays] = useState<number[]>([]);

  // Task #753: Tick a clock every 30s so the "next quiet period" preview
  // stays accurate across midnight, daylight savings, and the moment a
  // window starts/ends — without flooding the component with re-renders.
  const [previewNow, setPreviewNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setPreviewNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const browserTimezone = detectedTimezone;
  const nextQuietWindow = useMemo(
    () => computeNextQuietWindow(quietEnabled, quietStart, quietEnd, quietTimezone, quietWeekdays, previewNow),
    [quietEnabled, quietStart, quietEnd, quietTimezone, quietWeekdays, previewNow],
  );

  const isQuietTimezoneValid = useMemo(() => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: quietTimezone || "UTC" }).format(new Date());
      return true;
    } catch { return false; }
  }, [quietTimezone]);

  const quietPreviewText: string = (() => {
    if (!quietEnabled) {
      return "Quiet hours are off — emails can be sent at any time.";
    }
    if (!isQuietTimezoneValid) {
      return "Select a valid timezone to preview the next quiet window.";
    }
    if (!nextQuietWindow) {
      const startMin = parseHHMMToMinutes(quietStart);
      const endMin = parseHHMMToMinutes(quietEnd);
      if (startMin === null || endMin === null) return "Set valid start and end times to preview the next quiet window.";
      if (startMin === endMin) return "Start and end times must differ to preview the next quiet window.";
      if (quietWeekdays.length === 0) return "No upcoming quiet window in the next two weeks.";
      return "No upcoming quiet window in the next two weeks for the selected weekdays.";
    }
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat(undefined, {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
      }).format(d);
    const sameDay = (a: Date, b: Date) => {
      const f = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
      return f.format(a) === f.format(b);
    };
    const endStr = sameDay(nextQuietWindow.start, nextQuietWindow.end)
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(nextQuietWindow.end)
      : fmt(nextQuietWindow.end);
    const label = nextQuietWindow.active ? "Currently in quiet hours" : "Next quiet period";
    return `${label}: ${fmt(nextQuietWindow.start)} – ${endStr} (your time, ${browserTimezone})`;
  })();

  useEffect(() => {
    if (!authUser) return;
    setQuietEnabled(Boolean(authUser.jobMetricAlertQuietHoursEnabled));
    if (authUser.jobMetricAlertQuietHoursStart) setQuietStart(authUser.jobMetricAlertQuietHoursStart);
    if (authUser.jobMetricAlertQuietHoursEnd) setQuietEnd(authUser.jobMetricAlertQuietHoursEnd);
    if (authUser.jobMetricAlertQuietHoursTimezone) setQuietTimezone(authUser.jobMetricAlertQuietHoursTimezone);
    if (Array.isArray(authUser.jobMetricAlertQuietHoursWeekdays)) {
      setQuietWeekdays(authUser.jobMetricAlertQuietHoursWeekdays as number[]);
    }
  }, [authUser]);

  const updateQuietHoursMutation = useMutation({
    mutationFn: async (payload: {
      jobMetricAlertQuietHoursEnabled: boolean;
      jobMetricAlertQuietHoursStart: string | null;
      jobMetricAlertQuietHoursEnd: string | null;
      jobMetricAlertQuietHoursTimezone: string | null;
      jobMetricAlertQuietHoursWeekdays: number[] | null;
    }) => {
      return await apiRequest("PATCH", "/api/auth/profile", payload);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: vars.jobMetricAlertQuietHoursEnabled ? "Quiet hours saved" : "Quiet hours disabled",
        description: vars.jobMetricAlertQuietHoursEnabled
          ? `No job-alert emails between ${vars.jobMetricAlertQuietHoursStart} and ${vars.jobMetricAlertQuietHoursEnd} (${vars.jobMetricAlertQuietHoursTimezone}).`
          : "Job-alert emails will be sent at any time of day.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to save quiet hours",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function toggleQuietWeekday(idx: number) {
    setQuietWeekdays((prev) => (prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx].sort()));
  }

  function handleQuietHoursEnabledToggle(enabled: boolean) {
    setQuietEnabled(enabled);
    updateQuietHoursMutation.mutate({
      jobMetricAlertQuietHoursEnabled: enabled,
      jobMetricAlertQuietHoursStart: quietStart || null,
      jobMetricAlertQuietHoursEnd: quietEnd || null,
      jobMetricAlertQuietHoursTimezone: quietTimezone || null,
      jobMetricAlertQuietHoursWeekdays: quietWeekdays.length > 0 ? quietWeekdays : null,
    });
  }

  // Task #754: opt-in/out toggle for the once-per-window quiet-hours
  // digest email. Defaults to true on the server so existing Super
  // Admins receive the digest until they explicitly silence it.
  const [quietDigestEnabled, setQuietDigestEnabled] = useState(true);
  useEffect(() => {
    if (!authUser) return;
    setQuietDigestEnabled(Boolean(authUser.jobMetricAlertQuietHoursDigestEnabled ?? true));
  }, [authUser]);

  const updateQuietDigestMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        jobMetricAlertQuietHoursDigestEnabled: enabled,
      });
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: enabled ? "Quiet-hours digest enabled" : "Quiet-hours digest silenced",
        description: enabled
          ? "You will receive a digest email summarizing alerts that fired while you were in quiet hours."
          : "You will no longer receive the quiet-hours digest. In-app alerts will still appear.",
      });
    },
    onError: (error: Error) => {
      setQuietDigestEnabled(Boolean(authUser?.jobMetricAlertQuietHoursDigestEnabled ?? true));
      toast({
        title: "Failed to update quiet-hours digest preference",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleQuietDigestToggle(enabled: boolean) {
    setQuietDigestEnabled(enabled);
    updateQuietDigestMutation.mutate(enabled);
  }

  // Task #761: per-recipient detail level for the quiet-hours digest body.
  // Defaults to "full" on the server so existing recipients keep the same
  // layout until they explicitly pick a different level.
  type QuietHoursDigestFormat = "summary" | "full" | "grouped";
  const [quietDigestFormat, setQuietDigestFormat] = useState<QuietHoursDigestFormat>("full");
  useEffect(() => {
    if (!authUser) return;
    const raw = (authUser.jobMetricAlertQuietHoursDigestFormat ?? "full") as QuietHoursDigestFormat;
    setQuietDigestFormat(raw === "summary" || raw === "grouped" ? raw : "full");
  }, [authUser]);

  const updateQuietDigestFormatMutation = useMutation({
    mutationFn: async (format: QuietHoursDigestFormat) => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        jobMetricAlertQuietHoursDigestFormat: format,
      });
    },
    onSuccess: (_data, format) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      const label =
        format === "summary"
          ? "Counts only"
          : format === "grouped"
            ? "Per-job grouped"
            : "Full per-event list";
      toast({
        title: "Digest detail updated",
        description: `Quiet-hours digest will now use: ${label}.`,
      });
    },
    onError: (error: Error) => {
      const fallback = (authUser?.jobMetricAlertQuietHoursDigestFormat ?? "full") as QuietHoursDigestFormat;
      setQuietDigestFormat(fallback === "summary" || fallback === "grouped" ? fallback : "full");
      toast({
        title: "Failed to update digest detail level",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleQuietDigestFormatChange(format: QuietHoursDigestFormat) {
    setQuietDigestFormat(format);
    updateQuietDigestFormatMutation.mutate(format);
  }

  // Task #764: opt-in CSV attachment for the quiet-hours digest. Defaults
  // to false on the server so the email body stays the only payload until
  // a Super Admin explicitly turns this on for offline analysis.
  const [quietDigestCsvEnabled, setQuietDigestCsvEnabled] = useState(false);
  useEffect(() => {
    if (!authUser) return;
    setQuietDigestCsvEnabled(Boolean(authUser.jobMetricAlertQuietHoursDigestCsvEnabled ?? false));
  }, [authUser]);

  const updateQuietDigestCsvMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        jobMetricAlertQuietHoursDigestCsvEnabled: enabled,
      });
    },
    onSuccess: (_data, enabled) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: enabled ? "CSV attachment enabled" : "CSV attachment disabled",
        description: enabled
          ? "Future quiet-hours digests will include a CSV of every alert that fired in the window."
          : "Future quiet-hours digests will no longer include the CSV attachment.",
      });
    },
    onError: (error: Error) => {
      setQuietDigestCsvEnabled(Boolean(authUser?.jobMetricAlertQuietHoursDigestCsvEnabled ?? false));
      toast({
        title: "Failed to update CSV attachment preference",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Task #765 — Preview the quiet-hours digest. The user can either
  // render an in-app HTML preview in a dialog or send a sample to
  // their own email so they can see exactly how the layout looks
  // without waiting for the next quiet window to close.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string>("");
  const [previewIsSynthetic, setPreviewIsSynthetic] = useState(false);
  const [previewEventCount, setPreviewEventCount] = useState(0);

  const previewDigestMutation = useMutation({
    mutationFn: async (mode: "render" | "send") => {
      return await apiRequest("POST", "/api/auth/profile/quiet-hours/preview-digest", {
        format: quietDigestFormat,
        mode,
      });
    },
    onSuccess: async (response, mode) => {
      const data = await response.json();
      if (mode === "render") {
        setPreviewHtml(typeof data.html === "string" ? data.html : "");
        setPreviewSubject(typeof data.subject === "string" ? data.subject : "");
        setPreviewIsSynthetic(Boolean(data.isSynthetic));
        setPreviewEventCount(Number(data.eventCount ?? 0));
        setPreviewOpen(true);
      } else {
        toast({
          title: "Sample digest sent",
          description: data.isSynthetic
            ? `A sample digest using example events was emailed to ${data.sentTo}.`
            : `A sample digest using your ${data.eventCount} most recent events was emailed to ${data.sentTo}.`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to preview digest",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleQuietDigestCsvToggle(enabled: boolean) {
    setQuietDigestCsvEnabled(enabled);
    updateQuietDigestCsvMutation.mutate(enabled);
  }

  // Task #776 — per-recipient cap on how many recent alerts the digest
  // email body and the in-app preview surface. Defaults to 100 (the
  // prior hard-coded cap) so existing recipients see no behavior change
  // until they explicitly pick a different value.
  const DIGEST_MAX_EVENTS_OPTIONS = [25, 50, 100, 250] as const;
  type QuietDigestMaxEvents = (typeof DIGEST_MAX_EVENTS_OPTIONS)[number];
  // Bucket-up policy (mirrors clampDigestMaxEvents on the server): a
  // stale/legacy value snaps to the smallest allowed option that is
  // >= the stored value, so users never silently see fewer alerts
  // than they previously had configured.
  function coerceMaxEvents(value: unknown): QuietDigestMaxEvents {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 100;
    if (n <= 25) return 25;
    if (n <= 50) return 50;
    if (n <= 100) return 100;
    return 250;
  }
  const [quietDigestMaxEvents, setQuietDigestMaxEvents] = useState<QuietDigestMaxEvents>(100);
  useEffect(() => {
    if (!authUser) return;
    setQuietDigestMaxEvents(coerceMaxEvents(authUser.jobMetricAlertQuietHoursDigestMaxEvents));
  }, [authUser]);

  const updateQuietDigestMaxEventsMutation = useMutation({
    mutationFn: async (value: QuietDigestMaxEvents) => {
      return await apiRequest("PATCH", "/api/auth/profile", {
        jobMetricAlertQuietHoursDigestMaxEvents: value,
      });
    },
    onSuccess: (_data, value) => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: "Digest size updated",
        description: `Quiet-hours digest will now include up to ${value} recent alert${value === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: Error) => {
      setQuietDigestMaxEvents(coerceMaxEvents(authUser?.jobMetricAlertQuietHoursDigestMaxEvents));
      toast({
        title: "Failed to update digest size",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  function handleQuietDigestMaxEventsChange(raw: string) {
    const value = coerceMaxEvents(raw);
    setQuietDigestMaxEvents(value);
    updateQuietDigestMaxEventsMutation.mutate(value);
  }

  // Task #772: download a real CSV sample (using the user's recent
  // alert events when available, or a deterministic synthetic set
  // otherwise) so admins can validate it opens cleanly in their
  // spreadsheet tool before opting into the digest CSV attachment.
  const [isDownloadingDigestCsvSample, setIsDownloadingDigestCsvSample] = useState(false);
  async function handleDownloadDigestCsvSample() {
    if (isDownloadingDigestCsvSample) return;
    setIsDownloadingDigestCsvSample(true);
    try {
      const res = await fetch("/api/notifications/digest-csv-sample", {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = /filename="?([^";]+)"?/.exec(disposition);
      const filename = match?.[1] || `digest-csv-sample_${new Date().toISOString().slice(0, 10)}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke so the click has a chance to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      const source = res.headers.get("X-Digest-Csv-Sample-Source");
      toast({
        title: "Sample downloaded",
        description:
          source === "synthetic"
            ? "No recent alerts found, so a representative sample was provided."
            : "Saved a CSV of your most recent digest alerts.",
      });
    } catch (err) {
      toast({
        title: "Failed to download sample",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setIsDownloadingDigestCsvSample(false);
    }
  }

  function handleSaveQuietHours() {
    updateQuietHoursMutation.mutate({
      jobMetricAlertQuietHoursEnabled: quietEnabled,
      jobMetricAlertQuietHoursStart: quietStart || null,
      jobMetricAlertQuietHoursEnd: quietEnd || null,
      jobMetricAlertQuietHoursTimezone: quietTimezone || null,
      jobMetricAlertQuietHoursWeekdays: quietWeekdays.length > 0 ? quietWeekdays : null,
    });
  }

  const [channelPrefs, setChannelPrefs] = useState<ChannelPrefsData>({
    emailEnabled: false, smsEnabled: false, pushEnabled: false,
    teamsEnabled: false, slackEnabled: false,
    smsPhoneNumber: null, teamsWebhookUrl: null, slackWebhookUrl: null,
    birthdayReminderCadence: "DAILY_LOOKAHEAD",
  });

  const [smsPhoneInput, setSmsPhoneInput] = useState("");
  const [teamsWebhookInput, setTeamsWebhookInput] = useState("");
  const [slackWebhookInput, setSlackWebhookInput] = useState("");
  const [typeChannelOverrides, setTypeChannelOverrides] = useState<Record<string, TypeChannelPrefs>>({});
  const [pushPermission, setPushPermission] = useState<NotificationPermission>("default");
  const [pushSubscribing, setPushSubscribing] = useState(false);

  useEffect(() => {
    if ("Notification" in window) {
      setPushPermission(Notification.permission);
    }
  }, []);

  useEffect(() => {
    if (notifPrefs?.channel) {
      setChannelPrefs({
        emailEnabled: notifPrefs.channel.emailEnabled,
        smsEnabled: notifPrefs.channel.smsEnabled,
        pushEnabled: notifPrefs.channel.pushEnabled,
        teamsEnabled: notifPrefs.channel.teamsEnabled,
        slackEnabled: notifPrefs.channel.slackEnabled,
        smsPhoneNumber: notifPrefs.channel.smsPhoneNumber ?? null,
        teamsWebhookUrl: notifPrefs.channel.teamsWebhookUrl ?? null,
        slackWebhookUrl: notifPrefs.channel.slackWebhookUrl ?? null,
        birthdayReminderCadence: (notifPrefs.channel.birthdayReminderCadence ?? "DAILY_LOOKAHEAD") as BirthdayReminderCadence,
      });
      setSmsPhoneInput(notifPrefs.channel.smsPhoneNumber ?? "");
      setTeamsWebhookInput(notifPrefs.channel.teamsWebhookUrl ?? "");
      setSlackWebhookInput(notifPrefs.channel.slackWebhookUrl ?? "");
    }
    if (notifPrefs?.typeOverrides) {
      const overrides: Record<string, TypeChannelPrefs> = {};
      for (const o of notifPrefs.typeOverrides) {
        overrides[o.notificationType] = {
          emailEnabled: o.emailEnabled,
          smsEnabled: o.smsEnabled,
          pushEnabled: o.pushEnabled,
        };
      }
      setTypeChannelOverrides(overrides);
    }
  }, [notifPrefs]);

  async function requestPushSubscription(): Promise<boolean> {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast({ title: "Push not supported", description: "Your browser does not support push notifications.", variant: "destructive" });
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      setPushPermission(permission);
      if (permission !== "granted") {
        toast({ title: "Permission denied", description: "Please allow notifications in your browser settings.", variant: "destructive" });
        return false;
      }
      const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
      if (!vapidPublicKey) {
        toast({ title: "Push not configured", description: "Server-side push is not set up.", variant: "destructive" });
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) await existing.unsubscribe();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = sub.toJSON();
      await apiRequest("POST", "/api/notifications/push-subscribe", {
        endpoint: json.endpoint,
        p256dh: json.keys?.p256dh,
        auth: json.keys?.auth,
        userAgent: navigator.userAgent,
      });
      return true;
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : "";
      if (name === "AbortError" || name === "NotSupportedError") {
        toast({ title: "Push notifications unavailable", description: "Your browser's push service could not be reached." });
      } else {
        toast({ title: "Push setup failed", description: String(err), variant: "destructive" });
      }
      return false;
    }
  }

  async function removePushSubscription(): Promise<void> {
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await apiRequest("DELETE", "/api/notifications/push-unsubscribe", { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
      }
    } catch (err) { console.warn("[NotificationPrefs] Failed to toggle push subscription:", err); }
  }

  async function handlePushToggle(enabled: boolean) {
    setPushSubscribing(true);
    try {
      if (enabled) {
        const success = await requestPushSubscription();
        if (success) setChannelPrefs(p => ({ ...p, pushEnabled: true }));
      } else {
        await removePushSubscription();
        setChannelPrefs(p => ({ ...p, pushEnabled: false }));
      }
    } finally {
      setPushSubscribing(false);
    }
  }

  const updatePrefsMutation = useMutation({
    mutationFn: async () => {
      const typeOverrides: Record<string, TypeChannelPrefs> = {};
      for (const [type, prefs] of Object.entries(typeChannelOverrides)) {
        typeOverrides[type] = prefs;
      }
      return await apiRequest("PUT", "/api/notifications/preferences", {
        channel: channelPrefs,
        typeOverrides,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Notification preferences saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save preferences", description: error.message, variant: "destructive" });
    },
  });

  const saveWebhooksMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("PUT", "/api/notifications/preferences/webhooks", {
        smsPhoneNumber: smsPhoneInput.trim() || null,
        teamsWebhookUrl: teamsWebhookInput.trim() || null,
        slackWebhookUrl: slackWebhookInput.trim() || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/preferences"] });
      toast({ title: "Connection settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save connection settings", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold" data-testid="text-section-title-notifications">Notification Preferences</h2>
        <p className="text-muted-foreground mt-1">Configure how and when you receive notifications</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loadingNotifPrefs ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : (
            <div className="space-y-6 max-w-2xl">
              <div>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Delivery Channels</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between" data-testid="row-pref-email">
                    <div>
                      <p className="text-sm font-medium">Email</p>
                      <p className="text-xs text-muted-foreground">Receive notifications via email</p>
                    </div>
                    <Switch checked={channelPrefs.emailEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, emailEnabled: checked }))} data-testid="switch-pref-email" />
                  </div>

                  <div data-testid="row-pref-sms">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">SMS</p>
                          <p className="text-xs text-muted-foreground">Receive text messages for critical alerts</p>
                        </div>
                        {!smsAvailable ? (
                          <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-unavailable-sms">
                            <AlertCircle className="h-3 w-3" />
                            Not configured
                          </Badge>
                        ) : !hasEnterpriseNotifications ? (
                          <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-sms">
                            <Lock className="h-3 w-3" />
                            Enterprise
                          </Badge>
                        ) : null}
                      </div>
                      {!smsAvailable ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-sms" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            SMS requires additional setup by your administrator.
                          </TooltipContent>
                        </Tooltip>
                      ) : hasEnterpriseNotifications ? (
                        <Switch checked={channelPrefs.smsEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, smsEnabled: checked }))} data-testid="switch-pref-sms" />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-sms" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Upgrade to the Scale plan to enable SMS notifications.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {smsAvailable && hasEnterpriseNotifications && channelPrefs.smsEnabled && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="sms-phone-input" className="text-xs text-muted-foreground">Mobile number (E.164 format)</Label>
                        <Input id="sms-phone-input" value={smsPhoneInput} onChange={(e) => setSmsPhoneInput(e.target.value)} placeholder="+15551234567" data-testid="input-sms-phone" />
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between" data-testid="row-pref-push">
                    <div>
                      <p className="text-sm font-medium">Push Notifications</p>
                      <p className="text-xs text-muted-foreground">Browser and mobile push alerts</p>
                    </div>
                    {pushPermission === "denied" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Switch checked={false} disabled data-testid="switch-pref-push" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Notifications are blocked in your browser settings.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Switch checked={channelPrefs.pushEnabled} onCheckedChange={handlePushToggle} disabled={pushSubscribing} data-testid="switch-pref-push" />
                    )}
                  </div>

                  <div data-testid="row-pref-teams">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">Microsoft Teams</p>
                          <p className="text-xs text-muted-foreground">Receive messages in your Teams workspace</p>
                        </div>
                        {!hasEnterpriseNotifications && (
                          <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-teams">
                            <Lock className="h-3 w-3" />
                            Enterprise
                          </Badge>
                        )}
                      </div>
                      {hasEnterpriseNotifications ? (
                        <Switch checked={channelPrefs.teamsEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, teamsEnabled: checked }))} data-testid="switch-pref-teams" />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-teams" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Upgrade to the Scale plan to enable Teams notifications.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {hasEnterpriseNotifications && channelPrefs.teamsEnabled && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="teams-webhook-input" className="text-xs text-muted-foreground">Teams incoming webhook URL</Label>
                        <Input id="teams-webhook-input" value={teamsWebhookInput} onChange={(e) => setTeamsWebhookInput(e.target.value)} placeholder="https://xxx.webhook.office.com/..." data-testid="input-teams-webhook" />
                      </div>
                    )}
                  </div>

                  <div data-testid="row-pref-slack">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">Slack</p>
                          <p className="text-xs text-muted-foreground">Receive messages in your Slack workspace</p>
                        </div>
                        {!hasEnterpriseNotifications && (
                          <Badge variant="outline" className="text-xs gap-1" data-testid="badge-enterprise-slack">
                            <Lock className="h-3 w-3" />
                            Enterprise
                          </Badge>
                        )}
                      </div>
                      {hasEnterpriseNotifications ? (
                        <Switch checked={channelPrefs.slackEnabled} onCheckedChange={(checked) => setChannelPrefs(p => ({ ...p, slackEnabled: checked }))} data-testid="switch-pref-slack" />
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span tabIndex={0} className="inline-flex">
                              <Switch checked={false} disabled data-testid="switch-pref-slack" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Upgrade to the Scale plan to enable Slack notifications.
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                    {hasEnterpriseNotifications && channelPrefs.slackEnabled && (
                      <div className="mt-2 space-y-1">
                        <Label htmlFor="slack-webhook-input" className="text-xs text-muted-foreground">Slack incoming webhook URL</Label>
                        <Input id="slack-webhook-input" value={slackWebhookInput} onChange={(e) => setSlackWebhookInput(e.target.value)} placeholder="https://hooks.slack.com/services/..." data-testid="input-slack-webhook" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {hasEnterpriseNotifications && (channelPrefs.smsEnabled || channelPrefs.teamsEnabled || channelPrefs.slackEnabled) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => saveWebhooksMutation.mutate()}
                  disabled={saveWebhooksMutation.isPending}
                  data-testid="button-save-connection-settings"
                >
                  {saveWebhooksMutation.isPending ? (
                    <Fragment><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</Fragment>
                  ) : "Save Connection Settings"}
                </Button>
              )}

              <div data-testid="section-birthday-reminder-cadence">
                <h3 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                  <Cake className="h-4 w-4" />
                  CRM Contact Birthday Reminders
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Choose how often you want to be emailed about CRM contact birthdays. This setting is independent of other reminders.
                </p>
                <RadioGroup
                  value={channelPrefs.birthdayReminderCadence}
                  onValueChange={(v) => setChannelPrefs((p) => ({ ...p, birthdayReminderCadence: v as BirthdayReminderCadence }))}
                  className="space-y-2"
                >
                  {BIRTHDAY_CADENCE_OPTIONS.map((opt) => (
                    <div key={opt.value} className="flex items-start gap-3" data-testid={`row-birthday-cadence-${opt.value}`}>
                      <RadioGroupItem
                        value={opt.value}
                        id={`birthday-cadence-${opt.value}`}
                        className="mt-1"
                        data-testid={`radio-birthday-cadence-${opt.value}`}
                      />
                      <Label htmlFor={`birthday-cadence-${opt.value}`} className="flex-1 cursor-pointer">
                        <div className="text-sm font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              {isSuperAdmin && (
                <div data-testid="section-job-metric-alert-emails">
                  <h3 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <AlarmClock className="h-4 w-4" />
                    Job-Metric Alert Emails
                  </h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    High-severity job spike and stall alerts can be escalated by email to every Super Admin. Turn this off to stop receiving those emails. You will still see in-app notifications for the same alerts.
                  </p>
                  <div className="flex items-center justify-between py-1" data-testid="row-job-metric-alert-emails">
                    <div>
                      <p className="text-sm font-medium">Receive job-metric alert emails</p>
                      <p className="text-xs text-muted-foreground">Escalated spike/stall alerts from the job metrics engine.</p>
                    </div>
                    <Switch
                      checked={receivesJobMetricAlertEmails}
                      onCheckedChange={handleJobMetricAlertEmailsToggle}
                      disabled={updateJobMetricAlertEmailsMutation.isPending}
                      data-testid="switch-job-metric-alert-emails"
                    />
                  </div>

                  {receivesJobMetricAlertEmails && (
                    <div className="mt-4 rounded-md border border-border p-3 space-y-3" data-testid="section-job-metric-alert-quiet-hours">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Moon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Quiet hours</p>
                            <p className="text-xs text-muted-foreground">
                              Skip email delivery during this window. In-app alerts still fire.
                            </p>
                          </div>
                        </div>
                        <Switch
                          checked={quietEnabled}
                          onCheckedChange={handleQuietHoursEnabledToggle}
                          disabled={updateQuietHoursMutation.isPending}
                          data-testid="switch-job-metric-alert-quiet-hours-enabled"
                        />
                      </div>

                      <p
                        className="text-xs text-muted-foreground"
                        data-testid="text-quiet-hours-preview"
                      >
                        {quietPreviewText}
                      </p>

                      {quietEnabled && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <Label htmlFor="quiet-hours-start" className="text-xs text-muted-foreground">Start</Label>
                              <Input
                                id="quiet-hours-start"
                                type="time"
                                value={quietStart}
                                onChange={(e) => setQuietStart(e.target.value)}
                                data-testid="input-quiet-hours-start"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label htmlFor="quiet-hours-end" className="text-xs text-muted-foreground">End</Label>
                              <Input
                                id="quiet-hours-end"
                                type="time"
                                value={quietEnd}
                                onChange={(e) => setQuietEnd(e.target.value)}
                                data-testid="input-quiet-hours-end"
                              />
                            </div>
                          </div>

                          <div className="space-y-1">
                            <Label htmlFor="quiet-hours-timezone" className="text-xs text-muted-foreground">Timezone</Label>
                            {supportedTimezones.length > 0 ? (
                              <Select value={quietTimezone} onValueChange={setQuietTimezone}>
                                <SelectTrigger id="quiet-hours-timezone" data-testid="select-quiet-hours-timezone">
                                  <SelectValue placeholder="Select timezone" />
                                </SelectTrigger>
                                <SelectContent className="max-h-64">
                                  {supportedTimezones.map((tz) => (
                                    <SelectItem key={tz} value={tz} data-testid={`option-quiet-hours-timezone-${tz}`}>{tz}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                id="quiet-hours-timezone"
                                value={quietTimezone}
                                onChange={(e) => setQuietTimezone(e.target.value)}
                                placeholder="America/New_York"
                                data-testid="input-quiet-hours-timezone"
                              />
                            )}
                          </div>

                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Active on</Label>
                            <p className="text-xs text-muted-foreground">
                              Leave all unchecked to apply every day.
                            </p>
                            <div className="flex flex-wrap gap-3 pt-1">
                              {WEEKDAY_LABELS.map((label, idx) => (
                                <label
                                  key={label}
                                  htmlFor={`quiet-hours-weekday-${idx}`}
                                  className="flex items-center gap-2 cursor-pointer"
                                  data-testid={`row-quiet-hours-weekday-${idx}`}
                                >
                                  <Checkbox
                                    id={`quiet-hours-weekday-${idx}`}
                                    checked={quietWeekdays.includes(idx)}
                                    onCheckedChange={() => toggleQuietWeekday(idx)}
                                    data-testid={`checkbox-quiet-hours-weekday-${idx}`}
                                  />
                                  <span className="text-sm">{label}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          <Button
                            size="sm"
                            onClick={handleSaveQuietHours}
                            disabled={updateQuietHoursMutation.isPending}
                            data-testid="button-save-quiet-hours"
                          >
                            {updateQuietHoursMutation.isPending ? (
                              <Fragment><Loader2 className="h-3 w-3 mr-2 animate-spin" />Saving...</Fragment>
                            ) : (
                              "Save quiet hours"
                            )}
                          </Button>
                        </div>
                      )}

                      {quietEnabled && (
                        <div className="flex items-center justify-between border-t border-border pt-3" data-testid="row-job-metric-alert-quiet-hours-digest">
                          <div>
                            <p className="text-sm font-medium">Quiet-hours catch-up digest</p>
                            <p className="text-xs text-muted-foreground">
                              After your quiet window ends, send one email summarizing the alerts that fired while you were quiet.
                            </p>
                          </div>
                          <Switch
                            checked={quietDigestEnabled}
                            onCheckedChange={handleQuietDigestToggle}
                            disabled={updateQuietDigestMutation.isPending}
                            data-testid="switch-job-metric-alert-quiet-hours-digest"
                          />
                        </div>
                      )}

                      {quietEnabled && quietDigestEnabled && (
                        <div className="border-t border-border pt-3 space-y-2" data-testid="row-job-metric-alert-quiet-hours-digest-format">
                          <div>
                            <p className="text-sm font-medium">Digest detail level</p>
                            <p className="text-xs text-muted-foreground">
                              Pick how much detail the catch-up email should include.
                            </p>
                          </div>
                          <RadioGroup
                            value={quietDigestFormat}
                            onValueChange={(v) => handleQuietDigestFormatChange(v as QuietHoursDigestFormat)}
                            className="grid gap-2"
                            data-testid="radio-job-metric-alert-quiet-hours-digest-format"
                          >
                            <Label className="flex items-start gap-2 cursor-pointer" htmlFor="quiet-digest-format-summary">
                              <RadioGroupItem
                                id="quiet-digest-format-summary"
                                value="summary"
                                disabled={updateQuietDigestFormatMutation.isPending}
                                data-testid="radio-job-metric-alert-quiet-hours-digest-format-summary"
                              />
                              <span className="text-sm font-normal">
                                <span className="font-medium">Counts only</span>
                                <span className="block text-xs text-muted-foreground">
                                  Totals and the top jobs — no per-event list.
                                </span>
                              </span>
                            </Label>
                            <Label className="flex items-start gap-2 cursor-pointer" htmlFor="quiet-digest-format-full">
                              <RadioGroupItem
                                id="quiet-digest-format-full"
                                value="full"
                                disabled={updateQuietDigestFormatMutation.isPending}
                                data-testid="radio-job-metric-alert-quiet-hours-digest-format-full"
                              />
                              <span className="text-sm font-normal">
                                <span className="font-medium">Full per-event list</span>
                                <span className="block text-xs text-muted-foreground">
                                  One line per alert, in chronological order. (Default)
                                </span>
                              </span>
                            </Label>
                            <Label className="flex items-start gap-2 cursor-pointer" htmlFor="quiet-digest-format-grouped">
                              <RadioGroupItem
                                id="quiet-digest-format-grouped"
                                value="grouped"
                                disabled={updateQuietDigestFormatMutation.isPending}
                                data-testid="radio-job-metric-alert-quiet-hours-digest-format-grouped"
                              />
                              <span className="text-sm font-normal">
                                <span className="font-medium">Per-job grouped</span>
                                <span className="block text-xs text-muted-foreground">
                                  Per-event list, grouped by job for easier scanning.
                                </span>
                              </span>
                            </Label>
                          </RadioGroup>

                          <div
                            className="pt-3 border-t border-border space-y-1"
                            data-testid="row-job-metric-alert-quiet-hours-digest-max-events"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-0.5 pr-4">
                                <Label
                                  htmlFor="select-job-metric-alert-quiet-hours-digest-max-events"
                                  className="text-sm font-medium"
                                >
                                  Up to how many recent alerts
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  Cap the number of recent alerts the catch-up email — and the in-app preview — will list. The CSV attachment (if enabled) still includes every alert.
                                </p>
                              </div>
                              <Select
                                value={String(quietDigestMaxEvents)}
                                onValueChange={handleQuietDigestMaxEventsChange}
                                disabled={updateQuietDigestMaxEventsMutation.isPending}
                              >
                                <SelectTrigger
                                  id="select-job-metric-alert-quiet-hours-digest-max-events"
                                  className="w-[120px]"
                                  data-testid="select-job-metric-alert-quiet-hours-digest-max-events"
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DIGEST_MAX_EVENTS_OPTIONS.map((opt) => (
                                    <SelectItem
                                      key={opt}
                                      value={String(opt)}
                                      data-testid={`select-job-metric-alert-quiet-hours-digest-max-events-option-${opt}`}
                                    >
                                      Up to {opt}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="pt-3 border-t border-border" data-testid="row-job-metric-alert-quiet-hours-digest-csv">
                            <div className="flex items-center justify-between">
                              <div className="space-y-0.5 pr-4">
                                <Label htmlFor="switch-job-metric-alert-quiet-hours-digest-csv" className="text-sm font-medium">
                                  Attach CSV of every alert
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                  Include a CSV attachment with every alert that fired in the window (job, counter, kind, triggered at, message). Useful for offline analysis when more than 100 alerts fire.
                                </p>
                              </div>
                              <Switch
                                id="switch-job-metric-alert-quiet-hours-digest-csv"
                                checked={quietDigestCsvEnabled}
                                onCheckedChange={handleQuietDigestCsvToggle}
                                disabled={updateQuietDigestCsvMutation.isPending}
                                data-testid="switch-job-metric-alert-quiet-hours-digest-csv"
                              />
                            </div>
                            <div className="mt-3" data-testid="preview-job-metric-alert-quiet-hours-digest-csv">
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-xs font-semibold text-muted-foreground">Sample columns</p>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 gap-1.5 text-xs"
                                  onClick={handleDownloadDigestCsvSample}
                                  disabled={isDownloadingDigestCsvSample}
                                  data-testid="button-download-digest-csv-sample"
                                >
                                  {isDownloadingDigestCsvSample ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Download className="h-3 w-3" />
                                  )}
                                  Download sample
                                </Button>
                              </div>
                              <div className="overflow-x-auto rounded-md border border-border bg-muted/30">
                                <table className="w-full text-xs">
                                  <thead className="bg-muted/60 text-muted-foreground">
                                    <tr>
                                      <th className="text-left font-medium px-2 py-1.5" data-testid="header-csv-sample-job">job</th>
                                      <th className="text-left font-medium px-2 py-1.5" data-testid="header-csv-sample-counter">counter</th>
                                      <th className="text-left font-medium px-2 py-1.5" data-testid="header-csv-sample-kind">kind</th>
                                      <th className="text-left font-medium px-2 py-1.5" data-testid="header-csv-sample-triggeredAt">triggeredAt</th>
                                      <th className="text-left font-medium px-2 py-1.5" data-testid="header-csv-sample-message">message</th>
                                    </tr>
                                  </thead>
                                  <tbody className="font-mono">
                                    <tr className="border-t border-border" data-testid="row-csv-sample-0">
                                      <td className="px-2 py-1.5 align-top">JOB-104</td>
                                      <td className="px-2 py-1.5 align-top">labor_hours</td>
                                      <td className="px-2 py-1.5 align-top">OVER_BUDGET</td>
                                      <td className="px-2 py-1.5 align-top whitespace-nowrap">2026-04-21T02:14:00Z</td>
                                      <td className="px-2 py-1.5 align-top">Labor hours 112% of budget</td>
                                    </tr>
                                    <tr className="border-t border-border" data-testid="row-csv-sample-1">
                                      <td className="px-2 py-1.5 align-top">JOB-217</td>
                                      <td className="px-2 py-1.5 align-top">material_cost</td>
                                      <td className="px-2 py-1.5 align-top">FORECAST_OVERRUN</td>
                                      <td className="px-2 py-1.5 align-top whitespace-nowrap">2026-04-21T03:02:11Z</td>
                                      <td className="px-2 py-1.5 align-top">Forecast exceeds budget by $4,820</td>
                                    </tr>
                                    <tr className="border-t border-border" data-testid="row-csv-sample-2">
                                      <td className="px-2 py-1.5 align-top">JOB-309</td>
                                      <td className="px-2 py-1.5 align-top">schedule_variance</td>
                                      <td className="px-2 py-1.5 align-top">SCHEDULE_SLIP</td>
                                      <td className="px-2 py-1.5 align-top whitespace-nowrap">2026-04-21T05:47:33Z</td>
                                      <td className="px-2 py-1.5 align-top">Critical path slipped 3 days</td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                              <p className="mt-1.5 text-[11px] text-muted-foreground">
                                Example only. The actual CSV contains every alert that fired in the quiet-hours window.
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap gap-2 pt-2" data-testid="row-job-metric-alert-quiet-hours-digest-preview">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => previewDigestMutation.mutate("render")}
                              disabled={previewDigestMutation.isPending}
                              data-testid="button-preview-quiet-hours-digest"
                            >
                              {previewDigestMutation.isPending && previewDigestMutation.variables === "render" ? (
                                <Fragment><Loader2 className="h-3 w-3 mr-2 animate-spin" />Loading preview...</Fragment>
                              ) : (
                                <Fragment><Eye className="h-3 w-3 mr-2" />Preview digest</Fragment>
                              )}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => previewDigestMutation.mutate("send")}
                              disabled={previewDigestMutation.isPending}
                              data-testid="button-send-sample-quiet-hours-digest"
                            >
                              {previewDigestMutation.isPending && previewDigestMutation.variables === "send" ? (
                                <Fragment><Loader2 className="h-3 w-3 mr-2 animate-spin" />Sending...</Fragment>
                              ) : (
                                <Fragment><Mail className="h-3 w-3 mr-2" />Send me a sample</Fragment>
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Preview uses your most recent alerts (or example events if none have fired in the last 24 hours). Works even when you are outside your quiet window.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div data-testid="section-crm-contact-reassigned-prefs">
                <h3 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wide">CRM Contact Reassigned</h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Choose which channels should alert you when a CRM contact is reassigned to you. Turn all of these off to mute the notification entirely.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center justify-between py-1" data-testid="row-crm-reassigned-email">
                    <span className="text-sm">Email</span>
                    <Switch
                      checked={typeChannelOverrides[CRM_CONTACT_REASSIGNED]?.emailEnabled ?? channelPrefs.emailEnabled}
                      onCheckedChange={(checked) => setTypeChannelOverrides(prev => ({ ...prev, [CRM_CONTACT_REASSIGNED]: { ...prev[CRM_CONTACT_REASSIGNED], emailEnabled: checked } }))}
                      data-testid="switch-crm-reassigned-email"
                    />
                  </div>
                  <div className="flex items-center justify-between py-1" data-testid="row-crm-reassigned-push">
                    <span className="text-sm">Push</span>
                    {pushPermission === "denied" ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Switch checked={false} disabled data-testid="switch-crm-reassigned-push" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Notifications are blocked in your browser settings.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <Switch
                        checked={typeChannelOverrides[CRM_CONTACT_REASSIGNED]?.pushEnabled ?? channelPrefs.pushEnabled}
                        onCheckedChange={(checked) => setTypeChannelOverrides(prev => ({ ...prev, [CRM_CONTACT_REASSIGNED]: { ...prev[CRM_CONTACT_REASSIGNED], pushEnabled: checked } }))}
                        data-testid="switch-crm-reassigned-push"
                      />
                    )}
                  </div>
                  <div className="flex items-center justify-between py-1" data-testid="row-crm-reassigned-sms">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">SMS</span>
                      {(!smsAvailable || !hasEnterpriseNotifications) && (
                        <Badge variant="outline" className="text-xs gap-1 text-muted-foreground" data-testid="badge-crm-reassigned-sms-unavailable">
                          {!smsAvailable ? <><AlertCircle className="h-3 w-3" />Not configured</> : <><Lock className="h-3 w-3" />Enterprise</>}
                        </Badge>
                      )}
                    </div>
                    {smsAvailable && hasEnterpriseNotifications ? (
                      <Switch
                        checked={typeChannelOverrides[CRM_CONTACT_REASSIGNED]?.smsEnabled ?? channelPrefs.smsEnabled}
                        onCheckedChange={(checked) => setTypeChannelOverrides(prev => ({ ...prev, [CRM_CONTACT_REASSIGNED]: { ...prev[CRM_CONTACT_REASSIGNED], smsEnabled: checked } }))}
                        data-testid="switch-crm-reassigned-sms"
                      />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="inline-flex">
                            <Switch checked={false} disabled data-testid="switch-crm-reassigned-sms" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          {!smsAvailable
                            ? "SMS requires additional setup by your administrator."
                            : "Upgrade to the Scale plan to enable SMS notifications."}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </div>

              {channelPrefs.emailEnabled && (
                <div>
                  <h3 className="text-sm font-semibold mb-1 text-muted-foreground uppercase tracking-wide">Email Alerts by Type</h3>
                  <p className="text-xs text-muted-foreground mb-3">Fine-tune which notifications arrive in your inbox.</p>
                  <div className="space-y-4" data-testid="section-type-email-prefs">
                    {NOTIFICATION_TYPE_GROUPS.map((group) => (
                      <div key={group.label}>
                        <p className="text-xs font-semibold text-muted-foreground mb-2">{group.label}</p>
                        <div className="space-y-2">
                          {group.types.map((type) => {
                            const label = type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
                            const isEnabled = typeChannelOverrides[type]?.emailEnabled ?? channelPrefs.emailEnabled;
                            return (
                              <div key={type} className="flex items-center justify-between py-1" data-testid={`row-type-pref-${type}`}>
                                <span className="text-sm">{label}</span>
                                <Switch checked={isEnabled} onCheckedChange={(checked) => setTypeChannelOverrides(prev => ({ ...prev, [type]: { ...prev[type], emailEnabled: checked } }))} data-testid={`switch-type-pref-${type}`} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Button
                onClick={() => updatePrefsMutation.mutate()}
                disabled={updatePrefsMutation.isPending}
                data-testid="button-save-notification-prefs"
              >
                {updatePrefsMutation.isPending ? (
                  <Fragment><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</Fragment>
                ) : (
                  <Fragment><Bell className="h-4 w-4 mr-2" />Save Preferences</Fragment>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" data-testid="dialog-quiet-hours-digest-preview">
          <DialogHeader>
            <DialogTitle data-testid="text-quiet-hours-digest-preview-subject">{previewSubject || "Quiet-hours digest preview"}</DialogTitle>
            <DialogDescription data-testid="text-quiet-hours-digest-preview-meta">
              {previewIsSynthetic
                ? `Showing example events because no alerts have fired in the last 24 hours. Detail level: ${quietDigestFormat}.`
                : `Showing the ${previewEventCount} most recent alert${previewEventCount === 1 ? "" : "s"}. Detail level: ${quietDigestFormat}.`}
            </DialogDescription>
          </DialogHeader>
          <div
            className="overflow-auto rounded-md border bg-white p-4"
            data-testid="container-quiet-hours-digest-preview-html"
            dangerouslySetInnerHTML={{ __html: previewHtml ?? "" }}
          />
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => previewDigestMutation.mutate("send")}
              disabled={previewDigestMutation.isPending}
              data-testid="button-send-sample-from-dialog"
            >
              {previewDigestMutation.isPending && previewDigestMutation.variables === "send" ? (
                <Fragment><Loader2 className="h-3 w-3 mr-2 animate-spin" />Sending...</Fragment>
              ) : (
                <Fragment><Mail className="h-3 w-3 mr-2" />Email me this sample</Fragment>
              )}
            </Button>
            <Button
              type="button"
              onClick={() => setPreviewOpen(false)}
              data-testid="button-close-quiet-hours-digest-preview"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}