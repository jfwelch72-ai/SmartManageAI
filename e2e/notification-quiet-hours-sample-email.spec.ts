/**
 * Task #781 — End-to-end coverage for the quiet-hours digest
 * "Send me a sample" flow when EMAIL_TRANSPORT=noop is set.
 *
 * Drives the Notification Preferences UI through the full send-sample
 * path, asserts the success toast, and then verifies via the dev-only
 * /api/dev/email-outbox debug endpoint that the noop transport captured
 * exactly one email with the expected subject and recipient.
 *
 * The Playwright webServer launches `npm run dev` with
 * EMAIL_TRANSPORT=noop and ENABLE_DEV_SEED=true, so no real mail is
 * delivered and the debug endpoint is mounted.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DevLoginResponse {
  user: { id: string; role: string; email: string };
}

interface CapturedEmail {
  to: string[];
  from: string;
  subject: string;
  html?: string;
  text?: string;
  capturedAt: string;
}

async function devSuperAdminLogin(page: Page): Promise<DevLoginResponse> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "SUPER_ADMIN", linkOrg: true },
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as DevLoginResponse;
}

async function clearOutbox(page: Page) {
  const res = await page.request.delete(`${BASE_URL}/api/dev/email-outbox`);
  expect(
    [204, 409],
    `clearing outbox should succeed when EMAIL_TRANSPORT=noop (got ${res.status()})`,
  ).toContain(res.status());
  // 409 means EMAIL_TRANSPORT is not set to "noop", which would invalidate
  // the entire spec — fail loudly so the cause is obvious.
  expect(res.status()).toBe(204);
}

async function readOutbox(page: Page): Promise<CapturedEmail[]> {
  const res = await page.request.get(`${BASE_URL}/api/dev/email-outbox`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { outbox: CapturedEmail[] };
  return body.outbox;
}

async function enableQuietHours(page: Page) {
  const res = await page.request.patch(`${BASE_URL}/api/auth/profile`, {
    data: {
      jobMetricAlertQuietHoursEnabled: true,
      jobMetricAlertQuietHoursStart: "22:00",
      jobMetricAlertQuietHoursEnd: "07:00",
      jobMetricAlertQuietHoursTimezone: "UTC",
      jobMetricAlertQuietHoursWeekdays: null,
      jobMetricAlertQuietHoursDigestEnabled: true,
    },
  });
  expect([200, 204]).toContain(res.status());
}

test.describe("Quiet-hours digest 'Send me a sample' (Task #781)", () => {
  let loggedInEmail = "";

  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    const login = await devSuperAdminLogin(page);
    loggedInEmail = login.user.email;
    await enableQuietHours(page);
    await clearOutbox(page);
  });

  test("clicking 'Send me a sample' captures one email in the noop outbox", async ({ page }) => {
    await page.goto(`${BASE_URL}/settings/notifications`);
    await expect(page.getByTestId("text-section-title-notifications")).toBeVisible();

    // Preview row only renders when quietEnabled && quietDigestEnabled.
    const sendButton = page.getByTestId("button-send-sample-quiet-hours-digest");
    await expect(sendButton).toBeVisible();
    await sendButton.scrollIntoViewIfNeeded();

    // Sanity: outbox starts empty for this test.
    expect(await readOutbox(page)).toHaveLength(0);

    await sendButton.click();

    // Success toast surfaces with the recipient address baked in.
    const toastTitle = page
      .locator('[data-component-name="ToastTitle"]')
      .getByText("Sample digest sent");
    await expect(toastTitle).toBeVisible();

    // Poll the debug endpoint briefly — the toast fires from the same
    // mutation that persists the outbox entry, but allow a tiny window
    // for the response handler to run.
    let outbox: CapturedEmail[] = [];
    await expect
      .poll(
        async () => {
          outbox = await readOutbox(page);
          return outbox.length;
        },
        { timeout: 5_000, message: "expected exactly one captured email in noop outbox" },
      )
      .toBe(1);

    const [email] = outbox;
    expect(email.to).toHaveLength(1);
    // Recipient should match the logged-in dev SUPER_ADMIN's email
    // (captured from the test-login response so we don't hard-code seed
    // values that might evolve).
    expect(email.to[0].toLowerCase()).toBe(loggedInEmail.toLowerCase());

    // Subject must match the documented preview contract from
    // buildQuietHoursDigestPreview() in server/utils/jobMetricAlerts.ts
    // which always prefixes the digest subject with "[Preview] ".
    expect(email.subject.startsWith("[Preview] ")).toBe(true);
    expect(email.subject.length).toBeGreaterThan("[Preview] ".length);
    expect(email.from).toBeTruthy();
    expect(email.html ?? email.text ?? "").not.toBe("");

    // Task #786 — Verify the rendered HTML body carries the structural
    // hooks we rely on for dark-mode + mobile rendering. The digest
    // builder always wraps content in a role="article" container,
    // emits a <style> block containing our prefers-color-scheme rules,
    // exposes the alert collection as an aria-labelled list, and ships
    // a CTA button with the .qh-button class.
    const html = email.html ?? "";
    expect(html).toMatch(/role="article"/);
    expect(html).toMatch(/aria-roledescription="email"/);
    expect(html).toMatch(/<style>[\s\S]*\.qh-root[\s\S]*<\/style>/);
    expect(html).toMatch(/prefers-color-scheme:\s*dark/);
    expect(html).toMatch(/max-width:\s*600px/);
    expect(html).toMatch(/<ul[^>]*class="qh-card"[^>]*role="list"/);
    expect(html).toMatch(/class="qh-button"/);
  });
});
