// Task #1749 — helpers for the live "Next digest:" preview rendered
// on the failures-digest schedule card in CompanyNotificationsTab.
//
// Mirrors the gating logic in `processProjectLogEmailFailuresDigest`
// (server/jobs/jobRunner.ts): the cron task fires hourly (`0 * * * *`)
// and the org-level gate fires when the org's local hour matches the
// configured hour AND, for WEEKLY cadence, the local weekday matches
// the configured weekday. The next scheduled fire is therefore the
// soonest top-of-hour boundary strictly after `now` where both gates
// pass when evaluated in the configured IANA timezone.

export type FailuresDigestCadence = "OFF" | "DAILY" | "WEEKLY";

export function getLocalPartsInTimezone(
  date: Date,
  timezone: string,
): { weekday: number; hour: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    }).formatToParts(date);
    const weekdayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "";
    let hour = parseInt(hourStr, 10);
    if (!Number.isFinite(hour) || hour === 24) hour = 0;
    const weekday = weekdayMap[weekdayStr] ?? 0;
    return { weekday, hour };
  } catch {
    return null;
  }
}

export function computeNextFailuresDigestFire(opts: {
  cadence: FailuresDigestCadence;
  weekday: number;
  hour: number;
  timezone: string;
  now?: Date;
}): Date | null {
  if (opts.cadence === "OFF") return null;
  const now = opts.now ?? new Date();
  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  if (candidate <= now) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  // Scan up to 8 days of hourly candidates — enough headroom for a
  // weekly digest plus DST safety margin.
  const MAX_HOURS = 24 * 8;
  for (let i = 0; i < MAX_HOURS; i++) {
    const local = getLocalPartsInTimezone(candidate, opts.timezone);
    if (local && local.hour === opts.hour) {
      if (opts.cadence === "DAILY" || local.weekday === opts.weekday) {
        return new Date(candidate);
      }
    }
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  return null;
}

export function formatNextFailuresDigestFire(
  date: Date,
  timezone: string,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, ...opts }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...opts }).format(date);
  }
}
