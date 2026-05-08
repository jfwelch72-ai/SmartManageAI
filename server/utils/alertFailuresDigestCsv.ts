/**
 * Task #1518/#1568/#1578 — shared row-builder for the cross-org alert
 * failures digest CSV. Originally inlined in the
 * `/api/crm/calls/transcripts/backfill/alert-failures-digest.csv` route;
 * extracted so the new "Attach to incident review" handler (Task #1578)
 * can stream the SAME CSV branch into Replit object storage without
 * duplicating the header / row / sort / escape logic and the audit
 * summary shape.
 *
 * The three datasets exactly mirror what the JSON `alert-failures-digest`
 * endpoint already powers in the in-app card:
 *   - summary: per-org rollup (total / slack / email)
 *   - samples: per-org recent failure samples
 *   - quiet:   orgs that ran backfill in the window but produced ZERO
 *              alert deliveries (Task #1568 — the "silent pipeline" list)
 */
import { inArray } from "drizzle-orm";

import { db } from "../db";
import { organizations } from "@shared/schema";
import {
  aggregateRecentCrmTranscriptBackfillAlertFailures,
  findQuietCrmTranscriptBackfillOrgsSince,
} from "../crm/transcriptBackfillStorage";

export type AlertFailuresDigestDataset = "summary" | "samples" | "quiet";

export interface BuildAlertFailuresDigestCsvOptions {
  dataset: AlertFailuresDigestDataset;
  windowHours: number;
  recentSampleLimit: number;
  generatedAt?: Date;
}

export interface AlertFailuresDigestCsvResult {
  csv: string;
  filenameSuffix: AlertFailuresDigestDataset;
  /**
   * Mirrors the audit-row payload the CSV endpoint logs (Task #1549). The
   * attach-to-incident-review handler reuses this verbatim and decorates it
   * with the review/attachment ids, so the existing admin audit dashboard
   * keeps working without a second branch.
   */
  summary: {
    dataset: AlertFailuresDigestDataset;
    windowHours: number;
    orgRowCount: number;
    sampleRowCount: number;
    recentSampleLimit: number;
    generatedAt: string;
  };
  /**
   * Suggested attachment filename ("alert-failures-<dataset>-<window>h-<stamp>.csv")
   * — kept here so the route handler and the attach handler agree on the
   * download name even though only the route handler sets the
   * Content-Disposition header.
   */
  filename: string;
}

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function buildAlertFailuresDigestCsv(
  opts: BuildAlertFailuresDigestCsvOptions,
): Promise<AlertFailuresDigestCsvResult> {
  const { dataset, windowHours, recentSampleLimit } = opts;
  const generatedAt = opts.generatedAt ?? new Date();
  const since = new Date(generatedAt.getTime() - windowHours * 60 * 60 * 1000);

  // The quiet dataset doesn't need the failure aggregator — skip the
  // (potentially expensive) failure scan when we know we won't read it.
  // We still load org metadata below using the quiet entries' org ids so
  // we can render names/slugs in the CSV.
  const aggregates =
    dataset === "quiet"
      ? []
      : await aggregateRecentCrmTranscriptBackfillAlertFailures(since, {
          recentSampleLimit,
        });
  const quietEntries =
    dataset === "quiet"
      ? await findQuietCrmTranscriptBackfillOrgsSince(since)
      : [];
  const orgIds = Array.from(
    new Set([
      ...aggregates.map((a) => a.organizationId),
      ...quietEntries.map((q) => q.organizationId),
    ]),
  );
  const orgRows = orgIds.length
    ? await db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
        })
        .from(organizations)
        .where(inArray(organizations.id, orgIds))
    : [];
  const orgById = new Map(orgRows.map((o) => [o.id, o]));

  const sortedAggregates = [...aggregates].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    const am = orgById.get(a.organizationId);
    const bm = orgById.get(b.organizationId);
    const an = (am?.name ?? a.organizationId).toLowerCase();
    const bn = (bm?.name ?? b.organizationId).toLowerCase();
    return an.localeCompare(bn);
  });

  const sinceIso = since.toISOString();
  const generatedAtIso = generatedAt.toISOString();
  const windowLabel = `${windowHours}h`;

  // Quiet orgs are sorted by most-recent activity first so the CSV opens
  // with the freshest "silent" tenants, matching the JSON digest ordering
  // the UI already shows.
  const sortedQuietEntries = [...quietEntries].sort((a, b) => {
    const at = a.lastJobAt.getTime();
    const bt = b.lastJobAt.getTime();
    if (bt !== at) return bt - at;
    const am = orgById.get(a.organizationId);
    const bm = orgById.get(b.organizationId);
    const an = (am?.name ?? a.organizationId).toLowerCase();
    const bn = (bm?.name ?? b.organizationId).toLowerCase();
    return an.localeCompare(bn);
  });

  let lines: string[];
  let filenameSuffix: AlertFailuresDigestDataset;
  if (dataset === "samples") {
    const HEADERS = [
      "organization_id",
      "organization_name",
      "organization_slug",
      "job_id",
      "channel",
      "attempted_at",
      "recipient",
      "error",
      "window_hours",
      "since",
      "generated_at",
    ];
    lines = [HEADERS.join(",")];
    for (const entry of sortedAggregates) {
      const meta = orgById.get(entry.organizationId);
      for (const f of entry.recentFailures) {
        lines.push(
          [
            entry.organizationId,
            meta?.name ?? "",
            meta?.slug ?? "",
            f.jobId ?? "",
            f.channel,
            f.attemptedAt.toISOString(),
            f.recipientSummary ?? "",
            f.errorMessage ?? "",
            windowHours,
            sinceIso,
            generatedAtIso,
          ]
            .map(escapeCsv)
            .join(","),
        );
      }
    }
    filenameSuffix = "samples";
  } else if (dataset === "quiet") {
    const HEADERS = [
      "organization_id",
      "organization_name",
      "organization_slug",
      "jobs_in_window",
      "last_job_at",
      "window_hours",
      "since",
      "generated_at",
    ];
    lines = [HEADERS.join(",")];
    for (const entry of sortedQuietEntries) {
      const meta = orgById.get(entry.organizationId);
      lines.push(
        [
          entry.organizationId,
          meta?.name ?? "",
          meta?.slug ?? "",
          entry.jobsInWindow,
          entry.lastJobAt.toISOString(),
          windowHours,
          sinceIso,
          generatedAtIso,
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    filenameSuffix = "quiet";
  } else {
    const HEADERS = [
      "organization_id",
      "organization_name",
      "organization_slug",
      "total",
      "slack_count",
      "email_count",
      "window_hours",
      "since",
      "generated_at",
    ];
    lines = [HEADERS.join(",")];
    for (const entry of sortedAggregates) {
      const meta = orgById.get(entry.organizationId);
      lines.push(
        [
          entry.organizationId,
          meta?.name ?? "",
          meta?.slug ?? "",
          entry.total,
          entry.slackCount,
          entry.emailCount,
          windowHours,
          sinceIso,
          generatedAtIso,
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    filenameSuffix = "summary";
  }

  // Match the audit-row payload Task #1549 wrote inline so callers can pass
  // it straight to logAudit({ newValue: JSON.stringify(summary) }).
  const orgRowCount =
    dataset === "quiet" ? sortedQuietEntries.length : sortedAggregates.length;
  const sampleRowCount =
    dataset === "samples"
      ? sortedAggregates.reduce((n, e) => n + e.recentFailures.length, 0)
      : 0;

  const csv = lines.join("\n") + "\n";
  const stamp = generatedAtIso.replace(/[:.]/g, "-");
  const filename = `alert-failures-${filenameSuffix}-${windowLabel}-${stamp}.csv`;

  return {
    csv,
    filenameSuffix,
    filename,
    summary: {
      dataset,
      windowHours,
      orgRowCount,
      sampleRowCount,
      recentSampleLimit,
      generatedAt: generatedAtIso,
    },
  };
}

/** Window-hours clamp shared with the route layer (Task #1518). */
export function clampAlertFailuresWindowHours(raw: unknown): number {
  const n = parseInt(String(raw ?? "24"), 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 24, 1), 720);
}

/** Recent-sample-limit clamp shared with the route layer (Task #1518). */
export function clampAlertFailuresRecentSampleLimit(raw: unknown): number {
  const n = parseInt(String(raw ?? "20"), 10);
  return Math.min(Math.max(Number.isFinite(n) ? n : 20, 1), 50);
}

/** Normalize the dataset query param (defaults to "summary"). */
export function parseAlertFailuresDataset(
  raw: unknown,
): AlertFailuresDigestDataset {
  const s = String(raw ?? "summary");
  if (s === "samples") return "samples";
  if (s === "quiet") return "quiet";
  return "summary";
}
