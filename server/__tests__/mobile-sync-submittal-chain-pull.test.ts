/**
 * Task #1599 — chain-pull contract tests for the mobile delta sync.
 *
 * The mobile Submittals screen renders the FULL review chain on every
 * submittal the user can see (submitter OR any-time reviewer) so the
 * field user can read past stamps + active step + future steps. This
 * test locks two related contracts:
 *
 *   (a) A submitter-only user — never assigned as a reviewer — still
 *       receives every chain row for their own submittal.
 *   (b) For a reviewer-participant, the pull surfaces sibling chain
 *       rows that belong to OTHER reviewers (so chain-detail shows
 *       full context), while the active row owned by another user is
 *       returned but is NOT actionable from this user's account.
 *
 *  Server-side stamp authorization is verified separately in
 *  mobile-sync-submittal-stamp.test.ts; here we focus on the GET
 *  /api/ai-features/mobile/sync delta payload + a stamp attempt by a
 *  user against a sibling's IN_REVIEW row (must be FAILED).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Express, Request, Response, NextFunction } from "express";
import request from "supertest";
import { db } from "../db";
import {
  organizations,
  users,
  projects,
  submittals,
  submittalReviews,
  submittalActivity,
} from "@shared/schema";
import { sql, eq } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__chain_pull__";

let app: Express;
let orgId: string;
let submitterId: string;
let reviewerAId: string;
let reviewerBId: string;
let projectId: string;
let submittalId: string;
let reviewAId: string;
let reviewBId: string;

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
      req.user = {
        id: headerUserId,
        organizationId: headerOrgId,
        role: "FIELD_WORKER",
        firstName: "Field",
        lastName: "User",
      };
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

  const [org] = await db.insert(organizations).values({
    name: `Chain Pull Org ${Date.now()}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning({ id: organizations.id });
  orgId = org.id;

  const [submitter] = await db.insert(users).values({
    email: `${slug}-submitter@test.local`,
    passwordHash,
    firstName: "Sub",
    lastName: "Mitter",
    role: "FIELD_WORKER",
    organizationId: orgId,
    isActive: true,
  }).returning({ id: users.id });
  submitterId = submitter.id;

  const [revA] = await db.insert(users).values({
    email: `${slug}-revA@test.local`,
    passwordHash,
    firstName: "Rev",
    lastName: "A",
    role: "FIELD_WORKER",
    organizationId: orgId,
    isActive: true,
  }).returning({ id: users.id });
  reviewerAId = revA.id;

  const [revB] = await db.insert(users).values({
    email: `${slug}-revB@test.local`,
    passwordHash,
    firstName: "Rev",
    lastName: "B",
    role: "FIELD_WORKER",
    organizationId: orgId,
    isActive: true,
  }).returning({ id: users.id });
  reviewerBId = revB.id;

  const [proj] = await db.insert(projects).values({
    name: `Chain Pull Project`,
    code: `${TEST_PREFIX}P-${Date.now()}`,
    clientName: "Test Client",
    gcOrganizationId: orgId,
    status: "ACTIVE",
  }).returning({ id: projects.id });
  projectId = proj.id;

  const [sub] = await db.insert(submittals).values({
    organizationId: orgId,
    projectId,
    submittalNumber: `SUB-${TEST_PREFIX}-${Date.now()}`,
    subject: "Chain pull fixture",
    submittalType: "CONTRACTOR",
    phase: "CONSTRUCTION",
    status: "UNDER_REVIEW",
    submittedById: submitterId,
  }).returning({ id: submittals.id });
  submittalId = sub.id;

  // Two-step parallel-looking chain: A is the active IN_REVIEW
  // reviewer; B is a different user assigned to step 2 (PENDING).
  const [rA] = await db.insert(submittalReviews).values({
    submittalId,
    organizationId: orgId,
    reviewerRole: "ARCHITECT",
    reviewerId: reviewerAId,
    reviewerName: "Rev A",
    sequenceOrder: 1,
    status: "IN_REVIEW",
    dateAssigned: new Date(),
  }).returning({ id: submittalReviews.id });
  reviewAId = rA.id;

  const [rB] = await db.insert(submittalReviews).values({
    submittalId,
    organizationId: orgId,
    reviewerRole: "ENGINEER",
    reviewerId: reviewerBId,
    reviewerName: "Rev B",
    sequenceOrder: 2,
    status: "PENDING",
  }).returning({ id: submittalReviews.id });
  reviewBId = rB.id;
}, 60_000);

afterAll(async () => {
  if (!orgId) return;
  await db.execute(sql`DELETE FROM submittal_activity WHERE submittal_id = ${submittalId}`).catch(() => {});
  await db.execute(sql`DELETE FROM submittal_reviews WHERE submittal_id = ${submittalId}`).catch(() => {});
  await db.execute(sql`DELETE FROM submittals WHERE id = ${submittalId}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE id = ${projectId}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
}, 30_000);

function asUser(userId: string) {
  return { "X-Test-User-Id": userId, "X-Test-Org-Id": orgId } as Record<string, string>;
}

describe("GET /api/ai-features/mobile/sync — full chain pull", () => {
  it("returns ALL chain rows (active + pending) for a submitter-only user who is never assigned as reviewer", async () => {
    const res = await request(app)
      .get("/api/ai-features/mobile/sync")
      .query({ lastSyncAt: new Date(0).toISOString() })
      .set(asUser(submitterId));

    expect(res.status).toBe(200);
    const body = res.body as { changes: { submittals: Array<{ id: string }>; submittalReviews: Array<{ id: string; reviewerId: string | null; status: string }> } };

    // Submittal itself is in the delta because submittedById = submitterId.
    const submittalIds = body.changes.submittals.map((s) => s.id);
    expect(submittalIds).toContain(submittalId);

    // Both chain rows are present even though the submitter is NOT a
    // reviewer on either step — this is the regression we're locking.
    const chainIds = body.changes.submittalReviews.map((r) => r.id).sort();
    expect(chainIds).toEqual([reviewAId, reviewBId].sort());

    const active = body.changes.submittalReviews.find((r) => r.id === reviewAId);
    const pending = body.changes.submittalReviews.find((r) => r.id === reviewBId);
    expect(active?.status).toBe("IN_REVIEW");
    expect(active?.reviewerId).toBe(reviewerAId);
    expect(pending?.status).toBe("PENDING");
    expect(pending?.reviewerId).toBe(reviewerBId);
  }, 30_000);

  it("returns sibling chain rows to a reviewer-participant so chain detail shows full context", async () => {
    const res = await request(app)
      .get("/api/ai-features/mobile/sync")
      .query({ lastSyncAt: new Date(0).toISOString() })
      .set(asUser(reviewerBId));

    expect(res.status).toBe(200);
    const body = res.body as { changes: { submittals: Array<{ id: string }>; submittalReviews: Array<{ id: string; reviewerId: string | null }> } };

    expect(body.changes.submittals.map((s) => s.id)).toContain(submittalId);
    const chainIds = body.changes.submittalReviews.map((r) => r.id).sort();
    expect(chainIds).toEqual([reviewAId, reviewBId].sort());
  }, 30_000);
});

describe("POST /api/ai-features/mobile/sync — server stamp authz blocks sibling", () => {
  it("returns FAILED when reviewer B tries to stamp reviewer A's IN_REVIEW row (mobile UI must not surface this CTA either)", async () => {
    const localId = `local-${Date.now()}`;
    const res = await request(app)
      .post("/api/ai-features/mobile/sync")
      .set(asUser(reviewerBId))
      .send({
        changes: {
          submittalStamps: [
            {
              localId,
              submittalId,
              reviewId: reviewAId,
              action: "APPROVED",
              comments: "should not land",
            },
          ],
        },
      });

    expect(res.status).toBe(200);
    const processed = res.body?.processed?.submittalStamps as Array<{ localId: string; status: string }>;
    expect(processed?.find((p) => p.localId === localId)?.status).toBe("FAILED");

    // Reviewer A's row must be untouched.
    const [rowA] = await db.select().from(submittalReviews).where(eq(submittalReviews.id, reviewAId));
    expect(rowA.status).toBe("IN_REVIEW");
    expect(rowA.dateReviewed).toBeNull();

    // No activity row was written for the failed attempt.
    const acts = await db.select().from(submittalActivity).where(eq(submittalActivity.submittalId, submittalId));
    expect(acts.length).toBe(0);
  }, 30_000);
});
