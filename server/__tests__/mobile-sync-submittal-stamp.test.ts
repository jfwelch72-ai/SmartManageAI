/**
 * Task #1599: integration tests for the SUBMITTAL_STAMP push branch of
 * `POST /api/ai-features/mobile/sync` in `server/mobileSyncRoutes.ts`.
 *
 * Locks two contracts:
 *   1. Only the *active* chain step (status === "IN_REVIEW") may be
 *      stamped from mobile. PENDING (future-step) reviews must be
 *      rejected with status "FAILED" — otherwise a downstream reviewer
 *      could short-circuit the chain before it reaches them.
 *   2. A successful IN_REVIEW stamp updates the review row, writes a
 *      submittal_activity audit row, and returns status "SAVED".
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  mobileDevices,
  submittals,
  submittalReviews,
  submittalActivity,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__sync_sub_stamp__";

interface ProcessedStamp {
  localId: string;
  status: "SAVED" | "FAILED" | "DUPLICATE" | "CONFLICT";
  serverUpdatedAt?: string;
  serverStatus?: string;
  reason?: string;
}

interface ConflictItem {
  entityType: string;
  entityId: string;
  localId?: string;
  serverUpdatedAt: string;
  reason?: string;
  serverStatus?: string;
}

interface SyncResponseBody {
  processed: { submittalStamps: ProcessedStamp[] };
  conflicts: ConflictItem[];
}

let app: Express;
let orgId: string;
let userId: string;
let projectId: string;
let submittalId: string;
let pendingReviewId: string;
let activeReviewId: string;
// Task #1607: a second IN_REVIEW row that office staff "resolves"
// out-of-band between the field reviewer's offline tap and the
// device's eventual sync. Used to drive the stale-review CONFLICT
// assertion without disturbing the existing PENDING/IN_REVIEW
// authorization tests.
let staleReviewId: string;
let deviceTextId: string;

async function buildApp(): Promise<Express> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const mobileSyncRoutes = (await import("../mobileSyncRoutes")).default;

  const a = express();
  a.use(express.json({ limit: "10mb" }));
  a.use(cookieParser());

  a.use((req: Request & { user?: { id: string; organizationId: string; role: string; firstName?: string; lastName?: string } }, _res: Response, next: NextFunction) => {
    const headerUserId = req.header("x-test-user-id");
    const headerOrgId = req.header("x-test-org-id");
    if (headerUserId && headerOrgId) {
      req.user = { id: headerUserId, organizationId: headerOrgId, role: "FIELD_WORKER", firstName: "Field", lastName: "Reviewer" };
    }
    next();
  });

  a.use(mobileSyncRoutes);
  return a;
}

beforeAll(async () => {
  app = await buildApp();

  const slug = `${TEST_PREFIX}${Date.now()}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Sub Stamp Org ${Date.now()}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning({ id: organizations.id });
  orgId = org.id;

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}-field@test.local`,
      passwordHash,
      firstName: "Field",
      lastName: "Reviewer",
      role: "FIELD_WORKER",
      organizationId: orgId,
      isActive: true,
    })
    .returning({ id: users.id });
  userId = user.id;

  const [proj] = await db
    .insert(projects)
    .values({
      name: `Sub Stamp Project`,
      code: `${TEST_PREFIX}P-${Date.now()}`,
      clientName: "Test Client",
      gcOrganizationId: orgId,
      status: "ACTIVE",
    })
    .returning({ id: projects.id });
  projectId = proj.id;

  deviceTextId = `device-${TEST_PREFIX}-${Date.now()}`;
  await db.insert(mobileDevices).values({
    organizationId: orgId,
    userId,
    deviceId: deviceTextId,
    platform: "IOS",
    syncToken: "test-sync-token",
  });

  const [sub] = await db
    .insert(submittals)
    .values({
      organizationId: orgId,
      projectId,
      submittalNumber: `SUB-${TEST_PREFIX}-${Date.now()}`,
      subject: "30-mil HDPE liner shop drawings",
      submittalType: "CONTRACTOR",
      phase: "CONSTRUCTION",
      status: "UNDER_REVIEW",
      submittedById: userId,
    })
    .returning({ id: submittals.id });
  submittalId = sub.id;

  // Step 1 (PENDING): the field reviewer is assigned but the chain has
  // not yet activated this step. Stamping must be rejected.
  const [pendingRev] = await db
    .insert(submittalReviews)
    .values({
      submittalId,
      organizationId: orgId,
      reviewerRole: "GC_MANAGER",
      reviewerId: userId,
      reviewerName: "Field Reviewer",
      sequenceOrder: 2,
      status: "PENDING",
    })
    .returning({ id: submittalReviews.id });
  pendingReviewId = pendingRev.id;

  // Step 2 (IN_REVIEW): the active step the same field reviewer is
  // ball-in-court on. Stamping must succeed.
  const [activeRev] = await db
    .insert(submittalReviews)
    .values({
      submittalId,
      organizationId: orgId,
      reviewerRole: "GC_MANAGER",
      reviewerId: userId,
      reviewerName: "Field Reviewer",
      sequenceOrder: 1,
      status: "IN_REVIEW",
      dateAssigned: new Date(),
    })
    .returning({ id: submittalReviews.id });
  activeReviewId = activeRev.id;

  // Task #1607: a separate IN_REVIEW row owned by the same field
  // reviewer that the test will mutate to a resolved status (e.g.
  // APPROVED) *before* the mobile push arrives, simulating office
  // staff stamping the review while the device was offline. The push
  // must then be reported back as CONFLICT (not silently overwritten,
  // and not bucketed as a generic FAILED).
  const [staleRev] = await db
    .insert(submittalReviews)
    .values({
      submittalId,
      organizationId: orgId,
      reviewerRole: "GC_MANAGER",
      reviewerId: userId,
      reviewerName: "Field Reviewer",
      sequenceOrder: 3,
      status: "IN_REVIEW",
      dateAssigned: new Date(),
    })
    .returning({ id: submittalReviews.id });
  staleReviewId = staleRev.id;
}, 60_000);

afterAll(async () => {
  if (!orgId) return;
  await db.execute(sql`DELETE FROM offline_sync_queue WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM submittal_activity WHERE submittal_id IN (SELECT id FROM submittals WHERE organization_id = ${orgId})`).catch(() => {});
  await db.execute(sql`DELETE FROM submittal_reviews WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM submittals WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM mobile_devices WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
}, 30_000);

function authedPost(path: string, body: unknown) {
  return request(app)
    .post(path)
    .set("X-Test-User-Id", userId)
    .set("X-Test-Org-Id", orgId)
    .set("Content-Type", "application/json")
    .send(body as object);
}

describe("Mobile sync — SUBMITTAL_STAMP active-step authorization", () => {
  it("rejects a stamp targeting a PENDING (future-step) review with status FAILED", async () => {
    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        submittalStamps: [
          {
            localId: "stamp-pending-1",
            reviewId: pendingReviewId,
            submittalId,
            action: "APPROVED",
            comments: "Should be rejected — chain has not reached this step",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(body.processed.submittalStamps).toHaveLength(1);
    expect(body.processed.submittalStamps[0].localId).toBe("stamp-pending-1");
    expect(body.processed.submittalStamps[0].status).toBe("FAILED");

    // The PENDING review row must remain untouched.
    const [row] = await db
      .select({
        status: submittalReviews.status,
        stampAction: submittalReviews.stampAction,
        dateReviewed: submittalReviews.dateReviewed,
      })
      .from(submittalReviews)
      .where(eq(submittalReviews.id, pendingReviewId))
      .limit(1);
    expect(row.status).toBe("PENDING");
    expect(row.stampAction).toBeNull();
    expect(row.dateReviewed).toBeNull();
  });

  it("accepts a stamp targeting the active IN_REVIEW row, persists it, and writes an activity row", async () => {
    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        submittalStamps: [
          {
            localId: "stamp-active-1",
            reviewId: activeReviewId,
            submittalId,
            action: "APPROVED_AS_NOTED",
            comments: "Field-stamped from tablet",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(body.processed.submittalStamps).toHaveLength(1);
    expect(body.processed.submittalStamps[0].status).toBe("SAVED");

    const [row] = await db
      .select({
        status: submittalReviews.status,
        stampAction: submittalReviews.stampAction,
        comments: submittalReviews.comments,
        dateReviewed: submittalReviews.dateReviewed,
      })
      .from(submittalReviews)
      .where(eq(submittalReviews.id, activeReviewId))
      .limit(1);
    expect(row.status).toBe("APPROVED_AS_NOTED");
    expect(row.stampAction).toBe("APPROVED_AS_NOTED");
    expect(row.comments).toBe("Field-stamped from tablet");
    expect(row.dateReviewed).not.toBeNull();

    const activity = await db
      .select({ action: submittalActivity.action, comment: submittalActivity.comment })
      .from(submittalActivity)
      .where(and(
        eq(submittalActivity.submittalId, submittalId),
        eq(submittalActivity.userId, userId),
      ));
    const stampActivity = activity.find((a) => a.action.includes("APPROVED_AS_NOTED"));
    expect(stampActivity).toBeDefined();
    expect(stampActivity!.action).toContain("Stamp queued from mobile");
    expect(stampActivity!.comment).toBe("Field-stamped from tablet");
  });

  it("returns DUPLICATE for the same localId on resync (idempotent)", async () => {
    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        submittalStamps: [
          {
            localId: "stamp-active-1",
            reviewId: activeReviewId,
            submittalId,
            action: "APPROVED_AS_NOTED",
            comments: "Field-stamped from tablet",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(body.processed.submittalStamps[0].status).toBe("DUPLICATE");
  });

  // Task #1607: stale-review case. Office staff resolves the review
  // (APPROVED) while the field reviewer is offline; their queued
  // SUBMITTAL_STAMP push must then come back as CONFLICT — not
  // silently overwriting the office decision and not bucketed into
  // the generic FAILED bin which the device cannot tell apart from a
  // bad payload.
  it("returns CONFLICT (not silent SAVED) when the target review was already resolved by office staff", async () => {
    // Simulate office staff stamping the review out-of-band (before
    // the device sync arrives). Bypass advanceChain entirely — we
    // only care about the row state the mobile push will see.
    const officeReviewedAt = new Date("2026-04-23T12:00:00.000Z");
    await db
      .update(submittalReviews)
      .set({
        status: "APPROVED",
        stampAction: "APPROVED",
        comments: "Office stamped first",
        dateReviewed: officeReviewedAt,
      })
      .where(eq(submittalReviews.id, staleReviewId));

    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        submittalStamps: [
          {
            localId: "stamp-stale-1",
            reviewId: staleReviewId,
            submittalId,
            action: "REJECTED",
            comments: "Field reviewer queued this while offline",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(body.processed.submittalStamps).toHaveLength(1);
    const item = body.processed.submittalStamps[0];
    expect(item.localId).toBe("stamp-stale-1");
    expect(item.status).toBe("CONFLICT");
    expect(item.serverStatus).toBe("APPROVED");
    expect(typeof item.reason).toBe("string");
    expect(item.reason).toMatch(/APPROVED/);
    expect(item.serverUpdatedAt).toBe(officeReviewedAt.toISOString());

    // The CONFLICT must also be surfaced in the response-level
    // conflicts array so the device's existing conflict-feed
    // plumbing picks it up alongside the timestamp-based offline
    // queue conflicts.
    const stampConflict = body.conflicts.find(
      (c) => c.entityType === "SUBMITTAL_STAMP" && c.localId === "stamp-stale-1",
    );
    expect(stampConflict).toBeDefined();
    expect(stampConflict!.entityId).toBe(staleReviewId);
    expect(stampConflict!.serverStatus).toBe("APPROVED");
    expect(stampConflict!.serverUpdatedAt).toBe(officeReviewedAt.toISOString());

    // Critically: the office's resolved review row MUST NOT have been
    // overwritten by the mobile tap. This is the silent-data-loss
    // bug the conflict surface protects against.
    const [row] = await db
      .select({
        status: submittalReviews.status,
        stampAction: submittalReviews.stampAction,
        comments: submittalReviews.comments,
        dateReviewed: submittalReviews.dateReviewed,
      })
      .from(submittalReviews)
      .where(eq(submittalReviews.id, staleReviewId))
      .limit(1);
    expect(row.status).toBe("APPROVED");
    expect(row.stampAction).toBe("APPROVED");
    expect(row.comments).toBe("Office stamped first");
    expect(row.dateReviewed?.toISOString()).toBe(officeReviewedAt.toISOString());
  });

  it("returns DUPLICATE on a re-push of a stamp previously surfaced as CONFLICT (no retry storm)", async () => {
    // After the conflict, the device may try the queued stamp again
    // before the user resolves it on the conflict screen. The server
    // must recognize the localId as already-persisted and short-
    // circuit to DUPLICATE — otherwise the same review would be
    // CONFLICT-thrashed on every sync cycle.
    const res = await authedPost("/api/ai-features/mobile/sync", {
      deviceId: deviceTextId,
      changes: {
        submittalStamps: [
          {
            localId: "stamp-stale-1",
            reviewId: staleReviewId,
            submittalId,
            action: "REJECTED",
            comments: "Field reviewer queued this while offline",
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    const body = res.body as SyncResponseBody;
    expect(body.processed.submittalStamps).toHaveLength(1);
    expect(body.processed.submittalStamps[0].status).toBe("DUPLICATE");
  });
});
