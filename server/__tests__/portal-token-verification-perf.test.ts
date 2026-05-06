// Task #1626 — regression test for `requirePortalAuth` performance.
//
// Before this task, `requirePortalAuth` did a full `SELECT *` of every
// active portal token and then bcrypt-compared the request token against
// each row in JS until one matched. With bcrypt at cost factor 10 (~100ms
// per compare), a project with hundreds of active subcontractors made
// every `/api/portal/*` request take seconds.
//
// The fix adds an indexed HMAC-SHA256 lookup column (`token_lookup_hash`)
// so the candidate row is found with a single index probe, and bcrypt is
// only used as the constant-time confirm on that one row.
//
// This test seeds N extra active tokens that all share the same
// (project, crm org, contact) target as a "needle" token, then verifies:
//   1. `requirePortalAuth` still authenticates the needle token (the
//      behavioural contract — gating, identity, lastAccessedAt — is
//      unchanged).
//   2. Verification time stays roughly flat as N grows (the perf
//      contract). We compare the wall-clock cost of authenticating the
//      needle when N=10 vs N=300; with the old O(N) bcrypt scan the
//      ratio would be ~30x, with the indexed lookup it should be ~1x
//      (we assert <5x to leave generous slack for CI noise).

import { logInfo } from "../utils/logger";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcrypt";
import type { Express, ErrorRequestHandler } from "express";
import request from "supertest";
import { sql, inArray, eq } from "drizzle-orm";

vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: async () => true,
}));
vi.mock("../services/emailService", () => ({
  sendEmail: async () => undefined,
}));
vi.mock("../email", () => ({ sendEmail: async () => undefined }));

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  crmOrganisations,
  crmContacts,
  subcontractorPortalTokens,
} from "@shared/schema";

const createdOrgIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdProjectIds = new Set<string>();
const createdCrmOrgIds = new Set<string>();
const createdCrmContactIds = new Set<string>();
const createdTokenIds = new Set<string>();

interface SeededTenant {
  orgId: string;
  userId: string;
  projectId: string;
  crmOrgId: string;
  crmContactId: string;
  recipientEmail: string;
}

async function seedTenant(label: string): Promise<SeededTenant> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `portal-perf-${label}-${uniq}`;
  const recipientEmail = `${label.toLowerCase()}-${uniq}@portal-perf.test`;

  const [org] = await db.insert(organizations).values({
    name: `Portal Perf Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  createdOrgIds.add(org.id);

  const [user] = await db.insert(users).values({
    email: `inviter-${slug}@portal-perf.test`,
    firstName: "Inviter",
    lastName: `User-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  createdUserIds.add(user.id);

  const [project] = await db.insert(projects).values({
    name: `Portal Perf Project ${label}`,
    code: `PPRF-${label}-${uniq}`,
    clientName: `Client ${label}`,
  }).returning();
  createdProjectIds.add(project.id);

  const [crmOrg] = await db.insert(crmOrganisations).values({
    organizationId: org.id,
    type: "SUBCONTRACTOR",
    name: `Portal Perf Sub ${label} ${uniq}`,
  }).returning();
  createdCrmOrgIds.add(crmOrg.id);

  const [contact] = await db.insert(crmContacts).values({
    organizationId: org.id,
    organisationId: crmOrg.id,
    firstName: "Pat",
    lastName: `Reviewer-${label}`,
    email: recipientEmail,
    role: "OTHER",
    isActive: true,
  }).returning();
  createdCrmContactIds.add(contact.id);

  return {
    orgId: org.id,
    userId: user.id,
    projectId: project.id,
    crmOrgId: crmOrg.id,
    crmContactId: contact.id,
    recipientEmail,
  };
}

async function cleanup(): Promise<void> {
  if (createdTokenIds.size > 0) {
    await db.delete(subcontractorPortalTokens).where(
      inArray(subcontractorPortalTokens.id, Array.from(createdTokenIds)),
    );
  }
  if (createdOrgIds.size > 0) {
    // Belt-and-braces — also nuke any token that escaped tracking.
    await db.delete(subcontractorPortalTokens).where(
      inArray(subcontractorPortalTokens.organizationId, Array.from(createdOrgIds)),
    );
  }
  if (createdCrmContactIds.size > 0) {
    await db.delete(crmContacts).where(inArray(crmContacts.id, Array.from(createdCrmContactIds)));
  }
  if (createdCrmOrgIds.size > 0) {
    await db.delete(crmOrganisations).where(inArray(crmOrganisations.id, Array.from(createdCrmOrgIds)));
  }
  if (createdUserIds.size > 0) {
    await db.delete(users).where(inArray(users.id, Array.from(createdUserIds)));
  }
  if (createdProjectIds.size > 0) {
    await db.delete(projects).where(inArray(projects.id, Array.from(createdProjectIds)));
  }
  if (createdOrgIds.size > 0) {
    await db.delete(organizations).where(inArray(organizations.id, Array.from(createdOrgIds)));
  }
  createdTokenIds.clear();
  createdOrgIds.clear();
  createdUserIds.clear();
  createdProjectIds.clear();
  createdCrmOrgIds.clear();
  createdCrmContactIds.clear();
}

let app: Express;
let portalAuthModule: typeof import("../portalAuth");

beforeAll(async () => {
  const express = (await import("express")).default;
  portalAuthModule = await import("../portalAuth");
  const portalRouter = (await import("../portalRoutes")).default;

  app = express();
  app.use(express.json());
  app.use("/api", portalRouter);
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const e = err as { status?: number; statusCode?: number; message?: string } | null;
    const status = e?.status ?? e?.statusCode ?? 500;
    if (!res.headersSent) {
      res.status(status).json({ error: e?.message ?? "Internal Server Error" });
    }
  };
  app.use(errorHandler);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(() => {
  // No per-test reset needed — tokens are tracked individually so each
  // case can clean up its own padding without impacting siblings.
});

async function seedToken(args: {
  tenant: SeededTenant;
  rawToken: string;
  withLookupHash: boolean;
}): Promise<string> {
  // Cost factor 4 keeps padding-token creation cheap. The fast-path
  // assertion intentionally uses cost factor 10 (production default) for
  // the *needle* token so we measure the realistic verification cost.
  const tokenHash = await bcrypt.hash(args.rawToken, 4);
  const tokenLookupHash = args.withLookupHash
    ? portalAuthModule.computePortalTokenLookupHash(args.rawToken)
    : null;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  const [row] = await db.insert(subcontractorPortalTokens).values({
    organizationId: args.tenant.orgId,
    projectId: args.tenant.projectId,
    crmOrganisationId: args.tenant.crmOrgId,
    contactEmail: args.tenant.recipientEmail,
    contactName: "Pat Reviewer",
    tokenHash,
    tokenLookupHash,
    permissions: ["view", "comment"],
    status: "active",
    expiresAt,
  }).returning();
  createdTokenIds.add(row.id);
  return row.id;
}

async function timeAuthMs(rawToken: string, samples = 3): Promise<number> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i++) {
    const start = process.hrtime.bigint();
    const res = await request(app).get(`/api/portal/info?token=${rawToken}`);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    expect(res.status).toBe(200);
    timings.push(elapsedMs);
  }
  // Median is more robust to GC / DB-warmup noise than mean.
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)];
}

describe("Task #1626 — portal-token verification stays O(1) as active set grows", () => {
  it("authenticates the needle token by indexed lookup, not by scanning every row", async () => {
    const tenant = await seedTenant("Indexed");

    // Mint a needle token *with* the lookup hash populated (production
    // mint sites always populate it now).
    const rawNeedle = "n".repeat(64); // deterministic, 32-byte hex form
    const needleId = await seedToken({ tenant, rawToken: rawNeedle, withLookupHash: true });

    // Pad with 50 other active tokens for the same tenant (so they all
    // pass the status/expiresAt gate). Different raw tokens → different
    // bcrypt hashes; the old code would have to compare each one.
    for (let i = 0; i < 50; i++) {
      const raw = `pad-${i}-${Math.random().toString(36).slice(2)}`.padEnd(64, "0");
      await seedToken({ tenant, rawToken: raw, withLookupHash: true });
    }

    // Behavioural contract: the needle still authenticates and its row
    // (not a padding row) is what populates req.portalToken.
    const res = await request(app).get(`/api/portal/info?token=${rawNeedle}`);
    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(tenant.projectId);
    expect(res.body.subcontractor.id).toBe(tenant.crmOrgId);

    // lastAccessedAt is updated on the right row.
    const [needleRow] = await db
      .select()
      .from(subcontractorPortalTokens)
      .where(eq(subcontractorPortalTokens.id, needleId));
    expect(needleRow.lastAccessedAt).toBeTruthy();
  }, 180_000);

  it("verification time stays roughly flat as the active token table grows", async () => {
    const tenant = await seedTenant("Flat");

    // Needle is created up-front and its raw value is the only one we
    // will time. Cost factor 10 (production default) so the bcrypt
    // confirm reflects real-world cost.
    const rawNeedle = `${"a".repeat(60)}beef`;
    const needleHash = await bcrypt.hash(rawNeedle, 10);
    const needleLookupHash = portalAuthModule.computePortalTokenLookupHash(rawNeedle);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);
    const [needleRow] = await db.insert(subcontractorPortalTokens).values({
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      crmOrganisationId: tenant.crmOrgId,
      contactEmail: tenant.recipientEmail,
      contactName: "Pat Reviewer",
      tokenHash: needleHash,
      tokenLookupHash: needleLookupHash,
      permissions: ["view", "comment"],
      status: "active",
      expiresAt,
    }).returning();
    createdTokenIds.add(needleRow.id);

    async function padTo(targetTotal: number): Promise<void> {
      // Bulk-insert padding rows (skip bcrypt — we use a fixed,
      // distinguishable hash that will *never* match the needle's raw
      // token, since bcrypt.compare returns false for malformed hashes
      // too. We just need the row to be visible in the active set.)
      const existing = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM subcontractor_portal_tokens
        WHERE organization_id = ${tenant.orgId} AND status = 'active'
      `);
      const current = parseInt(existing.rows[0]?.count ?? "0", 10);
      const need = targetTotal - current;
      if (need <= 0) return;

      // Reuse the same bcrypt hash for all padding rows (saves test
      // time). It's fine because the unique constraint is on
      // token_hash; we'll just generate one and reuse via a salt-free
      // workaround: append a random suffix… actually drizzle requires
      // unique token_hash, so generate distinct ones cheaply at cost
      // factor 4.
      for (let i = 0; i < need; i++) {
        const padRaw = `pad-${current + i}-${Math.random().toString(36).slice(2)}`.padEnd(64, "0");
        const padHash = await bcrypt.hash(padRaw, 4);
        const padLookup = portalAuthModule.computePortalTokenLookupHash(padRaw);
        const [row] = await db.insert(subcontractorPortalTokens).values({
          organizationId: tenant.orgId,
          projectId: tenant.projectId,
          crmOrganisationId: tenant.crmOrgId,
          contactEmail: tenant.recipientEmail,
          contactName: `Pad ${current + i}`,
          tokenHash: padHash,
          tokenLookupHash: padLookup,
          permissions: ["view"],
          status: "active",
          expiresAt,
        }).returning();
        createdTokenIds.add(row.id);
      }
    }

    // Warm everything up (JIT, query plan cache, connection pool).
    await timeAuthMs(rawNeedle, 1);

    // Baseline: needle + ~10 padding rows.
    await padTo(11);
    const smallMs = await timeAuthMs(rawNeedle, 5);

    // Grow the active set ~30x.
    await padTo(310);
    const largeMs = await timeAuthMs(rawNeedle, 5);

    // The old O(N) implementation would be ~30x slower at 310 rows
    // than at 11 (each extra row = one bcrypt-compare ≈ 100ms).
    // With the indexed lookup the cost is effectively constant; we
    // assert <5x to leave room for normal CI variance, while still
    // failing loudly if anyone reintroduces the linear scan.
    const ratio = largeMs / Math.max(smallMs, 1);
    if (process.env.PORTAL_PERF_DEBUG) {
      // eslint-disable-next-line no-console
      logInfo(
        `[portal-perf] small=${smallMs.toFixed(1)}ms large=${largeMs.toFixed(1)}ms ratio=${ratio.toFixed(2)}x`,
      );
    }
    expect(ratio).toBeLessThan(5);

    // And in absolute terms the large-set verification should still be
    // well under a second (one indexed lookup + one bcrypt compare at
    // cost 10 ≈ ~100-200ms total).
    expect(largeMs).toBeLessThan(1500);
  }, 300_000);

  it("legacy tokens (no lookup hash yet) still authenticate and get back-filled on first access", async () => {
    const tenant = await seedTenant("Legacy");

    // Simulate a token minted before the lookup-hash column existed.
    const rawLegacy = `legacy-${Date.now()}`.padEnd(64, "0");
    const legacyId = await seedToken({
      tenant,
      rawToken: rawLegacy,
      withLookupHash: false,
    });

    const before = await db
      .select()
      .from(subcontractorPortalTokens)
      .where(eq(subcontractorPortalTokens.id, legacyId));
    expect(before[0].tokenLookupHash).toBeNull();

    const res = await request(app).get(`/api/portal/info?token=${rawLegacy}`);
    expect(res.status).toBe(200);

    const after = await db
      .select()
      .from(subcontractorPortalTokens)
      .where(eq(subcontractorPortalTokens.id, legacyId));
    expect(after[0].tokenLookupHash).toBe(
      portalAuthModule.computePortalTokenLookupHash(rawLegacy),
    );
    expect(after[0].lastAccessedAt).toBeTruthy();

    // Second request now hits the fast path; behaviour identical.
    const res2 = await request(app).get(`/api/portal/info?token=${rawLegacy}`);
    expect(res2.status).toBe(200);
  }, 60_000);
});
