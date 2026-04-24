/**
 * Task #1846 — nightly hard-delete sweep for soft-deleted
 * `plan_document_markups` rows whose `deleted_at` is older than the
 * configured retention window (default 30 days).
 *
 * Verifies:
 *   - Rows whose `deleted_at` crosses the 30-day window are hard-deleted
 *     when the job runs (the "31 days ago" seeded row goes away).
 *   - Live rows (`deleted_at IS NULL`) and recently-trashed rows
 *     (`deleted_at` inside the window) are LEFT IN PLACE — the sweep
 *     must never touch the undo window.
 *   - The default retention window is 30 days when the env var is
 *     unset, configurable via PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS.
 *   - A non-numeric override falls back to the default (operator typo
 *     can't accidentally pause or extend the sweep).
 *   - A non-positive (<= 0) override disables the sweep entirely.
 *   - The job emits a `recordJobMetrics` sample carrying the rows
 *     purged + duration so the operations dashboard surfaces every
 *     nightly tick.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql, eq, inArray } from "drizzle-orm";
import bcrypt from "bcrypt";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
  planDocumentMarkups,
} from "@shared/schema";
import {
  purgePlanDocumentMarkupTrash,
  getPlanDocumentMarkupTrashRetentionDays,
  PLAN_DOCUMENT_MARKUP_TRASH_DEFAULT_RETENTION_DAYS,
  PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB,
} from "../jobs/planDocumentMarkupSoftDeletePurge";
import { getJobMetrics } from "../utils/jobMetrics";

const TEST_PREFIX = "__plandoc_trash_purge__";
const ORIGINAL_RETENTION = process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS;

interface Tenant {
  orgId: string;
  userId: string;
  projectId: string;
  docId: string;
}

let tenant: Tenant;

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD Trash Purge ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();

  const [admin] = await db.insert(users).values({
    email: `${slug}@test.local`,
    passwordHash,
    firstName: "PD",
    lastName: label,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();

  const [project] = await db.insert(projects).values({
    code: `${slug}-PRJ`,
    name: `PD Trash Purge Project ${label}`,
    clientName: `PD Trash Purge Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc ${label}`,
    fileName: `trash-purge-${label}.pdf`,
    fileUrl: `https://example.com/trash-purge-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  return {
    orgId: org.id,
    userId: admin.id,
    projectId: project.id,
    docId: doc.id,
  };
}

async function cleanup(): Promise<void> {
  const orgs = await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = (orgs as { rows: Array<{ id: string }> }).rows;
  for (const { id: orgId } of rows) {
    const projSub = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const docSub = sql`(SELECT id FROM plan_documents WHERE project_id IN ${projSub})`;
    await db.execute(sql`DELETE FROM plan_document_markups WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN ${projSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
}

beforeAll(async () => {
  tenant = await setupTenant("primary");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (ORIGINAL_RETENTION === undefined) {
    delete process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS;
  } else {
    process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS = ORIGINAL_RETENTION;
  }
}, 30_000);

beforeEach(async () => {
  delete process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS;
  // Wipe markup rows between cases so each test starts from a known state.
  await db
    .delete(planDocumentMarkups)
    .where(eq(planDocumentMarkups.planDocumentId, tenant.docId));
});

interface SeedSpec {
  deletedAt: Date | null;
  pageNumber?: number;
}

async function seedMarkups(specs: SeedSpec[]): Promise<string[]> {
  const inserted = await db.insert(planDocumentMarkups).values(
    specs.map((s, idx) => ({
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      planDocumentId: tenant.docId,
      pageNumber: s.pageNumber ?? 1,
      tool: "FREEHAND",
      points: JSON.stringify([{ x: 0.1 * (idx + 1), y: 0.2 * (idx + 1) }]),
      color: "#ff0000",
      thickness: 2,
      createdBy: tenant.userId,
      deletedAt: s.deletedAt,
    })),
  ).returning({ id: planDocumentMarkups.id });
  return inserted.map((r) => r.id);
}

async function existingIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: planDocumentMarkups.id })
    .from(planDocumentMarkups)
    .where(inArray(planDocumentMarkups.id, ids));
  return new Set(rows.map((r) => r.id));
}

describe("purgePlanDocumentMarkupTrash (Task #1846)", () => {
  it("defaults to a 30-day retention window when the env var is unset", () => {
    expect(getPlanDocumentMarkupTrashRetentionDays()).toBe(30);
    expect(PLAN_DOCUMENT_MARKUP_TRASH_DEFAULT_RETENTION_DAYS).toBe(30);
  });

  it("respects PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS override", () => {
    process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS = "7";
    expect(getPlanDocumentMarkupTrashRetentionDays()).toBe(7);
  });

  it("falls back to the default for non-numeric overrides", () => {
    process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS = "not-a-number";
    expect(getPlanDocumentMarkupTrashRetentionDays()).toBe(30);
  });

  it("hard-deletes rows whose deleted_at is 31 days ago and leaves live + recently-trashed rows intact", async () => {
    const now = new Date("2026-04-24T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;

    // Three personas: a live (never-trashed) row, a row trashed 5 days
    // ago (still inside the undo window), and a row trashed 31 days
    // ago (past the window — purge target).
    const [liveId, recentTrashId, expiredTrashId] = await seedMarkups([
      { deletedAt: null, pageNumber: 1 },
      { deletedAt: new Date(now.getTime() - 5 * day), pageNumber: 2 },
      { deletedAt: new Date(now.getTime() - 31 * day), pageNumber: 3 },
    ]);

    const result = await purgePlanDocumentMarkupTrash({ now });

    expect(result.deleted).toBe(1);
    expect(result.batches).toBe(1);
    expect(result.cappedAtMaxBatches).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const survivors = await existingIds([liveId, recentTrashId, expiredTrashId]);
    expect(survivors.has(liveId)).toBe(true);
    expect(survivors.has(recentTrashId)).toBe(true);
    expect(survivors.has(expiredTrashId)).toBe(false);
  });

  it("emits a recordJobMetrics sample carrying the rows purged + duration", async () => {
    const now = new Date("2026-04-24T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    await seedMarkups([
      { deletedAt: new Date(now.getTime() - 60 * day), pageNumber: 4 },
      { deletedAt: new Date(now.getTime() - 90 * day), pageNumber: 5 },
    ]);

    const before = getJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB).samples.length;
    const result = await purgePlanDocumentMarkupTrash({ now });
    expect(result.deleted).toBe(2);

    const after = getJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB);
    expect(after.samples.length).toBeGreaterThan(before);
    const latest = after.latest;
    expect(latest).not.toBeNull();
    expect(latest!.counters.deleted).toBe(2);
    expect(typeof latest!.counters.durationMs).toBe("number");
  });

  it("emits a baseline sample even on the no-op path so the dashboard sees every nightly tick", async () => {
    const now = new Date("2026-04-24T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    // Only a live row + a fresh-trash row — neither should be touched
    // and the sweep should report zero deletions but still emit a
    // metrics sample.
    await seedMarkups([
      { deletedAt: null },
      { deletedAt: new Date(now.getTime() - 1 * day) },
    ]);

    const before = getJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB).samples.length;
    const result = await purgePlanDocumentMarkupTrash({ now });
    expect(result.deleted).toBe(0);
    expect(result.batches).toBe(0);

    const after = getJobMetrics(PLAN_DOCUMENT_MARKUP_TRASH_PURGE_JOB);
    expect(after.samples.length).toBeGreaterThan(before);
    const latest = after.latest;
    expect(latest).not.toBeNull();
    expect(latest!.counters.deleted).toBe(0);
  });

  it("disables the sweep when retention is 0 or negative — no rows are touched even when 31-day-old trash exists", async () => {
    process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS = "0";
    const now = new Date("2026-04-24T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;
    const [shouldSurvive] = await seedMarkups([
      { deletedAt: new Date(now.getTime() - 31 * day) },
    ]);

    const result = await purgePlanDocumentMarkupTrash({ now });
    expect(result.deleted).toBe(0);
    expect(result.batches).toBe(0);

    const survivors = await existingIds([shouldSurvive]);
    expect(survivors.has(shouldSurvive)).toBe(true);
  });

  it("does NOT hard-delete a row that was restored (deleted_at cleared) between the SELECT and DELETE phases", async () => {
    // The purge does SELECT id WHERE deleted_at < cutoff, then
    // DELETE WHERE id IN (...). If a user races a POST /:id/restore in
    // that gap (clearing deleted_at), the DELETE must NOT hard-delete
    // the row out from under them. We simulate that race by spying on
    // db.select once: when the helper issues its SELECT we let it
    // resolve with the expired id list, then immediately clear
    // deleted_at on that same row before the DELETE fires.
    const now = new Date("2026-04-24T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;

    const [racedId, controlId] = await seedMarkups([
      { deletedAt: new Date(now.getTime() - 31 * day), pageNumber: 6 },
      { deletedAt: new Date(now.getTime() - 31 * day), pageNumber: 7 },
    ]);

    let raced = false;
    const result = await purgePlanDocumentMarkupTrash({
      now,
      afterSelectForTest: async (ids) => {
        if (raced) return;
        raced = true;
        // We seeded only these two rows; both should be in the
        // SELECT batch.
        expect(new Set(ids)).toEqual(new Set([racedId, controlId]));
        // Mid-flight restore on the targeted row — clears
        // deleted_at the way POST /:id/restore does. The DELETE
        // predicate must observe this and skip racedId.
        await db
          .update(planDocumentMarkups)
          .set({ deletedAt: null })
          .where(eq(planDocumentMarkups.id, racedId));
      },
    });

    expect(raced).toBe(true);
    // The control row must still be hard-deleted; the raced row
    // (now restored) must survive.
    expect(result.deleted).toBe(1);

    const survivors = await existingIds([racedId, controlId]);
    expect(survivors.has(racedId)).toBe(true);
    expect(survivors.has(controlId)).toBe(false);

    // And the restored row's deleted_at really is NULL — the restore
    // wasn't undone by the purge.
    const [restored] = await db
      .select({ deletedAt: planDocumentMarkups.deletedAt })
      .from(planDocumentMarkups)
      .where(eq(planDocumentMarkups.id, racedId));
    expect(restored.deletedAt).toBeNull();
  });

  it("respects a custom retention window — rows older than the override are purged, rows inside it survive", async () => {
    process.env.PLAN_DOCUMENT_MARKUP_TRASH_RETENTION_DAYS = "7";
    const now = new Date("2026-04-24T12:00:00.000Z");
    const day = 24 * 60 * 60 * 1000;

    // With a 7-day window: a row trashed 5 days ago survives; a row
    // trashed 8 days ago is purged.
    const [survivor, target] = await seedMarkups([
      { deletedAt: new Date(now.getTime() - 5 * day) },
      { deletedAt: new Date(now.getTime() - 8 * day) },
    ]);

    const result = await purgePlanDocumentMarkupTrash({ now });
    expect(result.deleted).toBe(1);

    const survivors = await existingIds([survivor, target]);
    expect(survivors.has(survivor)).toBe(true);
    expect(survivors.has(target)).toBe(false);
  });
});
