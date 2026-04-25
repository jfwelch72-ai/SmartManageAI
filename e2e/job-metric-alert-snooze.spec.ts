/**
 * Task #2024 — End-to-end coverage for the Super Admin one-click
 * snooze flow on `pool_health.waitingSaturated` alerts surfaced via
 * the in-app notification feed.
 *
 * The alert engine writes one notification per fired alert with
 * `relatedEntityType: "job_metric_alert"` and the dedupe key
 * `<job>:<counter|_>:<kind>` packed into `relatedEntityId` (see
 * `server/utils/jobMetricAlerts.ts`). The Notifications dashboard
 * widget (`NotificationsWidget` -> `JobMetricAlertItem`) lets the
 * operator snooze the page for 1h / 4h / 24h directly from the bell
 * row without first navigating to the Job Metrics dashboard, by
 * POSTing to `/api/admin/metrics/jobs/alerts/snooze-by-key`. The
 * snooze writes `snoozedUntil` on the most recent matching event in
 * the last 24h and the engine reads the same `(job, counter, kind)`
 * tuple via `fetchActiveSnoozeLookup` to suppress re-pages.
 *
 * This spec pins down that contract:
 *
 *   1. Seed a fresh `pool_health.waitingSaturated:spike` event +
 *      a matching unread notification for the calling SUPER_ADMIN
 *      via the dev-only `/api/dev/seed-job-metric-alert` endpoint.
 *   2. Open `/dashboard` and assert the bell row renders as a
 *      `JobMetricAlertItem` — i.e. with the alert title, message,
 *      and "Snooze" trigger. The widget grid only mounts for non-
 *      SUPER_ADMIN roles (`dashboard.tsx` hard-redirects SUPER_ADMIN
 *      to `/admin`), so we override the `/api/auth/me` JSON body to
 *      report `role: "ADMIN"` for the React shell while leaving the
 *      JWT cookie pointing at the real SUPER_ADMIN — every server
 *      request still authenticates as SUPER_ADMIN and the snooze
 *      endpoint's `requireRole("SUPER_ADMIN")` passes.
 *   3. Open the Snooze dropdown, click "4 hours", and intercept the
 *      POST to `/api/admin/metrics/jobs/alerts/snooze-by-key`.
 *      Assert the response is 200 and `snoozedUntil` lands in the
 *      4-hour window we asked for (with a small skew tolerance).
 *   4. The bell row's `onDismiss` then marks the notification read,
 *      so it must disappear from the unread feed
 *      (`/api/notifications` no longer returns it as `isRead: false`).
 *   5. Trigger a fresh engine evaluation
 *      (`POST /api/admin/metrics/jobs/alerts/run`) and confirm the
 *      `pool_health` page does NOT re-fire — the snooze suppresses
 *      both in-app and email re-notifications until expiry.
 *
 * We seed via a dedicated dev-only endpoint (rather than relying on
 * the engine to organically fire `pool_health.waitingSaturated`) so
 * the test is deterministic regardless of dev-sandbox metric state,
 * and so it doesn't depend on a real `pool_health` rule being
 * present in the dev DB. The seed endpoint is gated by
 * `requireDevSeed` (NODE_ENV=development) and `requireAuth` +
 * SUPER_ADMIN, and a matching DELETE wipes the rows we created so
 * the test is self-cleaning.
 */
import { test, expect, type Page, type Route } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

const SNOOZE_BY_KEY_URL = /\/api\/admin\/metrics\/jobs\/alerts\/snooze-by-key$/;
const AUTH_ME_URL = /\/api\/auth\/me(\?.*)?$/;
const HOUR_MS = 60 * 60 * 1000;

interface DevLoginResponse {
  user: { id: string; role: string; email: string };
}

interface SeedResponse {
  success: true;
  event: { id: string; job: string; counter: string | null; kind: string };
  notification: { id: string; userId: string; relatedEntityId: string };
  relatedEntityId: string;
  marker: string;
}

interface NotificationRow {
  id: string;
  isRead: boolean;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
}

interface SnoozeResponse {
  id: string;
  job: string;
  counter: string | null;
  kind: "spike" | "stall";
  snoozedUntil: string | null;
}

interface EvaluateResult {
  evaluatedAt: number;
  jobsScanned: number;
  alertsFired: Array<{ job: string; counter: string | null; kind: string }>;
  alertsSuppressed: number;
}

async function devSuperAdminLogin(page: Page): Promise<DevLoginResponse> {
  // linkOrg=true keeps the dev SUPER_ADMIN attached to the dev
  // sandbox org so org-scoped UIs (and the GET /api/notifications
  // org filter that matches the organizationId we stamp on the
  // seeded notification) behave correctly.
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "SUPER_ADMIN", linkOrg: true },
  });
  expect(res.status(), `dev test-login failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as DevLoginResponse;
}

/**
 * Stub the client-side `/api/auth/me` response so the React shell
 * sees the caller as ADMIN even though the auth cookie still belongs
 * to the dev SUPER_ADMIN account. This is the smallest change that
 * lets us exercise the JobMetricAlertItem inside its real mount
 * point — the customizable `NotificationsWidget` on `/dashboard` —
 * because `client/src/pages/dashboard.tsx` hard-redirects any
 * SUPER_ADMIN client to `/admin` (PlatformAdminDashboard) before the
 * widget grid mounts. The redirect is purely client-side and only
 * inspects `useAuth().user.role`, so swapping the JSON body of
 * `/api/auth/me` keeps the Express session intact: every backend
 * request (including the snooze POST that requires
 * `requireRole("SUPER_ADMIN")`) still resolves to the real SUPER_ADMIN
 * user via the JWT cookie. We narrow the override to ADMIN — the
 * least-privileged role that still gets the customizable layout
 * default-shipped with a NOTIFICATIONS widget (see
 * `server/dashboardDefaults.ts`).
 */
async function stubAuthMeAsAdmin(
  page: Page,
  superAdmin: DevLoginResponse["user"],
): Promise<void> {
  await page.route(AUTH_ME_URL, async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    // Pass through to the real handler so we get every server-managed
    // field (organizationName, onboardingStatus, etc.) and only flip
    // the `user.role` bit that the client-side gate inspects. The
    // `/api/auth/me` payload is `{ user, organizationName, ... }`
    // (see client/src/hooks/use-auth.tsx), so the override must be
    // nested under `user`, not on the root.
    const response = await route.fetch();
    type AuthMeBody = {
      user?: Record<string, unknown> & { role?: string; effectiveRole?: string };
      [k: string]: unknown;
    };
    let body: AuthMeBody;
    try {
      body = (await response.json()) as AuthMeBody;
    } catch {
      body = { user: { id: superAdmin.id, email: superAdmin.email } };
    }
    if (!body.user || typeof body.user !== "object") {
      body.user = { id: superAdmin.id, email: superAdmin.email };
    }
    body.user.role = "ADMIN";
    // `permissionRole` in use-auth falls back to `effectiveRole`
    // before `role`, so clear any stale super-admin elevation that
    // would still trip the dashboard redirect gate.
    body.user.effectiveRole = "ADMIN";
    // Strip Content-Length / Content-Encoding from the upstream
    // headers — we are sending a fresh, uncompressed JSON body and
    // the original byte counts no longer apply.
    const headers = { ...response.headers() };
    delete headers["content-length"];
    delete headers["content-encoding"];
    await route.fulfill({
      status: response.status(),
      headers,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

async function seedJobMetricAlert(page: Page): Promise<SeedResponse> {
  const res = await page.request.post(
    `${BASE_URL}/api/dev/seed-job-metric-alert`,
  );
  expect(res.status(), `seed failed: ${await res.text()}`).toBe(200);
  return (await res.json()) as SeedResponse;
}

async function cleanupJobMetricAlert(page: Page): Promise<void> {
  // Best-effort — never let cleanup failures fail the test, the
  // marker-scoped seed will overwrite stragglers on the next run.
  await page.request
    .delete(`${BASE_URL}/api/dev/seed-job-metric-alert`)
    .catch(() => undefined);
}

async function fetchNotifications(page: Page): Promise<NotificationRow[]> {
  const res = await page.request.get(`${BASE_URL}/api/notifications`);
  expect(res.status()).toBe(200);
  return (await res.json()) as NotificationRow[];
}

test.describe("Job-metric alert one-click snooze (Task #2024)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    const login = await devSuperAdminLogin(page);
    // Install the role override before any in-page navigation so the
    // first /api/auth/me from the React shell is intercepted and the
    // dashboard.tsx redirect to /admin doesn't fire.
    await stubAuthMeAsAdmin(page, login.user);
    // Pre-dismiss the FirstTimeWelcomeModal — it auto-opens for any
    // user who hasn't seen it this session and would cover the
    // dashboard widget grid (and therefore our notification row).
    // The dismiss flag is stored in sessionStorage under
    // `smartmanage-welcome-dismissed-${userId}` (see
    // client/src/components/FirstTimeWelcomeModal.tsx getDismissedKey).
    const dismissKey = `smartmanage-welcome-dismissed-${login.user.id}`;
    await page.addInitScript((key: string) => {
      try {
        sessionStorage.setItem(key, "true");
      } catch {
        /* sessionStorage may not be available pre-navigation; modal will fall back to its skip button */
      }
    }, dismissKey);
    // Wipe any prior run's seed rows up-front so a previous failure
    // can't leave a stale notification (and a stale snoozedUntil)
    // that would mask a regression in this run.
    await cleanupJobMetricAlert(page);
  });

  test.afterEach(async ({ page }) => {
    await cleanupJobMetricAlert(page);
  });

  test("Snooze 4h from the dashboard widget hides the bell row, persists snoozedUntil, and prevents re-paging", async ({
    page,
  }) => {
    // ---- Arrange: seed a fresh pool_health.waitingSaturated:spike
    // event + matching unread notification for this Super Admin.
    const seed = await seedJobMetricAlert(page);
    expect(seed.relatedEntityId).toBe("pool_health:waitingSaturated:spike");
    const notificationId = seed.notification.id;

    // ---- Act 1: open the dashboard and confirm the JobMetricAlertItem
    // mounts with the snooze controls in the NotificationsWidget.
    await page.goto(`${BASE_URL}/dashboard`);

    // The NotificationsWidget lives in the "Communications" section
    // near the bottom of the ADMIN_LAYOUT (server/dashboardDefaults.ts).
    // Many widgets above it lazy-load data, so the alert row may not
    // be in the viewport when it first mounts. Wait for the element
    // to attach, then scroll it into view before the visibility check.
    const alertItem = page.getByTestId(`notification-item-${notificationId}`);
    await alertItem.waitFor({ state: "attached", timeout: 15_000 });
    await alertItem.scrollIntoViewIfNeeded();
    await expect(alertItem).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId(`text-alert-title-${notificationId}`),
    ).toContainText("pool_health");
    await expect(
      page.getByTestId(`text-alert-message-${notificationId}`),
    ).toContainText("waitingSaturated");

    const snoozeButton = page.getByTestId(
      `button-snooze-notification-${notificationId}`,
    );
    await expect(snoozeButton).toBeVisible();

    // ---- Act 2: open the dropdown, intercept the snooze POST, then
    // pick the 4h option. Wait on the response so we can assert the
    // server returned 200 with a snoozedUntil that lands in the
    // requested 4h window (allowing a small clock-skew buffer).
    const tStart = Date.now();
    await snoozeButton.click();
    const fourHourOption = page.getByTestId(
      `option-snooze-notification-${notificationId}-4h`,
    );
    await expect(fourHourOption).toBeVisible();

    const [snoozeResp] = await Promise.all([
      page.waitForResponse(
        (r) => SNOOZE_BY_KEY_URL.test(r.url()) && r.request().method() === "POST",
      ),
      fourHourOption.click(),
    ]);

    expect(snoozeResp.status()).toBe(200);
    const snoozeBody = (await snoozeResp.json()) as SnoozeResponse;
    expect(snoozeBody.job).toBe("pool_health");
    expect(snoozeBody.counter).toBe("waitingSaturated");
    expect(snoozeBody.kind).toBe("spike");
    expect(snoozeBody.snoozedUntil).toBeTruthy();

    // The snooze duration is 4h from the server's `now()`, which we
    // bracket by the wall-clock window the test observed around the
    // click. The 5s skew tolerance covers HTTP latency + any clock
    // drift between the test runner and the server clock.
    const snoozedUntilMs = new Date(snoozeBody.snoozedUntil!).getTime();
    const tEnd = Date.now();
    const minExpected = tStart + 4 * HOUR_MS - 5_000;
    const maxExpected = tEnd + 4 * HOUR_MS + 5_000;
    expect(snoozedUntilMs).toBeGreaterThanOrEqual(minExpected);
    expect(snoozedUntilMs).toBeLessThanOrEqual(maxExpected);

    // ---- Assert: the unread bell row disappears from the widget.
    // The component's onSuccess marks the notification read (which
    // removes it from `unreadNotifications` in the widget) and
    // invalidates the /api/notifications cache, so the row should
    // unmount.
    await expect(alertItem).toHaveCount(0, { timeout: 10_000 });

    // ---- Assert: the underlying feed reflects the same state. The
    // notification must either be absent (if a different filter
    // applies) or, more typically, present-but-isRead=true so it no
    // longer surfaces in any unread UI.
    const feed = await fetchNotifications(page);
    const stillUnread = feed.find(
      (n) => n.id === notificationId && n.isRead === false,
    );
    expect(stillUnread, "snoozed notification should not remain unread").toBeUndefined();

    // ---- Assert: a subsequent engine evaluation does NOT re-page
    // for `pool_health`. The engine reads the same dedupe key via
    // `fetchActiveSnoozeLookup` and suppresses any matching alert
    // until `snoozedUntil`, so even if a real pool_health rule were
    // tripping in the dev DB the snooze must keep it silent.
    const runRes = await page.request.post(
      `${BASE_URL}/api/admin/metrics/jobs/alerts/run`,
    );
    expect(runRes.status()).toBe(200);
    const runBody = (await runRes.json()) as EvaluateResult;
    const repagedPoolHealth = runBody.alertsFired.some(
      (a) => a.job === "pool_health",
    );
    expect(
      repagedPoolHealth,
      "pool_health must stay snoozed across an engine eval",
    ).toBe(false);
  });
});
