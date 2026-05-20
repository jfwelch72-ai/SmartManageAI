#!/usr/bin/env npx tsx
// scripts/seed-support-holidays.ts
//
// Populates the `support_holidays` table with US federal holidays for the
// current year and the next 3 years. Safe to run multiple times — existing
// rows are left unchanged (upsert on date+country).
//
// Usage:
//   npx tsx scripts/seed-support-holidays.ts          # seeds US holidays
//   npx tsx scripts/seed-support-holidays.ts --dry-run # preview only
//
// Extension:
//   Add more countries by implementing their holiday logic below. Each entry
//   must have { date: "YYYY-MM-DD", name: string, country: string }.
//   The table's unique index on (date, country) prevents duplicates.
//
// Called automatically on deploy via the post-merge setup script.

import { db } from "../server/db";
import { supportHolidays } from "../shared/schema";
import { sql } from "drizzle-orm";

const isDryRun = process.argv.includes("--dry-run");

// ─── US Federal Holidays ──────────────────────────────────────────────────────
// Rules:
//   New Year's Day      Jan 1   (observed: if Sat→Fri Dec 31, if Sun→Mon Jan 2)
//   MLK Day             3rd Mon of Jan
//   Presidents' Day     3rd Mon of Feb
//   Memorial Day        last Mon of May
//   Juneteenth          Jun 19  (observed: same Sat/Sun rule as New Year's)
//   Independence Day    Jul 4   (observed: same Sat/Sun rule)
//   Labor Day           1st Mon of Sep
//   Columbus Day        2nd Mon of Oct
//   Veterans Day        Nov 11  (observed: same Sat/Sun rule)
//   Thanksgiving        4th Thu of Nov
//   Christmas           Dec 25  (observed: same Sat/Sun rule)

function nthWeekday(year: number, monthIndex: number, weekday: number, n: number): Date {
  // weekday: 0=Sun…6=Sat, n: 1-based (1=first, -1=last)
  if (n > 0) {
    let count = 0;
    let d = new Date(year, monthIndex, 1);
    while (d.getDay() !== weekday) d.setDate(d.getDate() + 1);
    for (let i = 1; i < n; i++) d.setDate(d.getDate() + 7);
    return d;
  } else {
    // Last occurrence
    const lastDay = new Date(year, monthIndex + 1, 0);
    while (lastDay.getDay() !== weekday) lastDay.setDate(lastDay.getDate() - 1);
    return lastDay;
  }
}

function observedDate(d: Date): Date {
  const dow = d.getDay();
  if (dow === 6) return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); // Sat → Fri
  if (dow === 0) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1); // Sun → Mon
  return d;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface HolidayRow {
  date: string;
  name: string;
  country: string;
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

async function main() {
  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3];

  const rows: HolidayRow[] = years.flatMap(usFederalHolidays);

  console.log(`[seed-support-holidays] Seeding ${rows.length} US federal holidays for years ${years.join(", ")}`);
  if (isDryRun) {
    for (const r of rows) {
      console.log(`  [dry-run] ${r.date} — ${r.name} (${r.country})`);
    }
    console.log("[seed-support-holidays] Dry-run complete — no DB writes.");
    return;
  }

  // Upsert: insert new rows; on conflict (date, country) do nothing.
  await db
    .insert(supportHolidays)
    .values(rows)
    .onConflictDoNothing();

  console.log(`[seed-support-holidays] Done. ${rows.length} holiday rows upserted.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed-support-holidays] Error:", err);
    process.exit(1);
  });
