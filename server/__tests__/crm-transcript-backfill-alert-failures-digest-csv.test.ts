/**
 * Task #1518 — integration coverage for the new CSV export of the cross-org
 * alert failure breakdown:
 *   `GET /api/crm/calls/transcripts/backfill/alert-failures-digest.csv`
 *
 * The endpoint mirrors the auth + cross-org gating of the JSON
 * `alert-failures-digest` route used by the in-app "Recent alert failures"
 * card on /admin/transcript-backfill, so platform support can attach the
 * same numbers they see on screen to incident reviews and weekly tenant
 * health reports without copy/pasting from the panel.
 *
 * Coverage:
 *   - SUPER_ADMIN with `crossOrg=true` gets a real CSV with one row per
 *     org with at least one failure in the window, sorted by total desc,
 *     with org id / name / slug / total / slack / email / window / since /
 *     generated-at columns.
 *   - `dataset=samples` returns one row per per-org recent failure sample,
 *     joined to the org id/name/slug, with job id / channel / attempted_at
 *     / recipient / error columns.
 *   - `windowHours` clamping is consistent with the JSON route (24h →
 *     excludes the 5d-old failure, 168h → includes it, 9999 → 720h).
 *   - SUPER_ADMINs without the `crossOrg=true` flag are rejected so the
 *     endpoint can never silently fall back to a single-org export.
 *   - Non-super ADMINs are 403'd; non-admins are 403'd; anonymous → 401.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  crmTranscriptBackfillAlertDeliveries,
  crmTranscriptBackfillJobs,
  auditLog,
} from "@shared/schema";
import { and, eq, desc } from "drizzle-orm";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `alert-failures-digest-csv-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__alert_failures_digest_csv_${SUFFIX}__`;
const ENDPOINT =
  "/api/crm/calls/transcripts/backfill/alert-failures-digest.csv";

let app: Express;
let server: Server;

let orgAId: string;
let orgBId: string;
let orgQuietId: string;
let adminAId: string;
let superAdminId: string;
let fieldAId: string;
let adminACookie: string;
let superAdminCookie: string;
let fieldACookie: string;

const seededDeliveryIds: string[] = [];
const seededJobIds: string[] = [];
let quietJobLastActivity: Date;

async function makeOrgAndAdmin(label: string) {
  const [org] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}${label}`,
      slug: `${TEST_ORG_PREFIX}${label}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  const [admin] = await db
    .insert(users)
    .values({
      email: `${label}-admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: label,
      lastName: "Admin",
      organizationId: org.id,
      role: "ADMIN",
    })
    .returning();
  return { org, admin };
}

async function seedDelivery(opts: {
  orgId: string;
  jobId: string | null;
  channel: "slack" | "email";
  status: "failure" | "success";
  attemptedAt: Date;
  errorMessage?: string | null;
  recipientSummary?: string;
}) {
  const [row] = await db
    .insert(crmTranscriptBackfillAlertDeliveries)
    .values({
      organizationId: opts.orgId,
      jobId: opts.jobId,
      channel: opts.channel,
      status: opts.status,
      recipientSummary:
        opts.recipientSummary ??
        (opts.channel === "slack" ? "hooks.slack.com" : "ops@example.com"),
      errorMessage: opts.errorMessage ?? null,
      attemptedAt: opts.attemptedAt,
    })
    .returning({ id: crmTranscriptBackfillAlertDeliveries.id });
  seededDeliveryIds.push(row.id);
  return row.id;
}

// CSV parser that handles RFC 4180-style quoted fields with embedded commas /
// quotes / newlines. Just enough to validate what our route emits.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
    } else if (c === "\r") {
      // ignore — we only emit \n
    } else {
      field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  // Drop trailing empty row from final newline.
  if (rows.length > 0 && rows[rows.length - 1].every((v) => v === "")) {
    rows.pop();
  }
  return rows;
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  const a = await makeOrgAndAdmin("orga");
  orgAId = a.org.id;
  adminAId = a.admin.id;
  adminACookie = `auth_token=${generateToken(a.admin.id, a.admin.tokenVersion)}`;

  const b = await makeOrgAndAdmin("orgb");
  orgBId = b.org.id;

  const [superAdmin] = await db
    .insert(users)
    .values({
      email: `super-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Super",
      lastName: "Root",
      organizationId: orgAId,
      role: "SUPER_ADMIN",
    })
    .returning();
  superAdminId = superAdmin.id;
  superAdminCookie = `auth_token=${generateToken(
    superAdmin.id,
    superAdmin.tokenVersion,
  )}`;

  const [field] = await db
    .insert(users)
    .values({
      email: `orga-field-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Field",
      lastName: "Worker",
      organizationId: orgAId,
      role: "FIELD_WORKER",
    })
    .returning();
  fieldAId = field.id;
  fieldACookie = `auth_token=${generateToken(field.id, field.tokenVersion)}`;

  const now = Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;

  // Org A: 2 slack + 1 email failure inside 24h, with a quote in one error
  // message to exercise CSV escaping.
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-1",
    channel: "slack",
    status: "failure",
    errorMessage: 'slack: "channel_not_found", retry_after=30',
    attemptedAt: new Date(now - 2 * hour),
  });
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-2",
    channel: "slack",
    status: "failure",
    errorMessage: "500 boom",
    attemptedAt: new Date(now - 4 * hour),
  });
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-3",
    channel: "email",
    status: "failure",
    errorMessage: "smtp 550",
    recipientSummary: "ops+alerts@example.com",
    attemptedAt: new Date(now - 6 * hour),
  });
  // success row — must NOT count.
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-ok",
    channel: "slack",
    status: "success",
    attemptedAt: new Date(now - 30 * minute),
  });
  // 5d old failure — outside default 24h window, inside 168h.
  await seedDelivery({
    orgId: orgAId,
    jobId: "job-A-old",
    channel: "email",
    status: "failure",
    errorMessage: "ancient timeout",
    attemptedAt: new Date(now - 5 * 24 * hour),
  });

  // Org B: 2 email failures inside 24h.
  await seedDelivery({
    orgId: orgBId,
    jobId: "job-B-1",
    channel: "email",
    status: "failure",
    errorMessage: "smtp 421",
    attemptedAt: new Date(now - 3 * hour),
  });
  await seedDelivery({
    orgId: orgBId,
    jobId: "job-B-2",
    channel: "email",
    status: "failure",
    errorMessage: "smtp 421",
    attemptedAt: new Date(now - 5 * hour),
  });

  // Task #1580 — seed a "quiet" org: it ran a transcript backfill job
  // inside the 24h window but produced ZERO alert deliveries (success or
  // failure). Exercises the dataset=quiet CSV branch against real DB
  // rows so the test isn't just asserting on an empty header.
  const quiet = await makeOrgAndAdmin("quiet");
  orgQuietId = quiet.org.id;
  quietJobLastActivity = new Date(now - 1 * hour);
  const quietJobId = `quiet-job-${SUFFIX}`;
  seededJobIds.push(quietJobId);
  await db.insert(crmTranscriptBackfillJobs).values({
    id: quietJobId,
    organizationId: orgQuietId,
    status: "COMPLETED",
    total: 5,
    processed: 5,
    succeeded: 5,
    failed: 0,
    errors: [],
    startedAt: new Date(now - 3 * hour),
    heartbeatAt: quietJobLastActivity,
    completedAt: quietJobLastActivity,
  });

  // Also seed a job for org A so we can assert the quiet branch
  // EXCLUDES orgs that have any delivery activity (orgA seeded failures
  // above). Otherwise the quiet CSV could silently include "noisy"
  // orgs and nobody would notice.
  const orgAJobId = `quiet-noisy-orga-job-${SUFFIX}`;
  seededJobIds.push(orgAJobId);
  await db.insert(crmTranscriptBackfillJobs).values({
    id: orgAJobId,
    organizationId: orgAId,
    status: "COMPLETED",
    total: 3,
    processed: 3,
    succeeded: 3,
    failed: 0,
    errors: [],
    startedAt: new Date(now - 4 * hour),
    heartbeatAt: new Date(now - 2 * hour),
    completedAt: new Date(now - 2 * hour),
  });
}, 120_000);

afterAll(async () => {
  try {
    if (seededDeliveryIds.length > 0) {
      await db
        .delete(crmTranscriptBackfillAlertDeliveries)
        .where(
          inArray(crmTranscriptBackfillAlertDeliveries.id, seededDeliveryIds),
        )
        .catch(() => {});
    }
    // Task #1580 — drop the seeded backfill jobs (and any users in the
    // quiet org) before the orgs themselves so the FK to organizations
    // doesn't block deletion.
    if (seededJobIds.length > 0) {
      await db
        .delete(crmTranscriptBackfillJobs)
        .where(inArray(crmTranscriptBackfillJobs.id, seededJobIds))
        .catch(() => {});
    }
    // Task #1549 — clean up the audit rows our successful CSV exports
    // wrote so the audit_log table doesn't accumulate junk across runs.
    await db
      .delete(auditLog)
      .where(inArray(auditLog.userId, [adminAId, superAdminId, fieldAId]))
      .catch(() => {});
    await db
      .delete(users)
      .where(
        inArray(users.organizationId, [orgAId, orgBId, orgQuietId].filter(Boolean) as string[]),
      )
      .catch(() => {});
    await db
      .delete(organizations)
      .where(
        inArray(
          organizations.id,
          [orgAId, orgBId, orgQuietId].filter(Boolean) as string[],
        ),
      )
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("GET /api/crm/calls/transcripts/backfill/alert-failures-digest.csv", () => {
  it("returns the per-org rollup CSV for SUPER_ADMIN cross-org callers", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true" })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="alert-failures-summary-24h-.*\.csv"/,
    );

    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual([
      "organization_id",
      "organization_name",
      "organization_slug",
      "total",
      "slack_count",
      "email_count",
      "window_hours",
      "since",
      "generated_at",
    ]);

    // We seeded only orgs A (3) and B (2) inside 24h. Other suites can
    // also write to this table, so look up our two test orgs in the body
    // rather than asserting on row count.
    const byOrg = new Map<string, string[]>();
    for (const row of rows.slice(1)) {
      byOrg.set(row[0], row);
    }
    const a = byOrg.get(orgAId);
    const b = byOrg.get(orgBId);
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    expect(a![1]).toMatch(/^__alert_failures_digest_csv_/); // name
    // Slug is the sanitized form (the slug helper collapses leading
    // underscores into a single dash), so just assert it contains our
    // unique suffix and the org label.
    expect(a![2]).toMatch(new RegExp(`alert-failures-digest-csv-.*-orga$`));
    expect(a![3]).toBe("3"); // total
    expect(a![4]).toBe("2"); // slack
    expect(a![5]).toBe("1"); // email
    expect(a![6]).toBe("24"); // window_hours

    expect(b![3]).toBe("2");
    expect(b![4]).toBe("0");
    expect(b![5]).toBe("2");

    // Sorted by total desc within our two orgs.
    const aIdx = rows.findIndex((r) => r[0] === orgAId);
    const bIdx = rows.findIndex((r) => r[0] === orgBId);
    expect(aIdx).toBeLessThan(bIdx);

    // since/generated_at are ISO timestamps.
    expect(new Date(a![7]).toISOString()).toBe(a![7]);
    expect(new Date(a![8]).toISOString()).toBe(a![8]);
  });

  it("widens the window to 7d (168h) so the 5d-old org-A failure is counted", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", windowHours: 168 })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    const rows = parseCsv(res.text);
    const a = rows.find((r) => r[0] === orgAId)!;
    expect(a[3]).toBe("4"); // 3 in 24h + 1 older = 4
    expect(a[5]).toBe("2"); // both email failures
    expect(a[6]).toBe("168");
  });

  it("clamps too-large windowHours to 720", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", windowHours: 99999 })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    const rows = parseCsv(res.text);
    const a = rows.find((r) => r[0] === orgAId)!;
    expect(a[6]).toBe("720");
  });

  it("returns the per-org recent failure samples CSV when dataset=samples", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", dataset: "samples" })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(
      /alert-failures-samples-24h-/,
    );
    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual([
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
    ]);
    const sampleJobIds = rows.slice(1).map((r) => r[3]);
    // Our seeded org-A failures show up.
    expect(sampleJobIds).toEqual(
      expect.arrayContaining(["job-A-1", "job-A-2", "job-A-3"]),
    );
    // Old failure outside the default 24h window does not.
    expect(sampleJobIds).not.toContain("job-A-old");
    // Successful delivery never appears.
    expect(sampleJobIds).not.toContain("job-A-ok");

    // CSV escapes a recipient with embedded comma and an error message
    // with embedded quotes correctly (parseCsv decodes both).
    const a1 = rows.find((r) => r[3] === "job-A-1")!;
    expect(a1[7]).toBe('slack: "channel_not_found", retry_after=30');
  });

  // Task #1549 — SOC2 / tenant-trust requirement: every successful
  // cross-org CSV export must leave an audit_log breadcrumb capturing
  // the actor, the dataset (summary vs samples), the windowHours, and
  // the row counts in the export. Failed/forbidden requests (covered
  // by the 401/403 cases below) must NOT leave a row.
  it("writes an admin audit_log row with actor, dataset, window and row counts", async () => {
    const before = new Date();
    // Summary export — should write a row with orgRowCount > 0 and
    // sampleRowCount = 0 (the summary CSV doesn't include samples).
    const summaryRes = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", windowHours: 48 })
      .set("Cookie", superAdminCookie);
    expect(summaryRes.status).toBe(200);

    const summaryRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, superAdminId),
          eq(auditLog.entityType, "admin_csv_export"),
          eq(auditLog.entityId, "crm_transcript_backfill_alert_failures"),
        ),
      )
      .orderBy(desc(auditLog.createdAt));
    const summaryRow = summaryRows.find((r) => {
      try {
        const v = JSON.parse(r.newValue ?? "{}");
        return v.dataset === "summary" && v.windowHours === 48;
      } catch {
        return false;
      }
    });
    expect(summaryRow).toBeDefined();
    expect(summaryRow!.action).toBe("CREATE");
    expect(summaryRow!.createdAt.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
    const summaryPayload = JSON.parse(summaryRow!.newValue!);
    expect(summaryPayload.dataset).toBe("summary");
    expect(summaryPayload.windowHours).toBe(48);
    expect(typeof summaryPayload.orgRowCount).toBe("number");
    expect(summaryPayload.orgRowCount).toBeGreaterThanOrEqual(2);
    expect(summaryPayload.sampleRowCount).toBe(0);
    expect(typeof summaryPayload.generatedAt).toBe("string");

    // Samples export — should write a *separate* row tagged
    // dataset=samples with sampleRowCount matching the body length.
    const samplesRes = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", dataset: "samples", windowHours: 24 })
      .set("Cookie", superAdminCookie);
    expect(samplesRes.status).toBe(200);
    const samplesBodyRows = parseCsv(samplesRes.text).slice(1).length;

    const allRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, superAdminId),
          eq(auditLog.entityType, "admin_csv_export"),
          eq(auditLog.entityId, "crm_transcript_backfill_alert_failures"),
        ),
      )
      .orderBy(desc(auditLog.createdAt));
    const samplesRow = allRows.find((r) => {
      try {
        const v = JSON.parse(r.newValue ?? "{}");
        return v.dataset === "samples" && v.windowHours === 24;
      } catch {
        return false;
      }
    });
    expect(samplesRow).toBeDefined();
    const samplesPayload = JSON.parse(samplesRow!.newValue!);
    expect(samplesPayload.dataset).toBe("samples");
    expect(samplesPayload.windowHours).toBe(24);
    expect(samplesPayload.sampleRowCount).toBe(samplesBodyRows);
    expect(samplesPayload.orgRowCount).toBeGreaterThanOrEqual(2);
  });

  it("does NOT write an audit_log row when the request is rejected", async () => {
    // A non-super ADMIN gets 403'd by the route — no audit row should
    // be written for them, otherwise the trail fills with noise from
    // probing / misconfigured callers and the SOC2 signal is diluted.
    const beforeRows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, adminAId),
          eq(auditLog.entityType, "admin_csv_export"),
        ),
      );
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true" })
      .set("Cookie", adminACookie);
    expect(res.status).toBe(403);
    const afterRows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, adminAId),
          eq(auditLog.entityType, "admin_csv_export"),
        ),
      );
    expect(afterRows.length).toBe(beforeRows.length);
  });

  it("rejects SUPER_ADMINs without crossOrg=true so it can't fall back silently", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(403);
  });

  it("rejects non-super ADMIN callers even with crossOrg=true", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true" })
      .set("Cookie", adminACookie);
    expect(res.status).toBe(403);
  });

  it("rejects non-admin callers with 403", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true" })
      .set("Cookie", fieldACookie);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true" });
    expect(res.status).toBe(401);
  });

  // Task #1580 — pin the dataset=quiet branch (Task #1568). The "quiet
  // org" signal — orgs that ran backfill in the window but produced ZERO
  // alert deliveries — is only useful if the CSV column shape, filename
  // suffix, and audit row stay stable. A future refactor that drops a
  // header column or relabels the filename would silently break the
  // downloads platform support attaches to incident reviews.
  it("returns the quiet-orgs CSV with the documented header when dataset=quiet", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", dataset: "quiet" })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="alert-failures-quiet-24h-.*\.csv"/,
    );

    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual([
      "organization_id",
      "organization_name",
      "organization_slug",
      "jobs_in_window",
      "last_job_at",
      "window_hours",
      "since",
      "generated_at",
    ]);

    // The seeded quiet org MUST appear (had a job in the window, no
    // delivery rows). The "noisy" orgs A and B (which seeded delivery
    // rows in the same window) MUST NOT appear, otherwise the quiet
    // signal is meaningless.
    const byOrg = new Map<string, string[]>();
    for (const row of rows.slice(1)) {
      byOrg.set(row[0], row);
    }
    const quietRow = byOrg.get(orgQuietId);
    expect(quietRow).toBeDefined();
    expect(byOrg.has(orgAId)).toBe(false);
    expect(byOrg.has(orgBId)).toBe(false);

    expect(quietRow![1]).toMatch(/^__alert_failures_digest_csv_/);
    expect(quietRow![2]).toMatch(
      new RegExp(`alert-failures-digest-csv-.*-quiet$`),
    );
    expect(quietRow![3]).toBe("1"); // jobs_in_window
    // last_job_at is an ISO timestamp matching the seeded heartbeat.
    expect(new Date(quietRow![4]).toISOString()).toBe(quietRow![4]);
    expect(new Date(quietRow![4]).getTime()).toBe(
      quietJobLastActivity.getTime(),
    );
    expect(quietRow![5]).toBe("24"); // window_hours
    expect(new Date(quietRow![6]).toISOString()).toBe(quietRow![6]); // since
    expect(new Date(quietRow![7]).toISOString()).toBe(quietRow![7]); // generated_at
  });

  // Task #1580 — the route normalizes any unrecognized dataset to
  // "summary" rather than 4xx'ing. Pin that fallback so a typo'd
  // dataset query (or a stale UI build) keeps producing a usable
  // export instead of an empty body or an error page.
  it("falls back to the summary dataset for unknown dataset values", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", dataset: "bogus" })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(
      /attachment; filename="alert-failures-summary-24h-.*\.csv"/,
    );
    const rows = parseCsv(res.text);
    expect(rows[0]).toEqual([
      "organization_id",
      "organization_name",
      "organization_slug",
      "total",
      "slack_count",
      "email_count",
      "window_hours",
      "since",
      "generated_at",
    ]);
    // The fallback is a real summary export, not an empty header row —
    // our seeded orgs A and B must show up just like the explicit
    // dataset=summary case above.
    const orgIds = rows.slice(1).map((r) => r[0]);
    expect(orgIds).toEqual(expect.arrayContaining([orgAId, orgBId]));
  });

  // Task #1580 — the audit-row side effect for the new quiet branch
  // must capture dataset=quiet with orgRowCount = the number of quiet
  // orgs exported and sampleRowCount = 0 (the quiet CSV has no
  // failure samples). Without this assertion the SOC2 trail could
  // silently drop the dataset tag for quiet downloads and nobody
  // would notice until support tried to filter by dataset.
  it("writes a dataset=quiet audit row with orgRowCount matching the body", async () => {
    const res = await request(app)
      .get(ENDPOINT)
      .query({ crossOrg: "true", dataset: "quiet", windowHours: 24 })
      .set("Cookie", superAdminCookie);
    expect(res.status).toBe(200);
    const bodyRowCount = parseCsv(res.text).slice(1).length;
    expect(bodyRowCount).toBeGreaterThanOrEqual(1);

    const allRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.userId, superAdminId),
          eq(auditLog.entityType, "admin_csv_export"),
          eq(auditLog.entityId, "crm_transcript_backfill_alert_failures"),
        ),
      )
      .orderBy(desc(auditLog.createdAt));
    const quietRow = allRows.find((r) => {
      try {
        const v = JSON.parse(r.newValue ?? "{}");
        return v.dataset === "quiet" && v.windowHours === 24;
      } catch {
        return false;
      }
    });
    expect(quietRow).toBeDefined();
    expect(quietRow!.action).toBe("CREATE");
    const payload = JSON.parse(quietRow!.newValue!);
    expect(payload.dataset).toBe("quiet");
    expect(payload.windowHours).toBe(24);
    expect(payload.sampleRowCount).toBe(0);
    expect(payload.orgRowCount).toBe(bodyRowCount);
    expect(typeof payload.generatedAt).toBe("string");
  });
});
