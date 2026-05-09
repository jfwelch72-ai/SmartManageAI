/**
 * Task #2731 — End-to-end tests for the AI Estimator Accept/Reject flow.
 *
 * Architecture:
 *   - The Claude/AI layer is bypassed by using a dev-only seed endpoint
 *     (POST /api/dev/seed-ai-estimator-session) that inserts a real session +
 *     message with proposedActions into the DB — no live Claude call is made.
 *   - The GET /sessions and GET .../messages endpoints are intercepted by
 *     Playwright to return the seeded data to the browser (matching what the
 *     DB contains) so the proposed-action cards render.
 *   - The real apply and reject endpoints (/proposed-actions/apply and
 *     /proposed-actions/reject) are NOT mocked — they execute against the
 *     real server, look up the seeded session + message from the DB, and
 *     either insert a line item (apply) or stamp a rejection decision (reject).
 *   - Accept test: asserts the new line item "Concrete Formwork" becomes
 *     visible in the estimate table after the real apply + invalidateQueries
 *     refetch cycle.
 *   - Reject test: asserts no line item appears and the settled badge shows.
 *
 * State-machine notes (component: AiEstimatorChatPanel.tsx):
 *   Accept: idle → applying → applied-undoable (`action-undoable-*` testid,
 *     undo window open) → applied (permanent, after countdown).
 *   Reject: idle → rejecting → rejected (`action-settled-*` testid, "✗ Rejected").
 *
 * Note: `waitForLoadState("networkidle")` is intentionally avoided on the
 * bid estimate page because it has persistent WebSocket connections (Vite
 * HMR, messaging bus) that prevent networkidle from resolving.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

/** toolCallIds used in the seeded proposed actions — shared with UI assertions. */
const TOOL_CALL_ADD = "tc-add-e2e-1";
const TOOL_CALL_REJECT = "tc-reject-e2e-1";
const TOOL_CALL_VALERR = "tc-valerr-e2e-1";

/** Timeout for the initial card visibility wait — long enough for React hydration + data load. */
const CARD_VISIBLE_TIMEOUT = 20_000;

type MockBid = { id: string; code: string; name: string };
type SeedResult = { sessionId: string; messageId: string };

async function devLogin(page: Page, role = "ADMIN") {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status(), `dev-login failed: ${await res.text()}`).toBe(200);
}

async function createBid(page: Page): Promise<MockBid> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const res = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `E2E AI Chat Test ${suffix}`,
      clientName: "E2E Client",
      bidAmount: "50000",
      status: "DRAFT",
    },
  });
  expect(res.status(), `createBid failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as MockBid;
}

/**
 * Ensure an estimate exists for the given bid and return its real DB UUID.
 *
 * POSTs to create (or retrieve) the estimate, then GETs to reliably read back
 * the `id`. Using a separate GET avoids the fragility of parsing a 201 body
 * that may differ in shape depending on the storage layer version.
 */
async function getOrCreateEstimateId(page: Page, bidId: string): Promise<string> {
  const postRes = await page.request.post(`${BASE_URL}/api/bids/${bidId}/estimate`, {
    data: {},
  });
  expect(
    [200, 201].includes(postRes.status()),
    `estimate POST failed (${postRes.status()}): ${await postRes.text()}`,
  ).toBe(true);

  // GET is the authoritative read path — always returns {estimate: {...}} or {estimate: null}.
  const getRes = await page.request.get(`${BASE_URL}/api/bids/${bidId}/estimate`);
  expect(getRes.status(), `estimate GET failed: ${await getRes.text()}`).toBe(200);
  const body = (await getRes.json()) as { estimate: { id: string } | null };
  expect(body.estimate, "estimate not found after creation").toBeTruthy();
  return body.estimate!.id;
}

/**
 * Seed a real AI Estimator chat session + assistant message with three
 * pre-built proposed actions into the DB, bypassing Claude entirely.
 * Also enables AI Estimator access for the authenticated dev user so that
 * requireEstimatorAccess passes during the test without a separate setup step.
 *
 * estimateId is passed so the seeded session's estimateId column is populated.
 * The component's session-matching logic checks `s.estimateId === estimateId`
 * before selecting an existing session, so a null estimateId would cause it
 * to fall through and auto-create a new (empty) session instead.
 *
 * Returns the real DB-assigned sessionId and messageId that the test's
 * GET-route mocks will echo back to the browser.
 */
async function seedAiEstimatorSession(
  page: Page,
  bidId: string,
  estimateId: string,
): Promise<SeedResult> {
  const proposedActions = [
    {
      toolCallId: TOOL_CALL_ADD,
      action: "add",
      payload: {
        description: "Concrete Formwork",
        category: "MATERIALS",
        quantity: 100,
        unit: "SF",
        materialCost: 2500,
        laborCost: 1500,
        equipmentCost: 0,
        subcontractCost: 0,
      },
    },
    {
      toolCallId: TOOL_CALL_REJECT,
      action: "delete",
      payload: {
        lineItemId: "placeholder-line-item-id",
        description: "Outdated Allowance",
        reason: "No longer in scope.",
      },
    },
    {
      toolCallId: TOOL_CALL_VALERR,
      action: "add",
      payload: {
        description: "Bad Item",
        category: "LABOR",
        quantity: 0,
        unit: "HR",
      },
      validationError: "quantity must be greater than 0",
    },
  ];

  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-ai-estimator-session`,
    { data: { bidId, estimateId, proposedActions } },
  );
  expect(res.status(), `seed-ai-estimator-session failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as SeedResult;
}

/**
 * Install GET-only route intercepts for the AI Estimator status, session list,
 * and message list, using the real sessionId + messageId returned by the seed.
 *
 * The apply and reject endpoints are NOT mocked — they execute on the real
 * server. Playwright intercepts are used only to CAPTURE the request bodies
 * (for defensive assertions) and then forward the request via route.continue().
 *
 * The estimate workspace GET is also NOT mocked — the real server returns the
 * live estimate, which (after a successful apply) includes the newly inserted
 * line item.
 */
async function installAiEstimatorMocks(
  page: Page,
  bid: MockBid,
  estimateId: string,
  seed: SeedResult,
  proposedActions: unknown[],
) {
  const sessionFixture = {
    id: seed.sessionId,
    title: "E2E seed session",
    bidId: bid.id,
    estimateId,
    updatedAt: new Date().toISOString(),
  };

  const messagesFixture = [
    {
      id: `${seed.sessionId}-user`,
      sessionId: seed.sessionId,
      role: "user",
      content: "Can you suggest some changes?",
      citations: null,
      attachments: null,
      feedbackOutcome: null,
      proposedActions: null,
      createdAt: new Date().toISOString(),
    },
    {
      id: seed.messageId,
      sessionId: seed.sessionId,
      role: "assistant",
      content: "Here are my suggested changes to the estimate:",
      citations: null,
      attachments: null,
      feedbackOutcome: null,
      proposedActions,
      createdAt: new Date(Date.now() + 1000).toISOString(),
    },
  ];

  const capturedApply: string[] = [];
  const capturedReject: string[] = [];

  // AI Estimator feature status — tells the page the feature is on so the
  // AiEstimatorIntroCallout renders the full chat UI rather than a "disabled" state.
  await page.route("**/api/ai-estimator/status", (route) => {
    void route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        enabled: true,
        canTrain: false,
        canManage: false,
        featureFlagOn: true,
        reason: "",
      }),
    });
  });

  // Session list — returns the seeded session so the component never issues a
  // POST /sessions create-session call. POST is forwarded to the real server.
  await page.route("**/api/ai-estimator/chat/sessions", (route) => {
    if (route.request().method() === "GET") {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [sessionFixture] }),
      });
    } else {
      void route.continue();
    }
  });

  // Messages for the specific session — returns the seeded messages fixture so
  // the proposed-action cards render immediately. POST (send-turn) is forwarded.
  await page.route(
    `**/api/ai-estimator/chat/sessions/${seed.sessionId}/messages`,
    (route) => {
      if (route.request().method() === "GET") {
        void route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ session: sessionFixture, messages: messagesFixture }),
        });
      } else {
        void route.continue();
      }
    },
  );

  // Apply intercept — captures the toolCallId for defensive assertions, then
  // CONTINUES to the real server so the line item is actually inserted in the DB.
  await page.route("**/proposed-actions/apply", async (route) => {
    try {
      const body = route.request().postDataJSON() as { toolCallId: string };
      capturedApply.push(body.toolCallId);
    } catch { /* non-fatal */ }
    await route.continue();
  });

  // Reject intercept — same pass-through pattern.
  await page.route("**/proposed-actions/reject", async (route) => {
    try {
      const body = route.request().postDataJSON() as { toolCallId: string };
      capturedReject.push(body.toolCallId);
    } catch { /* non-fatal */ }
    await route.continue();
  });

  return { capturedApply, capturedReject };
}

async function goToBidEstimatePage(page: Page, bidCode: string) {
  await page.goto(`${BASE_URL}/bids/${bidCode}/estimate`);
  // domcontentloaded — not networkidle — because the page has persistent
  // WebSocket connections (Vite HMR, messaging bus).
  await page.waitForLoadState("domcontentloaded");
}

// ─── Shared proposed-actions fixture (kept in sync with seed payload) ─────────

const PROPOSED_ACTIONS_FIXTURE = [
  {
    toolCallId: TOOL_CALL_ADD,
    action: "add",
    payload: {
      description: "Concrete Formwork",
      category: "MATERIALS",
      quantity: 100,
      unit: "SF",
      materialCost: 2500,
      laborCost: 1500,
      equipmentCost: 0,
      subcontractCost: 0,
    },
  },
  {
    toolCallId: TOOL_CALL_REJECT,
    action: "delete",
    payload: {
      lineItemId: "placeholder-line-item-id",
      description: "Outdated Allowance",
      reason: "No longer in scope.",
    },
  },
  {
    toolCallId: TOOL_CALL_VALERR,
    action: "add",
    payload: {
      description: "Bad Item",
      category: "LABOR",
      quantity: 0,
      unit: "HR",
    },
    validationError: "quantity must be greater than 0",
  },
];

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe("AI Estimator — Accept/Reject proposed changes (Task #2731)", () => {
  let bid: MockBid;
  let estimateId: string;
  let seed: SeedResult;

  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page);
    bid = await createBid(page);
    // Create a real estimate and capture its UUID.  The page returns early with
    // "Estimate not found" when !estimate.  The component's session-matching
    // logic also uses estimateId to find an existing session — without a
    // matching estimateId the component creates a fresh (empty) session and
    // never shows the seeded proposed-action cards.
    estimateId = await getOrCreateEstimateId(page, bid.id);
    // Seed a real session + message with proposed actions into the DB.
    // estimateId is stored on the session row so the component's
    // `s.estimateId === estimateId` check matches the seeded session.
    seed = await seedAiEstimatorSession(page, bid.id, estimateId);
  });

  // ── 1. ProposedActionCard renders ──────────────────────────────────────────

  test("renders ProposedActionCard with Accept and Reject buttons for each proposed action", async ({
    page,
  }) => {
    await installAiEstimatorMocks(page, bid, estimateId, seed, PROPOSED_ACTIONS_FIXTURE);
    await goToBidEstimatePage(page, bid.code);

    const addCard = page.locator(
      `[data-testid="proposed-action-card-${TOOL_CALL_ADD}"]`,
    );
    await expect(addCard).toBeVisible({ timeout: CARD_VISIBLE_TIMEOUT });

    const acceptBtn = page.locator(
      `[data-testid="button-accept-action-${TOOL_CALL_ADD}"]`,
    );
    const rejectBtn = page.locator(
      `[data-testid="button-reject-action-${TOOL_CALL_ADD}"]`,
    );
    await expect(acceptBtn).toBeVisible();
    await expect(rejectBtn).toBeVisible();
    await expect(acceptBtn).toBeEnabled();
    await expect(rejectBtn).toBeEnabled();

    await expect(
      page.locator(`[data-testid="proposed-action-card-${TOOL_CALL_REJECT}"]`),
    ).toBeVisible();

    await expect(
      page.locator(`[data-testid="proposed-action-card-${TOOL_CALL_VALERR}"]`),
    ).toBeVisible();
  });

  // ── 2. Accept flow ─────────────────────────────────────────────────────────
  //
  // Clicking Accept POSTs to the REAL apply endpoint which:
  //   - Looks up the seeded session + message from the DB
  //   - Inserts a new "Concrete Formwork" line item into the estimate
  //   - Stamps the decision as "applied" on the proposedActions JSON
  // The component then enters "applied-undoable" state (undo window open)
  // and calls queryClient.invalidateQueries which triggers a real re-fetch
  // of the estimate endpoint — the new line item becomes visible in the table.

  test("clicking Accept calls the real apply endpoint, enters undoable state, and the new line item appears in the estimate table", async ({
    page,
  }) => {
    const { capturedApply, capturedReject } = await installAiEstimatorMocks(
      page, bid, estimateId, seed, PROPOSED_ACTIONS_FIXTURE,
    );
    await goToBidEstimatePage(page, bid.code);

    const acceptBtn = page.locator(
      `[data-testid="button-accept-action-${TOOL_CALL_ADD}"]`,
    );
    await expect(acceptBtn).toBeVisible({ timeout: CARD_VISIBLE_TIMEOUT });
    await expect(acceptBtn).toBeEnabled();

    await acceptBtn.click();

    // Card transitions to "applied-undoable": the undo section is shown with
    // "✓ Applied" text and an Undo button; Accept / Reject buttons disappear.
    const undoSection = page.locator(
      `[data-testid="action-undoable-${TOOL_CALL_ADD}"]`,
    );
    await expect(undoSection).toBeVisible({ timeout: 8000 });
    await expect(undoSection).toContainText("Applied");

    await expect(
      page.locator(`[data-testid="button-undo-action-${TOOL_CALL_ADD}"]`),
    ).toBeVisible();
    await expect(acceptBtn).not.toBeVisible();
    await expect(
      page.locator(`[data-testid="button-reject-action-${TOOL_CALL_ADD}"]`),
    ).not.toBeVisible();

    // The apply endpoint was called with the correct toolCallId.
    expect(capturedApply).toContain(TOOL_CALL_ADD);

    // The reject endpoint must NOT have been called during an accept flow.
    expect(capturedReject).toHaveLength(0);

    // The real apply inserted a line item into the DB. The component fires
    // queryClient.invalidateQueries after the apply succeeds, which triggers
    // a real GET /api/bids/:id/estimate that now returns the new line item.
    // LineItemsTable renders both a mobile card (div, lg:hidden) and a desktop
    // table row (tr, visible at Playwright's default 1280 px viewport).
    // We assert by description text rather than by testid (the real DB assigns
    // a random UUID to the new line item, not the predictable fixture id).
    await expect(
      page.locator("table").getByText("Concrete Formwork"),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ── 3. Reject flow ─────────────────────────────────────────────────────────
  //
  // Clicking Reject POSTs to the REAL reject endpoint which stamps the
  // decision as "rejected" in the DB without mutating the estimate.
  // The component settles the card (all interactive controls disappear) and
  // shows a "✗ Rejected" badge. The estimate table remains empty.

  test("clicking Reject calls the real reject endpoint, dismisses all interactive controls, and shows a Rejected badge without mutating the estimate", async ({
    page,
  }) => {
    const { capturedApply, capturedReject } = await installAiEstimatorMocks(
      page, bid, estimateId, seed, PROPOSED_ACTIONS_FIXTURE,
    );
    await goToBidEstimatePage(page, bid.code);

    const rejectBtn = page.locator(
      `[data-testid="button-reject-action-${TOOL_CALL_REJECT}"]`,
    );
    await expect(rejectBtn).toBeVisible({ timeout: CARD_VISIBLE_TIMEOUT });

    // Set up the response waiter BEFORE clicking so Playwright captures the
    // actual HTTP response from the real server — this proves the endpoint
    // succeeded with 200 rather than only checking that a request was sent.
    const rejectResponsePromise = page.waitForResponse(
      (r) =>
        r.url().includes("/proposed-actions/reject") &&
        r.request().method() === "POST",
    );
    await rejectBtn.click();
    const rejectResponse = await rejectResponsePromise;

    // ── Backend correctness: reject persisted successfully ────────────────
    expect(
      rejectResponse.status(),
      "reject endpoint must return HTTP 200",
    ).toBe(200);
    const rejectBody = (await rejectResponse.json()) as {
      rejected?: boolean;
      toolCallId?: string;
    };
    expect(rejectBody.rejected, "reject endpoint must return { rejected: true }").toBe(true);
    expect(
      rejectBody.toolCallId,
      "reject endpoint must echo back the correct toolCallId",
    ).toBe(TOOL_CALL_REJECT);

    // ── UI dismissal: all interactive controls disappear ──────────────────
    await expect(
      page.locator(`[data-testid="button-accept-action-${TOOL_CALL_REJECT}"]`),
    ).not.toBeVisible({ timeout: 8000 });
    await expect(rejectBtn).not.toBeVisible();
    await expect(
      page.locator(`[data-testid="button-undo-action-${TOOL_CALL_REJECT}"]`),
    ).not.toBeVisible();

    // Settled badge confirms the final rejected state in the UI.
    const settledBadge = page.locator(
      `[data-testid="action-settled-${TOOL_CALL_REJECT}"]`,
    );
    await expect(settledBadge).toBeVisible();
    await expect(settledBadge).toContainText("Rejected");

    // ── Intercept sanity: correct endpoint called, apply not called ────────
    expect(capturedReject).toContain(TOOL_CALL_REJECT);
    expect(capturedApply).toHaveLength(0);

    // ── No estimate mutation: reject stamps the decision but never writes
    //    line items. Re-fetch the estimate from the real server and assert
    //    that the line-items array is still empty. ─────────────────────────
    const estimateCheck = await page.request.get(
      `${BASE_URL}/api/bids/${bid.id}/estimate`,
    );
    expect(estimateCheck.status(), "estimate GET must succeed after reject").toBe(200);
    const estimateBody = (await estimateCheck.json()) as {
      estimate: { lineItems?: unknown[] } | null;
    };
    const lineItemCount = estimateBody.estimate?.lineItems?.length ?? 0;
    expect(
      lineItemCount,
      "reject must not insert any line items — estimate must remain empty",
    ).toBe(0);
  });

  // ── 4. validationError edge case ──────────────────────────────────────────

  test("card with validationError shows error text and has Accept disabled", async ({
    page,
  }) => {
    await installAiEstimatorMocks(page, bid, estimateId, seed, PROPOSED_ACTIONS_FIXTURE);
    await goToBidEstimatePage(page, bid.code);

    const errCard = page.locator(
      `[data-testid="proposed-action-card-${TOOL_CALL_VALERR}"]`,
    );
    await expect(errCard).toBeVisible({ timeout: CARD_VISIBLE_TIMEOUT });

    // Accept must be disabled when there is a validationError.
    const acceptBtn = page.locator(
      `[data-testid="button-accept-action-${TOOL_CALL_VALERR}"]`,
    );
    await expect(acceptBtn).toBeVisible();
    await expect(acceptBtn).toBeDisabled();

    // Reject must still be enabled so the user can dismiss the card.
    const rejectBtn = page.locator(
      `[data-testid="button-reject-action-${TOOL_CALL_VALERR}"]`,
    );
    await expect(rejectBtn).toBeEnabled();

    // The validation error text must be visible inside the card.
    await expect(errCard).toContainText("quantity must be greater than 0");
  });
});
