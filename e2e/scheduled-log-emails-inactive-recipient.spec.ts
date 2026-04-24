/**
 * Task #1673 — visual coverage for the deactivated-recipient badge
 * on the Scheduled log emails card.
 *
 * Task #1655 added inline "(inactive)" badges, strikethrough name
 * styling, a HoverCard explainer and an "all-inactive → empty-state
 * copy" branch to the "Failure alerts go to:" line. Server tests
 * cover the API decoration but no end-to-end test exercises the
 * actual rendering, so a future refactor of the card could quietly
 * drop the badge or the empty-state branch without any signal.
 *
 * These specs:
 *   1. Seed a project where the project manager is deactivated and
 *      the schedule's last editor (the test ADMIN) is active. The
 *      card should render the inactive badge for the PM, surface
 *      the explainer in the HoverCard, and NOT collapse to the
 *      empty-state copy.
 *   2. Seed a project where every resolved recipient is inactive
 *      (PM is the only candidate and they are deactivated). The
 *      card should render the shared `failure-recipients-empty-{logType}`
 *      branch with the "Nobody — set a project manager…" copy.
 */
import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
}

interface UserResponse {
  id: string;
  email: string;
  isActive: boolean;
}

let userCounter = 0;
function uniqueSuffix(): string {
  userCounter += 1;
  return `${Date.now()}-${userCounter}-${Math.floor(Math.random() * 1_000_000)}`;
}

async function devAdminLogin(page: Page): Promise<void> {
  const res = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role: "ADMIN" },
  });
  expect(res.status(), `dev test-login failed: ${await res.text()}`).toBe(200);
}

async function createInactiveUser(
  page: Page,
  opts: { firstName: string; lastName: string },
): Promise<UserResponse> {
  // POST /api/users requires ADMIN and returns the newly-created user
  // (auto-assigned to the requesting admin's organization). We then
  // flip isActive=false via PATCH so the GET log-email-schedules
  // recipient resolver decorates them as inactive.
  const suffix = uniqueSuffix();
  const createRes = await page.request.post(`${BASE_URL}/api/users`, {
    data: {
      firstName: opts.firstName,
      lastName: opts.lastName,
      email: `inactive-recipient-${suffix}@dev.test`,
      role: "MANAGER",
      // Meets server passwordSchema (length, upper, lower, digit, special).
      password: "TestPassw0rd!",
    },
  });
  expect(createRes.status(), `create user failed: ${await createRes.text()}`).toBe(201);
  const user = (await createRes.json()) as UserResponse;

  const patchRes = await page.request.patch(`${BASE_URL}/api/users/${user.id}`, {
    data: { isActive: false },
  });
  expect(patchRes.status(), `deactivate user failed: ${await patchRes.text()}`).toBe(200);
  return user;
}

async function createProjectWithPm(
  page: Page,
  opts: { name: string; projectManagerId: string },
): Promise<ProjectResponse> {
  const createRes = await page.request.post(`${BASE_URL}/api/projects`, {
    data: { name: opts.name, clientName: "Inactive Recipient E2E" },
  });
  expect(createRes.status(), `create project failed: ${await createRes.text()}`).toBe(201);
  const project = (await createRes.json()) as ProjectResponse;

  const pmRes = await page.request.patch(`${BASE_URL}/api/projects/${project.code}`, {
    data: { projectManagerId: opts.projectManagerId },
  });
  expect(pmRes.status(), `assign PM failed: ${await pmRes.text()}`).toBe(200);
  return project;
}

async function upsertRfiSchedule(page: Page, projectId: string): Promise<void> {
  // PUT stamps lastEditedById to the caller (the active test ADMIN),
  // giving the recipients list a second, ACTIVE name so the row is
  // mixed active+inactive rather than fully inactive.
  const res = await page.request.put(
    `${BASE_URL}/api/projects/${projectId}/log-email-schedules/RFI`,
    { data: { cadence: "OFF", weekday: 1, hour: 8, timezone: "UTC" } },
  );
  // Returns 201 when the row is freshly inserted, 200 on update — we
  // only care that the upsert succeeded.
  expect(
    [200, 201],
    `upsert schedule failed: ${await res.text()}`,
  ).toContain(res.status());
}

test.describe("Scheduled log emails — deactivated recipient badge (#1673)", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devAdminLogin(page);
  });

  test("renders inactive badge + explainer when one recipient is deactivated", async ({ page }) => {
    const inactivePm = await createInactiveUser(page, {
      firstName: "Pat",
      lastName: "Inactivopm",
    });
    const project = await createProjectWithPm(page, {
      name: `LogEmail Mixed ${uniqueSuffix()}`,
      projectManagerId: inactivePm.id,
    });
    // Active editor (the ADMIN running this test) becomes the second
    // recipient via the schedule's lastEditedById, so the row is
    // mixed and the empty-state branch must NOT trigger.
    await upsertRfiSchedule(page, project.id);

    await page.goto(`${BASE_URL}/projects/${project.code}`);

    // Project detail is lazy-loaded and the overview tab fans out
    // several queries; allow extra time for the card to mount before
    // asserting badge content.
    const card = page.getByTestId("card-scheduled-log-emails");
    await expect(card).toBeVisible({ timeout: 30_000 });

    const recipientsRow = page.getByTestId("failure-recipients-rfi");
    await expect(recipientsRow).toBeVisible();
    await expect(recipientsRow).toContainText("Failure alerts go to:");

    const inactiveBadge = page.getByTestId(
      `failure-recipient-inactive-badge-rfi-${inactivePm.id}`,
    );
    await expect(inactiveBadge).toBeVisible();
    await expect(inactiveBadge).toHaveText(/inactive/i);

    // Strikethrough class is applied to the underlying button so the
    // name visually reads as "no longer reachable".
    const inactiveName = page.getByTestId(
      `failure-recipient-name-rfi-${inactivePm.id}`,
    );
    await expect(inactiveName).toHaveClass(/line-through/);

    // The HoverCard explainer mounts on hover. Open it and confirm
    // the deactivation copy is rendered into the popover.
    await inactiveName.hover();
    const explainer = page.getByTestId(
      `failure-recipient-inactive-explainer-rfi-${inactivePm.id}`,
    );
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText(/deactivated/i);

    // Mixed recipient set: empty-state copy must NOT render.
    await expect(page.getByTestId("failure-recipients-empty-rfi")).toHaveCount(0);
  });

  test("renders empty-state copy when every recipient is inactive", async ({ page }) => {
    const inactivePm = await createInactiveUser(page, {
      firstName: "Sam",
      lastName: "Allinactive",
    });
    const project = await createProjectWithPm(page, {
      name: `LogEmail AllInactive ${uniqueSuffix()}`,
      projectManagerId: inactivePm.id,
    });
    // Intentionally do NOT write a schedule row: that keeps
    // lastEditedById null so the only resolved recipient is the
    // inactive PM, which exercises the all-inactive → empty-state
    // branch added in Task #1655.

    await page.goto(`${BASE_URL}/projects/${project.code}`);

    const card = page.getByTestId("card-scheduled-log-emails");
    await expect(card).toBeVisible({ timeout: 30_000 });

    // Both log types default to OFF on a project with no schedule
    // rows. Assert the empty-state copy renders for both — RFI is
    // the primary scenario but Submittal exercises the same code
    // path and protects against a future refactor that special-
    // cases one log type.
    for (const logType of ["rfi", "submittal"] as const) {
      const empty = page.getByTestId(`failure-recipients-empty-${logType}`);
      await expect(empty).toBeVisible();
      await expect(empty).toContainText(
        /Nobody — set a project manager or update the cadence to record an editor\./,
      );
    }

    // No active recipient name → no badge for the inactive PM is
    // rendered (the entire recipient list collapses into the
    // empty-state branch).
    await expect(
      page.getByTestId(`failure-recipient-inactive-badge-rfi-${inactivePm.id}`),
    ).toHaveCount(0);
  });
});
