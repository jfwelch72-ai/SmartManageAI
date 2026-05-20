import { db } from "../db";
import { supportHolidays } from "@shared/schema";
import { sql } from "drizzle-orm";
import { logInfo, logError } from "./logger";

// ─── Holiday generation helpers ───────────────────────────────────────────────

interface HolidayRow {
  date: string;
  name: string;
  country: string;
}

function nthWeekday(year: number, monthIndex: number, weekday: number, n: number): Date {
  if (n > 0) {
    let d = new Date(year, monthIndex, 1);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    for (let i = 1; i < n; i++) d.setDate(d.getDate() + 7);
    return d;
  }
  const lastDay = new Date(year, monthIndex + 1, 0);
  while (lastDay.getDay() !== weekday) lastDay.setDate(lastDay.getDate() - 1);
  return lastDay;
}

function observedDate(d: Date): Date {
  const dow = d.getDay();
  if (dow === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  if (dow === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function usFederalHolidays(year: number): HolidayRow[] {
  const fixed = (m: number, day: number, name: string): HolidayRow => ({
    date: isoDate(observedDate(new Date(year, m, day))),
    name,
    country: "US",
  });
  return [
    fixed(0, 1, "New Year's Day"),
    { date: isoDate(nthWeekday(year, 0, 1, 3)), name: "Martin Luther King Jr. Day", country: "US" },
    { date: isoDate(nthWeekday(year, 1, 1, 3)), name: "Presidents' Day", country: "US" },
    { date: isoDate(nthWeekday(year, 4, 1, -1)), name: "Memorial Day", country: "US" },
    fixed(5, 19, "Juneteenth National Independence Day"),
    fixed(6, 4, "Independence Day"),
    { date: isoDate(nthWeekday(year, 8, 1, 1)), name: "Labor Day", country: "US" },
    { date: isoDate(nthWeekday(year, 9, 1, 2)), name: "Columbus Day", country: "US" },
    fixed(10, 11, "Veterans Day"),
    { date: isoDate(nthWeekday(year, 10, 4, 4)), name: "Thanksgiving Day", country: "US" },
    fixed(11, 25, "Christmas Day"),
  ];
}

/**
 * Task #2962 — SLA & routing intelligence.
 *
 * Seeds the `support_holidays` table with US federal holidays for the current
 * year and 3 years ahead. Uses upsert (ON CONFLICT DO NOTHING) so it is safe
 * to call on every startup.
 *
 * Auto-extends the calendar each year: because the check asks for currentYear+3
 * every time, a new deploy in a future year will always seed the next 3 years.
 */
export async function seedSupportHolidaysOnStartup(): Promise<void> {
  try {
    const currentYear = new Date().getFullYear();
    const targetYear = currentYear + 3;

    // Check if we already have holidays for the furthest-out year
    const existing = await db.execute(sql`
      SELECT 1 FROM support_holidays
      WHERE country = 'US'
        AND date >= ${String(targetYear) + "-01-01"}
      LIMIT 1
    `);

    if (existing.rows.length > 0) {
      logInfo(`[migration] support_holidays seed — already present through ${targetYear}, skipped`);
      return;
    }

    const years = [currentYear, currentYear + 1, currentYear + 2, targetYear];
    const rows: HolidayRow[] = years.flatMap(usFederalHolidays);

    await db.insert(supportHolidays).values(rows).onConflictDoNothing();

    logInfo(`[migration] support_holidays seed — inserted ${rows.length} US federal holidays for ${years.join(", ")}`);
  } catch (err) {
    logError(err, { helper: "seedSupportHolidaysOnStartup" });
    throw err;
  }
}
