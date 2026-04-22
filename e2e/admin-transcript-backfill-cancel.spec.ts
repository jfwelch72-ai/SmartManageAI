/**
 * Task #1071 — UI coverage for the Cancelled terminal state added in Task
 * #1057. The server-side cancel endpoint (live + stale-worker reap paths)
 * is exercised by the integration test at
 * `server/__tests__/crm-transcript-backfill-cancel.test.ts`. This spec
 * pins the *frontend* contract that admins rely on:
 *
 *   1. The active-job card renders the dedicated "Cancelled" badge label
 *      (with the Ban icon and outline variant — i.e. NOT the destructive
 *      crash styling) when the in-flight job's status is CANCELLED.
 *   2. The same Cancelled badge + label renders on the history row that
 *      corresponds to a cancelled run, so admins skimming history can tell
 *      a deliberate stop apart from a crash.
 *   3. The history "Status" filter exposes the Cancelled option and, when
 *      selected, the resulting history fetch returns only CANCELLED rows
 *      (the page sends `status=CANCELLED` and renders exactly what the
 *      server returns).
 *
 * As with the lineage spec (Task #1016), we intercept the relevant GETs
 * with `page.route(...)` so the test data is deterministic and doesn't
 * depend on having a live cancelled backfill seeded in the test DB. The
 * cancel endpoint itself isn't fired by this spec — it has its own
 * dedicated server-side coverage.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

async function devAdminLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status()).toBe(200);
}

const CANCELLED_ACTIVE_ID = "active-cancelled-0001";
const CANCELLED_HISTORY_ID = "history-cancelled-0002";
const COMPLETED_HISTORY_ID = "history-completed-0003";
const FAILED_HISTORY_ID = "history-failed-0004";

function isoStep(offsetMs: number): string {
  // Anchored to a fixed instant so the "started"/"finished" timestamps
  // don't drift across runs.
  const base = Date.parse("2026-04-22T10:00:00.000Z");
  return new Date(base + offsetMs).toISOString();
}

type Status = "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

function makeJob(opts: { id: string; status: Status }) {
  return {
    id: opts.id,
    status: opts.status,
    total: 10,
    processed: opts.status === "RUNNING" ? 4 : 6,
    succeeded: opts.status === "RUNNING" ? 4 : opts.status === "FAILED" ? 4 : 6,
    failed: opts.status === "FAILED" ? 2 : 0,
    errors: [],
    failedRecordingIds: [],
    startedAt: isoStep(0),
    completedAt: opts.status === "RUNNING" ? null : isoStep(60_000),
    parentJobId: null,
    concurrency: 2,
    maxRecords: null,
    heartbeatAt: isoStep(30_000),
  };
}

function makeHistoryRow(opts: { id: string; status: Status }) {
  return {
    ...makeJob(opts),
    startedBy: {
      id: "stub-user",
      firstName: "Stub",
      lastName: "Admin",
      email: "stub@example.invalid",
    },
    organization: { id: "org-stub", name: "Stub Org", slug: "stub-org" },
    lineage: [],
    notification: null,
  };
}

const ACTIVE_CANCELLED_JOB = makeJob({
  id: CANCELLED_ACTIVE_ID,
  status: "CANCELLED",
});

const ALL_HISTORY_ROWS = [
  makeHistoryRow({ id: CANCELLED_HISTORY_ID, status: "CANCELLED" }),
  makeHistoryRow({ id: COMPLETED_HISTORY_ID, status: "COMPLETED" }),
  makeHistoryRow({ id: FAILED_HISTORY_ID, status: "FAILED" }),
];

async function stubBackfillEndpoints(page: Page) {
  // ── Summary (activeJob) — exact path match so the per-job GET below
  // (which has the job id appended) doesn't accidentally swallow this. ──
  await page.route(/\/api\/crm\/calls\/transcripts\/backfill(\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        pending: 0,
        activeJob: ACTIVE_CANCELLED_JOB,
      }),
    });
  });

  // ── Per-job poll (jobQuery) — the page hits this with the activeJob id
  // it picked up from the summary. Return the same cancelled payload so
  // the active-job card renders the Cancelled badge. ──
  await page.route(
    new RegExp(`/api/crm/calls/transcripts/backfill/${CANCELLED_ACTIVE_ID}(\\?.*)?$`),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ACTIVE_CANCELLED_JOB),
      });
    },
  );

  // ── Operators picker — empty list keeps the dropdown quiet. ──
  await page.route(
    "**/api/crm/calls/transcripts/backfill/operators",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ operators: [] }),
      });
    },
  );

  // ── Pending recordings drill-down — empty so the pending card stays
  // out of the way. ──
  await page.route(
    "**/api/crm/calls/transcripts/backfill/pending**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: 0, limit: 20, offset: 0, recordings: [] }),
      });
    },
  );

  // ── History — honor the `status` query param so the filter assertion
  // below actually exercises the status pipeline end-to-end. The server
  // would filter rows by status; we mirror that locally so the page
  // renders exactly what the real backend would return. ──
  await page.route(
    "**/api/crm/calls/transcripts/backfill/history**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const url = new URL(route.request().url());
      const statusFilter = url.searchParams.get("status");
      const filtered = statusFilter
        ? ALL_HISTORY_ROWS.filter((r) => r.status === statusFilter)
        : ALL_HISTORY_ROWS;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: filtered.length,
          limit: 20,
          offset: 0,
          jobs: filtered,
        }),
      });
    },
  );

  // ── Notification config card needs *some* response so the page doesn't
  // sit on a loading spinner that obscures the active-job card. ──
  await page.route(
    "**/api/crm/calls/transcripts/backfill/notification-config",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slack: { configured: false, valid: false },
          email: { configured: false, recipients: [] },
        }),
      });
    },
  );

  // ── Latest test-alert card — null keeps the section collapsed. ──
  await page.route(
    "**/api/crm/calls/transcripts/backfill/test-alert/latest",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(null),
      });
    },
  );

  // ── Test-alert history — empty list. ──
  await page.route(
    "**/api/crm/calls/transcripts/backfill/test-alert/history**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: 0,
          limit: 10,
          offset: 0,
          crossOrg: false,
          alerts: [],
        }),
      });
    },
  );
}

test.describe("Admin transcript backfill — Cancelled state UI (Task #1071)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
    await stubBackfillEndpoints(page);
  });

  test("renders the Cancelled badge on the active-job card and on the matching history row, and the Cancelled status filter narrows history to only cancelled runs", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/transcript-backfill`, {
      waitUntil: "domcontentloaded",
    });

    // 1. Active-job card renders the Cancelled badge with the dedicated
    //    "Cancelled" label (NOT raw "CANCELLED" enum text). The Ban icon
    //    is the visual cue Task #1057 added so cancelled runs don't read
    //    as crashes.
    const activeBadge = page.getByTestId("badge-job-status");
    await expect(activeBadge).toBeVisible({ timeout: 30_000 });
    await expect(activeBadge).toHaveText(/^\s*Cancelled\s*$/);
    // The cancel CTA must be hidden — the run is already terminal.
    await expect(
      page.getByTestId("button-cancel-active-backfill"),
    ).toHaveCount(0);

    // 2. Default history view (no status filter) shows every row,
    //    including the cancelled one with the dedicated label.
    await expect(
      page.getByTestId(`history-row-${CANCELLED_HISTORY_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`history-row-${COMPLETED_HISTORY_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`history-row-${FAILED_HISTORY_ID}`),
    ).toBeVisible();

    const cancelledHistoryBadge = page.getByTestId(
      `badge-history-status-${CANCELLED_HISTORY_ID}`,
    );
    await expect(cancelledHistoryBadge).toHaveText(/^\s*Cancelled\s*$/);
    // Sanity-check the COMPLETED/FAILED rows still render their raw
    // status (those didn't get a custom label) — this is what guards
    // against an over-eager rename that would collateral-damage the
    // other terminal states.
    await expect(
      page.getByTestId(`badge-history-status-${COMPLETED_HISTORY_ID}`),
    ).toHaveText(/COMPLETED/);
    await expect(
      page.getByTestId(`badge-history-status-${FAILED_HISTORY_ID}`),
    ).toHaveText(/FAILED/);

    // 3. Apply the Cancelled status filter and assert only the cancelled
    //    row is rendered. The mocked /history endpoint above honors the
    //    `status` query param so this exercises the full filter pipeline
    //    (UI → request params → render).
    const historyRequestPromise = page.waitForRequest((req) => {
      if (req.method() !== "GET") return false;
      const u = new URL(req.url());
      return (
        u.pathname.endsWith("/api/crm/calls/transcripts/backfill/history") &&
        u.searchParams.get("status") === "CANCELLED"
      );
    });

    await page.getByTestId("select-history-status").click();
    await page
      .getByTestId("select-history-status-option-CANCELLED")
      .click();

    await historyRequestPromise;

    await expect(
      page.getByTestId(`history-row-${CANCELLED_HISTORY_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`history-row-${COMPLETED_HISTORY_ID}`),
    ).toHaveCount(0);
    await expect(
      page.getByTestId(`history-row-${FAILED_HISTORY_ID}`),
    ).toHaveCount(0);
  });
});
