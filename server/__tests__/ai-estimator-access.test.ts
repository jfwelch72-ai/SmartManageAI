// Task #2340 — Unit coverage for `server/services/aiEstimator/access.ts`.
//
// Locks in:
//   • per-user enablement state (insert + update path of `setUserAccess`)
//   • `getAccessStatus` reason mapping (NOT_ENABLED vs OK)
//   • `listOrgAccess` returns rows scoped to a single tenant
//   • Tenant-safety guards: `assertBidInOrg`, `assertProjectInOrg`,
//     `assertEstimateInOrg` throw `ResourceOwnershipError` on mismatch
//   • `filterSheetsInOrg` keeps only sheets resolvable to the caller's org

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

import { db } from "../db";
import {
  organizations,
  users,
  bids,
  projects,
  estimates,
  takeoffSheets,
  aiEstimatorUserAccess,
} from "@shared/schema";
import {
  ResourceOwnershipError,
  assertBidInOrg,
  assertEstimateInOrg,
  assertProjectInOrg,
  filterSheetsInOrg,
  getAccessStatus,
  listOrgAccess,
  setUserAccess,
} from "../services/aiEstimator/access";

const PREFIX = "__ai_est_access__";

interface Ctx {
  orgA: string;
  orgB: string;
  userA: string;
  userB: string;
  bidA: string;
  bidB: string;
  projectA: string;
  projectB: string;
  estimateA_bid: string;
  estimateA_project: string;
  estimateB_bid: string;
  sheetA_byBid: string;
  sheetA_byProject: string;
  sheetB: string;
}

let ctx: Ctx;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_user_access WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM takeoff_sheets WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM takeoff_sheets WHERE project_id IN (SELECT id FROM projects WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM estimates WHERE bid_id IN (SELECT id FROM bids WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE code LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM bids WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM projects WHERE code LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM users WHERE email LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [orgA, orgB] = await db
    .insert(organizations)
    .values([
      { name: "Access Org A", slug: `${PREFIX}a-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
      { name: "Access Org B", slug: `${PREFIX}b-${stamp}`, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true },
    ])
    .returning();

  const [userA, userB, changer] = await db
    .insert(users)
    .values([
      { email: `${PREFIX}user-a-${stamp}@test.local`, passwordHash, firstName: "U", lastName: "A", role: "ESTIMATOR", organizationId: orgA.id, isActive: true },
      { email: `${PREFIX}user-b-${stamp}@test.local`, passwordHash, firstName: "U", lastName: "B", role: "ESTIMATOR", organizationId: orgB.id, isActive: true },
      { email: `${PREFIX}changer-${stamp}@test.local`, passwordHash, firstName: "Changer", lastName: "Admin", role: "ADMIN", organizationId: orgA.id, isActive: true },
    ])
    .returning();

  const [bidA, bidB] = await db
    .insert(bids)
    .values([
      { name: "Bid A", code: `${PREFIX}BID-A-${stamp}`, clientName: "Client A", gcOrganizationId: orgA.id },
      { name: "Bid B", code: `${PREFIX}BID-B-${stamp}`, clientName: "Client B", gcOrganizationId: orgB.id },
    ])
    .returning();

  const [projectA, projectB] = await db
    .insert(projects)
    .values([
      { name: "Project A", code: `${PREFIX}PRJ-A-${stamp}`, clientName: "Client A", gcOrganizationId: orgA.id, status: "ACTIVE" },
      { name: "Project B", code: `${PREFIX}PRJ-B-${stamp}`, clientName: "Client B", gcOrganizationId: orgB.id, status: "ACTIVE" },
    ])
    .returning();

  const [estA_bid, estA_proj, estB_bid] = await db
    .insert(estimates)
    .values([
      { bidId: bidA.id, createdById: changer.id },
      { projectId: projectA.id, createdById: changer.id },
      { bidId: bidB.id, createdById: userB.id },
    ])
    .returning();

  const [sheetA_bid, sheetA_proj, sheetB] = await db
    .insert(takeoffSheets)
    .values([
      { bidId: bidA.id, imageUrl: "https://example.com/a-by-bid.pdf", units: "ft" },
      { projectId: projectA.id, imageUrl: "https://example.com/a-by-project.pdf", units: "ft" },
      { bidId: bidB.id, imageUrl: "https://example.com/b.pdf", units: "ft" },
    ])
    .returning();

  ctx = {
    orgA: orgA.id,
    orgB: orgB.id,
    userA: userA.id,
    userB: userB.id,
    bidA: bidA.id,
    bidB: bidB.id,
    projectA: projectA.id,
    projectB: projectB.id,
    estimateA_bid: estA_bid.id,
    estimateA_project: estA_proj.id,
    estimateB_bid: estB_bid.id,
    sheetA_byBid: sheetA_bid.id,
    sheetA_byProject: sheetA_proj.id,
    sheetB: sheetB.id,
  };
}, 60_000);

afterAll(async () => {
  await cleanup();
});

describe("aiEstimator/access — per-user access state", () => {
  it("getAccessStatus returns NOT_ENABLED before a row exists", async () => {
    const status = await getAccessStatus(ctx.orgA, ctx.userA);
    expect(status).toEqual({ enabled: false, canTrain: false, reason: "NOT_ENABLED" });
  });

  it("setUserAccess inserts a fresh row, then updates it on subsequent calls", async () => {
    const created = await setUserAccess({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      enabled: true,
      canTrain: true,
      changedById: ctx.userA,
    });
    expect(created.enabled).toBe(true);
    expect(created.canTrain).toBe(true);
    expect(created.enabledAt).toBeInstanceOf(Date);

    // Second call updates the SAME row instead of inserting another.
    const updated = await setUserAccess({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      enabled: false,
      changedById: ctx.userA,
    });
    expect(updated.enabled).toBe(false);
    // canTrain falls back to the existing value when omitted.
    expect(updated.canTrain).toBe(true);

    const rows = await db.select().from(aiEstimatorUserAccess);
    const matching = rows.filter((r) => r.userId === ctx.userA && r.organizationId === ctx.orgA);
    expect(matching).toHaveLength(1);
  });

  it("getAccessStatus returns OK once the user is enabled", async () => {
    await setUserAccess({
      organizationId: ctx.orgA,
      userId: ctx.userA,
      enabled: true,
      changedById: ctx.userA,
    });
    const status = await getAccessStatus(ctx.orgA, ctx.userA);
    expect(status.enabled).toBe(true);
    expect(status.reason).toBe("OK");
  });

  it("listOrgAccess scopes rows to a single org", async () => {
    await setUserAccess({
      organizationId: ctx.orgB,
      userId: ctx.userB,
      enabled: true,
      changedById: ctx.userB,
    });
    const aRows = await listOrgAccess(ctx.orgA);
    const bRows = await listOrgAccess(ctx.orgB);
    expect(aRows.some((r) => r.userId === ctx.userA)).toBe(true);
    expect(aRows.some((r) => r.userId === ctx.userB)).toBe(false);
    expect(bRows.some((r) => r.userId === ctx.userB)).toBe(true);
    expect(bRows.some((r) => r.userId === ctx.userA)).toBe(false);
  });
});

describe("aiEstimator/access — tenant safety guards", () => {
  it("assertBidInOrg accepts the owning org and rejects others", async () => {
    await expect(assertBidInOrg(ctx.bidA, ctx.orgA)).resolves.toBeUndefined();
    await expect(assertBidInOrg(ctx.bidA, ctx.orgB)).rejects.toBeInstanceOf(ResourceOwnershipError);
    await expect(assertBidInOrg("00000000-0000-0000-0000-000000000000", ctx.orgA)).rejects.toBeInstanceOf(ResourceOwnershipError);
  });

  it("assertProjectInOrg accepts the owning org and rejects others", async () => {
    await expect(assertProjectInOrg(ctx.projectA, ctx.orgA)).resolves.toBeUndefined();
    await expect(assertProjectInOrg(ctx.projectA, ctx.orgB)).rejects.toBeInstanceOf(ResourceOwnershipError);
  });

  it("assertEstimateInOrg resolves through the parent bid", async () => {
    await expect(assertEstimateInOrg(ctx.estimateA_bid, ctx.orgA)).resolves.toBeUndefined();
    await expect(assertEstimateInOrg(ctx.estimateA_bid, ctx.orgB)).rejects.toBeInstanceOf(ResourceOwnershipError);
  });

  it("assertEstimateInOrg resolves through the parent project when no bid is attached", async () => {
    await expect(assertEstimateInOrg(ctx.estimateA_project, ctx.orgA)).resolves.toBeUndefined();
    await expect(assertEstimateInOrg(ctx.estimateA_project, ctx.orgB)).rejects.toBeInstanceOf(ResourceOwnershipError);
  });

  it("assertEstimateInOrg rejects estimates owned by another tenant via their bid", async () => {
    await expect(assertEstimateInOrg(ctx.estimateB_bid, ctx.orgA)).rejects.toBeInstanceOf(ResourceOwnershipError);
  });
});

describe("aiEstimator/access — filterSheetsInOrg", () => {
  it("returns the empty list when given no candidates", async () => {
    expect(await filterSheetsInOrg([], ctx.orgA)).toEqual([]);
  });

  it("keeps sheets resolvable via parent bid OR parent project for the caller's org, drops everything else", async () => {
    const allowed = await filterSheetsInOrg(
      [ctx.sheetA_byBid, ctx.sheetA_byProject, ctx.sheetB, "00000000-0000-0000-0000-000000000000"],
      ctx.orgA,
    );
    expect(allowed.sort()).toEqual([ctx.sheetA_byBid, ctx.sheetA_byProject].sort());
  });
});
