/**
 * Task #1016 — UI coverage for the retry-chain lineage chips that the admin
 * transcript-backfill page renders inline on every history row (Task #1004).
 *
 * The storage helper (`getCrmTranscriptBackfillLineages`) is exhaustively
 * covered by `server/__tests__/crm-backfill-lineage.test.ts`. This spec
 * pins the *frontend* contract:
 *
 *   1. The lineage chips render in chronological order
 *      (original → retry 1 → retry 2 → …) on every history row that belongs
 *      to a multi-job chain.
 *   2. Clicking a chip whose target row is on the page expands that row's
 *      details (the `history-details-${id}` panel becomes visible).
 *   3. Standalone runs (single-entry lineage) render no chip strip — keeps
 *      the row visually quiet, matching the route's `lineage.length > 1`
 *      contract.
 *
 * To keep the assertion deterministic and independent of seeded data, we
 * intercept the history endpoint with `page.route(...)` and serve a
 * hand-crafted lineage payload. This exercises the real React component
 * (`RetryLineageChain` + `handleJumpToHistoryRow`) end-to-end without
 * having to provision a multi-step retry chain in the test database.
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

const PARENT_ID = "lineage-parent-0001";
const RETRY_1_ID = "lineage-retry-0002";
const RETRY_2_ID = "lineage-retry-0003";
const STANDALONE_ID = "lineage-standalone-0004";

function isoStep(offsetMs: number): string {
  // Anchored to a fixed instant so ordering assertions stay stable across runs.
  const base = Date.parse("2026-01-15T10:00:00.000Z");
  return new Date(base + offsetMs).toISOString();
}

function makeChainEntry(id: string, attempt: number, parentJobId: string | null) {
  return {
    id,
    status: "FAILED" as const,
    startedAt: isoStep(attempt * 60_000),
    completedAt: isoStep(attempt * 60_000 + 30_000),
    parentJobId,
    attempt,
  };
}

const CHAIN_LINEAGE = [
  makeChainEntry(PARENT_ID, 0, null),
  makeChainEntry(RETRY_1_ID, 1, PARENT_ID),
  makeChainEntry(RETRY_2_ID, 2, RETRY_1_ID),
];

function makeHistoryRow(opts: {
  id: string;
  lineage: typeof CHAIN_LINEAGE;
  status?: "RUNNING" | "COMPLETED" | "FAILED";
}) {
  return {
    id: opts.id,
    organizationId: "org-stub",
    status: opts.status ?? "FAILED",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
    failedRecordingIds: [],
    startedAt: isoStep(0),
    completedAt: isoStep(30_000),
    parentJobId: null,
    concurrency: null,
    maxRecords: null,
    heartbeatAt: isoStep(30_000),
    startedBy: null,
    organization: { id: "org-stub", name: "Stub Org", slug: "stub-org" },
    lineage: opts.lineage,
  };
}

async function stubBackfillEndpoints(page: Page) {
  // Only the GETs need stubbing — the page issues no mutations during this
  // spec. Mutating endpoints (retry POST, etc.) are left unmocked so a
  // regression that fired one accidentally would surface as a real network
  // call in trace output.
  await page.route("**/api/crm/calls/transcripts/backfill", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pending: 0, activeJob: null }),
    });
  });

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

  await page.route(
    "**/api/crm/calls/transcripts/backfill/history**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      // Three rows in the page: every row in the chain (so chip clicks land
      // on visible targets) plus a standalone run that must render no chip
      // strip at all.
      const jobs = [
        // Most recent first — the page issues no explicit sort, the route
        // is the source of order. The lineage payload itself is always in
        // chronological (startedAt ASC) order regardless of row order.
        makeHistoryRow({ id: RETRY_2_ID, lineage: CHAIN_LINEAGE }),
        makeHistoryRow({ id: RETRY_1_ID, lineage: CHAIN_LINEAGE }),
        makeHistoryRow({ id: PARENT_ID, lineage: CHAIN_LINEAGE }),
        makeHistoryRow({
          id: STANDALONE_ID,
          lineage: [],
          status: "COMPLETED",
        }),
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          total: jobs.length,
          limit: 20,
          offset: 0,
          jobs,
        }),
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Task #1058 — UI coverage for the cross-org running-jobs Cancel button
// added in Task #1036. The handler (`cancelMutation`) POSTs to
// `/api/crm/calls/transcripts/backfill/:jobId/cancel`. We stub the summary
// endpoint to surface a fake cross-org running job, then assert that
// clicking the row's Cancel button fires the cancel POST against the right
// job id and that the success toast surfaces the server's reply.
// ---------------------------------------------------------------------------
const CROSS_ORG_RUNNING_JOB_ID = "xorg-running-9999";
const CROSS_ORG_RUNNING_ORG_ID = "org-stub-running";

async function stubCrossOrgSummaryEndpoints(page: Page) {
  // Platform org list — the SUPER_ADMIN start-target picker fetches this
  // on mount. An empty list is enough to keep the picker quiet.
  await page.route("**/api/platform/organizations", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        { id: CROSS_ORG_RUNNING_ORG_ID, name: "Stub Tenant", slug: "stub-tenant" },
      ]),
    });
  });

  // Summary returns the cross-org payload: a single tenant with a RUNNING
  // backfill so the cross-org card mounts and the Cancel button renders.
  await page.route(
    "**/api/crm/calls/transcripts/backfill?**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pending: 0,
          activeJob: null,
          crossOrg: true,
          scopedOrganizationId: null,
          runningJobs: [
            {
              id: CROSS_ORG_RUNNING_JOB_ID,
              organizationId: CROSS_ORG_RUNNING_ORG_ID,
              status: "RUNNING",
              total: 10,
              processed: 4,
              succeeded: 4,
              failed: 0,
              errors: [],
              failedRecordingIds: [],
              startedAt: isoStep(0),
              completedAt: null,
              parentJobId: null,
              concurrency: 2,
              maxRecords: null,
              heartbeatAt: isoStep(30_000),
              startedBy: null,
              organization: {
                id: CROSS_ORG_RUNNING_ORG_ID,
                name: "Stub Tenant",
                slug: "stub-tenant",
              },
            },
          ],
        }),
      });
    },
  );
  // The base path (no querystring) is used when the picker is on the
  // cross-org default — match it too so the page mounts even before any
  // params are appended to the request.
  await page.route(
    "**/api/crm/calls/transcripts/backfill",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          pending: 0,
          activeJob: null,
          crossOrg: true,
          scopedOrganizationId: null,
          runningJobs: [
            {
              id: CROSS_ORG_RUNNING_JOB_ID,
              organizationId: CROSS_ORG_RUNNING_ORG_ID,
              status: "RUNNING",
              total: 10,
              processed: 4,
              succeeded: 4,
              failed: 0,
              errors: [],
              failedRecordingIds: [],
              startedAt: isoStep(0),
              completedAt: null,
              parentJobId: null,
              concurrency: 2,
              maxRecords: null,
              heartbeatAt: isoStep(30_000),
              startedBy: null,
              organization: {
                id: CROSS_ORG_RUNNING_ORG_ID,
                name: "Stub Tenant",
                slug: "stub-tenant",
              },
            },
          ],
        }),
      });
    },
  );

  // Quiet the page's other GETs so the cross-org card isn't crowded out
  // by errors / spinners on unrelated panels.
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
  await page.route(
    "**/api/crm/calls/transcripts/backfill/history**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ total: 0, limit: 20, offset: 0, jobs: [] }),
      });
    },
  );
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
  await page.route(
    "**/api/crm/calls/transcripts/backfill/notification-settings",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          slack: { source: "env", valueMasked: null, valid: false },
          email: { source: "env", recipients: [] },
        }),
      });
    },
  );
  await page.route(
    "**/api/crm/calls/transcripts/backfill/test-alert/latest",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          latest: null,
          cooldownSeconds: 30,
          nextAllowedAt: null,
        }),
      });
    },
  );
  await page.route(
    "**/api/crm/calls/transcripts/backfill/alert-deliveries**",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ deliveries: [] }),
      });
    },
  );
}

test.describe("Admin transcript backfill — cross-org cancel (Task #1058)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    // linkOrg=true keeps the dev SUPER_ADMIN attached to the seeded org so
    // the page session works normally; the cross-org running-jobs card with
    // the per-row Cancel button is driven entirely by the stubbed summary
    // payload (`crossOrg: true` + `crossOrgRunning: [...]`) installed below,
    // so the linked-org status doesn't affect what renders.
    const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
      data: { role: "SUPER_ADMIN", linkOrg: true },
    });
    expect(res.status()).toBe(200);
    await stubCrossOrgSummaryEndpoints(page);
  });

  test("clicking Cancel on a cross-org running job posts to /:jobId/cancel and surfaces the reply", async ({
    page,
  }) => {
    // Capture the cancel POST so we can assert URL + payload after click.
    let cancelRequestUrl: string | null = null;
    await page.route(
      `**/api/crm/calls/transcripts/backfill/${CROSS_ORG_RUNNING_JOB_ID}/cancel`,
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        cancelRequestUrl = route.request().url();
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: CROSS_ORG_RUNNING_JOB_ID,
            status: "CANCELLING",
            reaped: false,
            message:
              "Cancellation requested; the job will stop after the current recording finishes.",
          }),
        });
      },
    );

    await page.goto(`${BASE_URL}/admin/transcript-backfill`, {
      waitUntil: "domcontentloaded",
    });

    // The cross-org running-jobs card must be visible with our stub row.
    await expect(page.getByTestId("card-cross-org-running")).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByTestId(`cross-org-running-row-${CROSS_ORG_RUNNING_JOB_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`cross-org-running-org-${CROSS_ORG_RUNNING_JOB_ID}`),
    ).toContainText("Stub Tenant");

    // Click the per-row Cancel button. The mutation fires a POST whose
    // URL must include the right job id; the toast that follows must
    // reflect the server's "cancellation requested" message (reaped:false).
    await page
      .getByTestId(`button-cross-org-cancel-${CROSS_ORG_RUNNING_JOB_ID}`)
      .click();

    await expect.poll(() => cancelRequestUrl, { timeout: 10_000 }).toContain(
      `/api/crm/calls/transcripts/backfill/${CROSS_ORG_RUNNING_JOB_ID}/cancel`,
    );

    // The success toast surfaces the server reply. The page renders toast
    // titles inside an aria-live region; assert the human-readable string
    // is present somewhere on the page.
    await expect(
      page.getByText("Cancellation requested", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("clicking 'Start backfill here' on a cross-org row posts to /backfill with that org's id", async ({
    page,
  }) => {
    // Capture the start POST so we can assert the body's organizationId
    // matches the targeted tenant (the regression Task #1036 guards
    // against — a SUPER_ADMIN accidentally starting in the wrong tenant).
    let startRequestBody: unknown = null;
    await page.route(
      "**/api/crm/calls/transcripts/backfill",
      async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        try {
          startRequestBody = JSON.parse(route.request().postData() ?? "{}");
        } catch {
          startRequestBody = null;
        }
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({
            jobId: "started-in-target-tenant",
            total: 0,
          }),
        });
      },
    );

    await page.goto(`${BASE_URL}/admin/transcript-backfill`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("card-cross-org-running")).toBeVisible({
      timeout: 30_000,
    });

    await page
      .getByTestId(`button-cross-org-start-${CROSS_ORG_RUNNING_JOB_ID}`)
      .click();

    await expect
      .poll(() => startRequestBody, { timeout: 10_000 })
      .toMatchObject({ organizationId: CROSS_ORG_RUNNING_ORG_ID });
  });
});

test.describe("Admin transcript backfill — retry lineage chips (Task #1016)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
    await stubBackfillEndpoints(page);
  });

  test("renders chips in order and clicking one expands the matching history row", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/admin/transcript-backfill`, {
      waitUntil: "domcontentloaded",
    });

    // Wait for the history list to mount with the stubbed rows.
    await expect(page.getByTestId(`history-row-${RETRY_2_ID}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId(`history-row-${RETRY_1_ID}`)).toBeVisible();
    await expect(page.getByTestId(`history-row-${PARENT_ID}`)).toBeVisible();
    await expect(page.getByTestId(`history-row-${STANDALONE_ID}`)).toBeVisible();

    // 1. Chips render in chronological order on the deepest descendant's row.
    const chain = page.getByTestId(`lineage-chain-${RETRY_2_ID}`);
    await expect(chain).toBeVisible();
    const chipTexts = await chain
      .locator('[data-testid^="lineage-chip-"]')
      .allTextContents();
    expect(chipTexts).toHaveLength(3);
    // The component labels chips "original", "retry 1", "retry 2" — assert
    // both the labels and their order in one go so a regression that
    // reversed startedAt ordering would fail loudly.
    expect(chipTexts[0]).toMatch(/original/i);
    expect(chipTexts[1]).toMatch(/retry\s*1/i);
    expect(chipTexts[2]).toMatch(/retry\s*2/i);

    // The "current" chip is the one whose row we're on — exactly one per chain.
    const currentChips = chain.locator(
      '[data-testid^="lineage-chip-"][data-current="true"]',
    );
    await expect(currentChips).toHaveCount(1);
    await expect(
      page.getByTestId(`lineage-chip-${RETRY_2_ID}-${RETRY_2_ID}`),
    ).toHaveAttribute("data-current", "true");

    // 2. Standalone run must NOT render a chip strip — the route omits
    //    `lineage` for length≤1 and the component renders nothing.
    await expect(
      page.getByTestId(`lineage-chain-${STANDALONE_ID}`),
    ).toHaveCount(0);

    // 3. Clicking a non-current chip on the deepest row should expand the
    //    matching history row (parent in this case). The parent's details
    //    panel must become visible after the click.
    await expect(
      page.getByTestId(`history-details-${PARENT_ID}`),
    ).toHaveCount(0);

    await page
      .getByTestId(`lineage-chip-${RETRY_2_ID}-${PARENT_ID}`)
      .click();

    await expect(
      page.getByTestId(`history-details-${PARENT_ID}`),
    ).toBeVisible();

    // And clicking the retry-1 chip from the parent row should expand
    // retry-1 (the previously expanded parent collapses because the page
    // tracks a single `expandedHistoryId`).
    await page
      .getByTestId(`lineage-chip-${PARENT_ID}-${RETRY_1_ID}`)
      .click();
    await expect(
      page.getByTestId(`history-details-${RETRY_1_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`history-details-${PARENT_ID}`),
    ).toHaveCount(0);
  });
});
