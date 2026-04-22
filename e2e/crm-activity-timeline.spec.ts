/**
 * Task #907 — End-to-end coverage for the unified CRM activity timeline.
 *
 * Logs a call through the in-app "Log call" dialog from the deal detail page
 * and verifies that the new entry appears at the top of the timeline grouped
 * under today's date — exercising both the POST /api/crm/calls write path and
 * the GET /api/crm/activity merged read path that the UI listens to via
 * react-query cache invalidation.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface DevUser {
  user: { id: string; organizationId: string | null };
}

async function devLogin(page: Page, role: string) {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(res.status()).toBe(200);
}

function localIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function acceptableTodayIsos(): string[] {
  // The browser groups by *its* local date and the test host's local date may
  // differ by ±1 day if the run straddles midnight UTC vs local TZ. Accept any
  // of {yesterday, today, tomorrow} so the assertion is timezone-robust.
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return [now - day, now, now + day].map((t) => localIso(new Date(t)));
}

test.describe("CRM activity timeline — log-call e2e", () => {
  test("logging a call from the deal page surfaces it under today's group", async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");

    const meRes = await page.request.get(`${BASE_URL}/api/auth/me`);
    expect(meRes.status()).toBe(200);
    const me = (await meRes.json()) as DevUser;
    expect(me.user.organizationId).toBeTruthy();

    const suffix = Date.now();

    // Create a fresh CRM organisation so we don't pollute any existing deal.
    const orgRes = await page.request.post(`${BASE_URL}/api/crm/organisations`, {
      data: {
        name: `Timeline E2E Co ${suffix}`,
        type: "CONTRACTOR",
      },
    });
    expect(orgRes.status()).toBeLessThan(300);
    const crmOrg = (await orgRes.json()) as { id: string };

    // Create the opportunity we'll open in the UI.
    const oppRes = await page.request.post(`${BASE_URL}/api/crm/opportunities`, {
      data: {
        name: `Timeline E2E Deal ${suffix}`,
        stage: "QUALIFIED",
        crmOrganisationId: crmOrg.id,
      },
    });
    expect(oppRes.status()).toBeLessThan(300);
    const opp = (await oppRes.json()) as { id: string };

    // Open the deal detail page and wait for the timeline to mount.
    await page.goto(`${BASE_URL}/crm/deals/${opp.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("heading-deal-name")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("view-activity-timeline")).toBeVisible({ timeout: 30_000 });

    // Open the Log Call dialog.
    await page.getByTestId("button-log-call").click();
    await expect(page.getByTestId("dialog-log-call")).toBeVisible();

    // Fill the form. Direction & outcome already default to OUTBOUND/CONNECTED.
    const noteText = `e2e-call-${suffix}`;
    await page.getByTestId("input-call-to-number").fill("+15551239999");
    await page.getByTestId("input-call-duration").fill("3");
    await page.getByTestId("input-call-notes").fill(noteText);

    // Submit and wait for the dialog to close (mutation success path).
    await page.getByTestId("button-save-call").click();
    await expect(page.getByTestId("dialog-log-call")).toBeHidden({ timeout: 15_000 });

    // Pull the merged feed from the server to get the authoritative new call ID
    // and confirm it's the newest item — independent of the UI render.
    const feedRes = await page.request.get(
      `${BASE_URL}/api/crm/activity?opportunityId=${opp.id}&limit=10`,
    );
    expect(feedRes.status()).toBe(200);
    const feed = (await feedRes.json()) as Array<{ id: string; type: string }>;
    expect(feed.length).toBeGreaterThan(0);
    expect(feed[0].type).toBe("CALL");
    const newCallId = feed[0].id.replace(/^call:/, "");

    // The new call must be the very first row of the timeline (top overall),
    // not just first within its day group.
    const timeline = page.getByTestId("view-activity-timeline");
    const allItems = timeline.locator('[data-testid^="timeline-item-"]');
    await expect(allItems.first()).toHaveAttribute(
      "data-testid",
      `timeline-item-call:${newCallId}`,
      { timeout: 15_000 },
    );

    // It must live under a group-day-* block whose date matches today (±1 day
    // for timezone tolerance between the test host and the browser).
    const newCall = page.getByTestId(`timeline-item-call:${newCallId}`);
    const groupTestId = await newCall
      .locator('xpath=ancestor::*[starts-with(@data-testid, "group-day-")][1]')
      .getAttribute("data-testid");
    expect(groupTestId).toMatch(/^group-day-\d{4}-\d{2}-\d{2}$/);
    const groupIso = groupTestId!.replace("group-day-", "");
    expect(acceptableTodayIsos()).toContain(groupIso);

    // Notes typed in the dialog must render as the call's description.
    await expect(page.getByTestId(`text-desc-call:${newCallId}`)).toContainText(noteText);
  });
});
