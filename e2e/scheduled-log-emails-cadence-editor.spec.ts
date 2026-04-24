/**
 * Task #1694 — visual coverage for the cadence editor on the
 * Scheduled log emails card.
 *
 * Task #1673 added e2e coverage for the deactivated-recipient badge
 * but the rest of the card's interactive surface (the cadence
 * dropdown, the Save button gate, the "Send test now" pipeline
 * trigger, and the persisted "Currently:" status) still had no
 * Playwright coverage. Server tests and the React-Testing-Library
 * suite at `client/src/components/project-tabs/__tests__/
 * ScheduledLogEmailsCard.test.tsx` cover the wiring in isolation,
 * but a future refactor of the card could quietly break the live
 * UX without any signal.
 *
 * This spec:
 *   1. Seeds a project as the dev ADMIN.
 *   2. Opens the Scheduled log emails card on the project detail
 *      page and confirms the RFI row defaults to "Currently: Off".
 *   3. Switches the RFI cadence dropdown from OFF to WEEKLY, clicks
 *      Save, and asserts the success toast.
 *   4. Reloads the page and asserts the persisted "Currently:
 *      Weekly" status copy (proves the PUT round-tripped through
 *      the server).
 *   5. Clicks "Send test now" with `EMAIL_TRANSPORT=noop` (set in
 *      `playwright.config.ts`) and asserts the success toast
 *      renders without a destructive variant.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
}

let projectCounter = 0;
function uniqueSuffix(): string {
  projectCounter += 1;
  return `${Date.now()}-${projectCounter}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function devAdminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status(), `dev test-login failed: ${await res.text()}`).toBe(200);
}

async function createProject(page: Page, name: string): Promise<ProjectResponse> {
  const res = await page.request.post(`${BASE_URL}/api/projects`, {
    data: { name, clientName: "Cadence Editor E2E" },
  });
  expect(res.status(), `create project failed: ${await res.text()}`).toBe(201);
  return (await res.json()) as ProjectResponse;
}

async function seedDistributionList(page: Page, projectId: string): Promise<void> {
  // The /test endpoint resolves recipients from the project's email
  // distribution lists (project-scoped + org-scoped fallback) and
  // 400s if the resolved set is empty. Seed a project-scoped list
  // with a single dev address so the test send actually exercises
  // the PDF render + transport pipeline (under EMAIL_TRANSPORT=noop).
  const res = await page.request.post(
    `${BASE_URL}/api/projects/${projectId}/distribution-lists`,
    {
      data: {
        name: `Cadence Editor Test List ${uniqueSuffix()}`,
        scope: "PROJECT",
        contactEmails: ["cadence-editor-e2e@dev.test"],
        extraEmails: [],
      },
    },
  );
  expect(
    res.status(),
    `seed distribution list failed: ${await res.text()}`,
  ).toBe(200);
}

test.describe("Scheduled log emails — cadence editor (#1694)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
  });

  test("changes RFI cadence to WEEKLY, persists across reload, and sends a test email", async ({
    page,
  }) => {
    const project = await createProject(page, `Cadence Editor ${uniqueSuffix()}`);
    await seedDistributionList(page, project.id);

    await page.goto(`${BASE_URL}/projects/${project.code}`);

    // Project detail is lazy-loaded and the overview tab fans out
    // several queries; allow extra time for the card to mount.
    const card = page.getByTestId("card-scheduled-log-emails");
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Defaults: a freshly-seeded project has no schedule rows so the
    // RFI row falls back to OFF and the Save button is disabled
    // because the form is not dirty.
    const status = page.getByTestId("text-log-email-status-rfi");
    await expect(status).toHaveText("Currently: Off");

    const saveButton = page.getByTestId("button-save-log-email-schedule-rfi");
    await expect(saveButton).toBeDisabled();

    // Open the cadence dropdown and pick WEEKLY. Radix renders the
    // SelectContent into a portal, so click the trigger first then
    // the option by its testid.
    const cadenceTrigger = page.getByTestId("select-log-email-cadence-rfi");
    await cadenceTrigger.click();
    await page.getByTestId("option-log-email-cadence-rfi-weekly").click();

    // Switching cadence dirties the form → Save unlocks. Weekday /
    // hour / timezone selects also appear but they default to Monday
    // / 08:00 / UTC which is enough to satisfy the PUT validator.
    await expect(saveButton).toBeEnabled();
    await expect(page.getByTestId("select-log-email-weekday-rfi")).toBeVisible();
    await expect(page.getByTestId("select-log-email-hour-rfi")).toBeVisible();
    await expect(page.getByTestId("select-log-email-timezone-rfi")).toBeVisible();

    await saveButton.click();

    // Success toast from the save mutation. The card uses the
    // `${LOG_TYPE_LABELS[logType]} schedule saved` copy so we
    // match a stable substring instead of the full string.
    await expect(
      page.getByText(/RFI Log schedule saved/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Once the invalidation round-trips, the form's "initial" state
    // updates and Save returns to its disabled baseline.
    await expect(saveButton).toBeDisabled({ timeout: 10_000 });

    // Reload to prove the new cadence was persisted server-side
    // (rather than just stashed in the local form state).
    await page.reload();
    await expect(page.getByTestId("card-scheduled-log-emails")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("text-log-email-status-rfi")).toHaveText(
      "Currently: Weekly",
    );

    // Click "Send test now". With EMAIL_TRANSPORT=noop (set in
    // playwright.config.ts) the pipeline still runs end-to-end —
    // PDF render, recipient resolution, transport send — so the
    // success toast is the strongest signal that the wiring is
    // intact. Use the persisted Save button (still disabled because
    // the form is not dirty after reload) as a sanity guard so we
    // know we're clicking the post-reload row.
    await expect(
      page.getByTestId("button-save-log-email-schedule-rfi"),
    ).toBeDisabled();

    const testButton = page.getByTestId("button-test-log-email-schedule-rfi");
    await expect(testButton).toBeEnabled();
    await testButton.click();

    // The success toast title is `Test rfi log email sent`
    // (LOG_TYPE_LABELS["RFI"].toLowerCase() === "rfi log").
    await expect(
      page.getByText(/Test rfi log email sent/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Negative assertion: the destructive "Failed to send test
    // email" toast must NOT have rendered.
    await expect(page.getByText(/Failed to send test email/i)).toHaveCount(0);
  });
});
