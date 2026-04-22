import { test, expect, type Page } from "@playwright/test";
import { installCsrf } from "./helpers/csrf";

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

interface ProjectResponse {
  id: string;
  code: string;
  name: string;
}

interface ProjectTemplateRow {
  id: string;
  name: string;
  currentVersion: number;
  isSystemSeed: boolean;
}

interface TemplateVersionRow {
  id: string;
  templateId: string;
  version: number;
  notes: string | null;
  createdAt: string;
  snapshot: Record<string, unknown> & {
    tasks: Array<{ refId: string; name: string }>;
    documentFolders: Array<{ name: string }>;
    defaults?: Record<string, unknown>;
    costCodes?: unknown[];
    rfiCategories?: string[];
    submittalCategories?: string[];
    customFieldDefaults?: Record<string, unknown>;
  };
}

interface TemplateDetailResponse {
  template: ProjectTemplateRow;
  versions: TemplateVersionRow[];
}

interface CaptureResponse {
  template: ProjectTemplateRow;
}

async function devLogin(page: Page, role: string) {
  const response = await page.request.post(`${BASE_URL}/api/dev/test-login`, {
    data: { role },
  });
  expect(response.status()).toBe(200);
}

async function createSourceProject(page: Page, suffix: number): Promise<ProjectResponse> {
  const res = await page.request.post(`${BASE_URL}/api/projects`, {
    data: {
      name: `PW Tpl Editor Source ${suffix}`,
      clientName: "PW Tpl Client",
      description: "Source project for template editor regression test",
      contractAmount: "100000",
      status: "PLANNING",
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ProjectResponse;
}

async function captureTemplateFromProject(
  page: Page,
  projectCode: string,
  templateName: string,
): Promise<ProjectTemplateRow> {
  const res = await page.request.post(`${BASE_URL}/api/project-templates/capture`, {
    data: {
      projectCode,
      name: templateName,
      description: "Seeded for editor regression test",
      category: "regression",
    },
  });
  expect(res.status(), `capture template (${await res.text().catch(() => "")})`).toBe(201);
  const body = (await res.json()) as CaptureResponse;
  expect(body.template.isSystemSeed).toBe(false);
  expect(body.template.currentVersion).toBe(1);
  return body.template;
}

async function fetchTemplateDetail(page: Page, id: string): Promise<TemplateDetailResponse> {
  const res = await page.request.get(`${BASE_URL}/api/project-templates/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as TemplateDetailResponse;
}

// ffmpeg isn't always installed in this environment; disable video capture so
// the test still runs (traces/screenshots remain enabled by the global config).
test.use({ video: "off" });

test.describe("Template content editor", () => {
  test.beforeEach(async ({ page }) => {
    await installCsrf(page);
    await devLogin(page, "ADMIN");
  });

  test("editing a non-system template via the dialog saves a new version and bumps currentVersion", async ({
    page,
  }) => {
    const suffix = Date.now();
    const project = await createSourceProject(page, suffix);
    const templateName = `PW Tpl Editor ${suffix}`;
    const template = await captureTemplateFromProject(page, project.code, templateName);

    // Navigate to the templates page and open the content editor for our seeded template.
    await page.goto(`${BASE_URL}/templates/projects`);
    await expect(page.getByTestId("page-project-templates")).toBeVisible();
    const card = page.getByTestId(`card-template-${template.id}`);
    await expect(card).toBeVisible();
    await card.getByTestId(`button-edit-content-${template.id}`).click();

    const dialog = page.getByTestId("dialog-edit-template-content");
    await expect(dialog).toBeVisible();

    // The editor loads the latest snapshot. Wait for the loading state to clear
    // (or the empty state to appear) before interacting.
    await expect(page.getByTestId("text-editor-loading")).toBeHidden();

    // Add a brand new task and a brand new folder.
    await dialog.getByTestId("tab-tasks").click();
    await dialog.getByTestId("button-add-task").click();
    const newTaskName = `PW Editor Task ${suffix}`;
    // The first task added when starting from an empty snapshot has index 0.
    const taskInput = dialog.getByTestId("input-task-name-0");
    await expect(taskInput).toBeVisible();
    await taskInput.fill(newTaskName);

    await dialog.getByTestId("tab-folders").click();
    await dialog.getByTestId("button-add-folder").click();
    const newFolderName = `PW Editor Folder ${suffix}`;
    const folderInput = dialog.getByTestId("input-folder-0");
    await expect(folderInput).toBeVisible();
    await folderInput.fill(newFolderName);

    const versionNotes = `regression test ${suffix}`;
    await dialog.getByTestId("input-version-notes").fill(versionNotes);

    // Save and wait for the dialog to close + the success toast.
    await dialog.getByTestId("button-editor-save").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Verify via the API that a new version was created and currentVersion bumped.
    const detail = await fetchTemplateDetail(page, template.id);
    expect(detail.template.currentVersion).toBe(2);
    expect(detail.versions.length).toBeGreaterThanOrEqual(2);

    const sortedVersions = [...detail.versions].sort((a, b) => b.version - a.version);
    const latest = sortedVersions[0];
    const previous = sortedVersions[1];
    expect(latest.version).toBe(2);
    expect(previous.version).toBe(1);
    expect(latest.notes).toBe(versionNotes);

    const taskNames = latest.snapshot.tasks.map((t) => t.name);
    expect(taskNames).toContain(newTaskName);

    const folderNames = latest.snapshot.documentFolders.map((f) => f.name);
    expect(folderNames).toContain(newFolderName);

    // Snapshot transformation must preserve the non-editable parts of the base
    // snapshot (defaults, costCodes, rfiCategories, submittalCategories,
    // customFieldDefaults, distributionLists). The editor only rewrites
    // tasks/dependencies/documentFolders/scheduleOfValues + capturedAt.
    const preservedKeys = [
      "defaults",
      "costCodes",
      "rfiCategories",
      "submittalCategories",
      "customFieldDefaults",
      "distributionLists",
      "schemaVersion",
      "source",
    ] as const;
    for (const key of preservedKeys) {
      expect(latest.snapshot[key as keyof typeof latest.snapshot]).toEqual(
        previous.snapshot[key as keyof typeof previous.snapshot],
      );
    }
  });

  test("save button stays disabled when all tasks have been removed", async ({ page }) => {
    const suffix = Date.now() + 1;
    const project = await createSourceProject(page, suffix);
    const template = await captureTemplateFromProject(
      page,
      project.code,
      `PW Tpl Editor Disable ${suffix}`,
    );

    await page.goto(`${BASE_URL}/templates/projects`);
    await expect(page.getByTestId("page-project-templates")).toBeVisible();
    await page
      .getByTestId(`card-template-${template.id}`)
      .getByTestId(`button-edit-content-${template.id}`)
      .click();

    const dialog = page.getByTestId("dialog-edit-template-content");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("text-editor-loading")).toBeHidden();

    // The save button must be disabled while there are zero tasks.
    const saveBtn = dialog.getByTestId("button-editor-save");
    await expect(saveBtn).toBeDisabled();

    // Adding a task enables it; removing it disables it again.
    await dialog.getByTestId("tab-tasks").click();
    await dialog.getByTestId("button-add-task").click();
    await expect(saveBtn).toBeEnabled();
    await dialog.getByTestId("button-remove-task-0").click();
    await expect(saveBtn).toBeDisabled();

    // Cancel out without saving — currentVersion must stay at 1.
    await dialog.getByTestId("button-editor-cancel").click();
    await expect(dialog).toBeHidden();

    const detail = await fetchTemplateDetail(page, template.id);
    expect(detail.template.currentVersion).toBe(1);
    expect(detail.versions.length).toBe(1);
  });
});
