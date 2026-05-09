/**
 * Task #2735 — E2E coverage for the AI chat panel undo countdown transition.
 *
 * When a user accepts a proposed AI change the component enters an
 * "applied-undoable" state and starts a 30-second countdown.  Once the
 * timer reaches zero the state permanently transitions to "applied" and the
 * undo affordance disappears.
 *
 * Strategy:
 *  - `devLogin` (ADMIN) for authentication.
 *  - Create a real bid + estimate via the API so the bid-estimate page
 *    renders its full UI including the chat panel.  (Without an estimate
 *    the page returns early with "Estimate not found".)
 *  - `page.route()` stubs cover all AI estimator endpoints so no real AI
 *    calls are made and no DB rows beyond bid/estimate are created:
 *      · GET  /sessions  → empty list → component auto-creates a session
 *      · POST /sessions  → returns a pre-crafted fake session
 *      · GET  /sessions/:id/messages → one assistant message with a pending action
 *      · POST .../apply  → success + undoSnapshot
 *  - The countdown runs in real time (UNDO_WINDOW_SECONDS = 30 s).  The test
 *    timeout is set to 90 s so the full 30-second window fits comfortably.
 *    Fake-clock approaches were attempted but `setActionStates` called inside
 *    a `setUndoCountdowns` functional updater is a render-phase side-effect
 *    that React 18 automatic batching does not reliably flush when all 30
 *    interval ticks fire synchronously from `clock.fastForward`.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

// 90 s — allows the 30-second countdown to run to completion with headroom.
test.setTimeout(90_000);

const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const FAKE_SESSION_ID = "e2e-session-undo-timer-001";
const FAKE_TOOL_CALL_ID = "e2e-tc-undo-timer-001";

// ── API helpers ────────────────────────────────────────────────────────────

async function devLogin(page: Page) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status()).toBe(200);
}

interface BidCreateResponse {
  id: string;
  code: string;
}

interface EstimateCreateResponse {
  id: string;
}

/** Create a minimal bid and an empty DRAFT estimate for it. */
async function createBidWithEstimate(page: Page) {
  const ts = Date.now();

  const bidRes = await page.request.post(`${BASE_URL}/api/bids`, {
    data: {
      name: `E2E Undo Countdown Bid ${ts}`,
      clientName: "E2E Client",
      bidAmount: "50000",
    },
  });
  expect(bidRes.status()).toBe(201);
  const bid = (await bidRes.json()) as BidCreateResponse;
  expect(bid.id).toBeTruthy();
  expect(bid.code).toBeTruthy();

  const estRes = await page.request.post(
    `${BASE_URL}/api/bids/${bid.id}/estimate`,
    { data: {} },
  );
  expect(estRes.status()).toBe(201);
  const estimate = (await estRes.json()) as EstimateCreateResponse;
  expect(estimate.id).toBeTruthy();

  return { bidId: bid.id, bidCode: bid.code, estimateId: estimate.id };
}

// ── Route stubs ────────────────────────────────────────────────────────────

/**
 * Stub all AI Estimator endpoints so the chat panel renders our crafted
 * fixture data without touching the DB or calling real AI providers.
 *
 * The session-create path is exploited intentionally: returning an empty list
 * from GET /sessions causes the component to call `createSession.mutate()`,
 * which our POST stub intercepts and responds with our pre-crafted session.
 * This sidesteps the `s.bidId === bidId && s.estimateId === estimateId`
 * filter in the component's auto-select logic.
 */
async function stubAiEstimatorRoutes(page: Page) {
  const fakeSession = {
    id: FAKE_SESSION_ID,
    title: "E2E Undo Countdown Session",
    bidId: null,
    estimateId: null,
    updatedAt: new Date().toISOString(),
  };

  // Feature-flag check — enabled so the panel mounts fully.
  await page.route("**/api/ai-estimator/status", (route) => {
    if (route.request().method() !== "GET") { route.continue(); return; }
    route.fulfill({
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

  // Sessions list — empty so the component triggers createSession.mutate().
  // POST (create-session) — returns our pre-crafted fake session.
  await page.route("**/api/ai-estimator/chat/sessions", (route) => {
    const method = route.request().method();
    if (method === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessions: [] }),
      });
      return;
    }
    if (method === "POST") {
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(fakeSession),
      });
      return;
    }
    route.continue();
  });

  // Messages for the fake session — one assistant message with a pending
  // "add" proposed action (decision null → shows Accept + Reject buttons).
  await page.route(
    `**/${FAKE_SESSION_ID}/messages`,
    (route) => {
      if (route.request().method() !== "GET") { route.continue(); return; }
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: fakeSession,
          messages: [
            {
              id: "e2e-message-undo-timer-001",
              role: "assistant",
              content: "I will add a masonry line item to your estimate.",
              citations: null,
              attachments: null,
              feedbackOutcome: null,
              sessionId: FAKE_SESSION_ID,
              createdAt: new Date().toISOString(),
              proposedActions: [
                {
                  toolCallId: FAKE_TOOL_CALL_ID,
                  action: "add",
                  decision: null,
                  undoSnapshot: null,
                  payload: {
                    description: "Masonry — block wall",
                    category: "CONCRETE",
                    unit: "SF",
                    quantity: "200",
                    materialCost: "2000",
                    laborCost: "800",
                    totalCost: "2800",
                  },
                },
              ],
            },
          ],
        }),
      });
    },
  );

  // Apply endpoint — success with an undoSnapshot so the component can
  // enter the "applied-undoable" state.
  await page.route("**/proposed-actions/apply", (route) => {
    if (route.request().method() !== "POST") { route.continue(); return; }
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        applied: true,
        toolCallId: FAKE_TOOL_CALL_ID,
        undoSnapshot: { lineItemId: "fake-line-item-e2e-001" },
      }),
    });
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────

test.describe("AI Estimator — undo countdown transition (Task #2735)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page);
  });

  test(
    "accepting a proposed action shows 30-s undo countdown then transitions to permanently applied",
    async ({ page }) => {
      // ── Stubs wired before navigation ──────────────────────────────────
      await stubAiEstimatorRoutes(page);

      // ── Create a real bid + estimate so the page renders the chat panel ──
      // Without an estimate the bid-estimate page returns early with
      // "Estimate not found" and AiEstimatorChatPanel never mounts.
      const { bidCode } = await createBidWithEstimate(page);

      // ── Navigate to the bid estimate page ─────────────────────────────
      // GlobalSSEProvider opens a long-lived EventSource on auth, so
      // `networkidle` never settles within the test timeout — use
      // `domcontentloaded` + a content assertion instead (same pattern as
      // estimate-pdf-export-formulas.spec.ts).
      await page.goto(`${BASE_URL}/bids/${bidCode}/estimate`, {
        waitUntil: "domcontentloaded",
      });

      // ── Chat panel must be visible ─────────────────────────────────────
      const chatPanel = page.locator('[data-testid="ai-estimator-chat-panel"]');
      await chatPanel.scrollIntoViewIfNeeded();
      await expect(chatPanel).toBeVisible({ timeout: 15_000 });

      // ── Proposed action card must appear once messages load ────────────
      // Flow: sessions stub returns [] → component calls POST /sessions →
      // stub returns fake session → messages query fires → stub returns the
      // assistant message with a pending action → card renders.
      const actionCard = page.locator(
        `[data-testid="proposed-action-card-${FAKE_TOOL_CALL_ID}"]`,
      );
      await actionCard.scrollIntoViewIfNeeded();
      await expect(actionCard).toBeVisible({ timeout: 15_000 });

      // Both decision buttons must be present before any decision.
      const acceptBtn = page.locator(
        `[data-testid="button-accept-action-${FAKE_TOOL_CALL_ID}"]`,
      );
      const rejectBtn = page.locator(
        `[data-testid="button-reject-action-${FAKE_TOOL_CALL_ID}"]`,
      );
      await expect(acceptBtn).toBeVisible();
      await expect(rejectBtn).toBeVisible();

      // ── Accept the proposed action ─────────────────────────────────────
      await acceptBtn.click();

      // Component must enter "applied-undoable" state:
      //   • undoable section appears with countdown
      //   • Accept / Reject buttons disappear
      //   • Undo button is present
      const undoSection = page.locator(
        `[data-testid="action-undoable-${FAKE_TOOL_CALL_ID}"]`,
      );
      await expect(undoSection).toBeVisible({ timeout: 5_000 });
      await expect(acceptBtn).not.toBeVisible();
      await expect(rejectBtn).not.toBeVisible();

      const undoBtn = page.locator(
        `[data-testid="button-undo-action-${FAKE_TOOL_CALL_ID}"]`,
      );
      await expect(undoBtn).toBeVisible();

      // ── Wait for the real 30-second countdown to expire ────────────────
      // The countdown runs via setInterval (1-second ticks, 30 iterations).
      // The test timeout (90 s) is set at the top of this file to accommodate
      // the wait.  Fake-clock acceleration is not used because calling
      // setActionStates inside a setUndoCountdowns functional updater is a
      // side-effect that React 18 automatic batching does not reliably flush
      // when all 30 ticks fire synchronously from clock.fastForward.
      const settledBadge = page.locator(
        `[data-testid="action-settled-${FAKE_TOOL_CALL_ID}"]`,
      );
      await expect(settledBadge).toBeVisible({ timeout: 35_000 });

      // ── Verify permanently settled state ───────────────────────────────
      await expect(undoSection).not.toBeVisible();
      await expect(undoBtn).not.toBeVisible();
    },
  );
});
