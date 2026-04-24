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
  status: "SAVED" | "FAILED" | "DUPLICATE";
}

interface SyncResponseBody {
  processed: { submittalStamps: ProcessedStamp[] };
}

let app: Express;
let orgId: string;
let userId: string;
let projectId: string;
let submittalId: string;
let pendingReviewId: string;
let activeReviewId: string;
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
    .send(body);
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
});
