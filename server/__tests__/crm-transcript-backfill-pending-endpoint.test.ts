/**
 * Task #1028 — integration tests for the
 * `GET /api/crm/calls/transcripts/backfill/pending` drill-down endpoint
 * added in Task #1010.
 *
 * The endpoint returns the same set of recordings that
 * `fetchEligibleRecordingBatch` would queue for a fresh backfill
 * (transcript IS NULL AND status IN ('PENDING','FAILED')) scoped to the
 * caller's org. These tests pin that contract so a regression in the
 * eligibility filter or the org scope is caught before admins see
 * the wrong list.
 *
 * Coverage:
 *   - Eligibility filter mirrors fetchEligibleRecordingBatch.
 *   - Cross-org recordings never leak into the response.
 *   - Recordings whose parent call has no opportunity still appear
 *     (opportunityId is null in the row, but the recording is listed).
 *   - Pagination: total ignores limit/offset; rows respect both.
 *   - Auth/role guard: anonymous → 401, non-ADMIN → 403.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { eq, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  crmOrganisations,
  crmContacts,
  crmOpportunities,
  crmCalls,
  crmCallRecordings,
} from "@shared/schema";
import { generateToken } from "../auth";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const TEST_EMAIL_DOMAIN = `pending-endpoint-${SUFFIX}.test.invalid`;
const TEST_ORG_PREFIX = `__pending_endpoint_${SUFFIX}__`;

let app: Express;
let server: Server;

let orgId: string;
let adminUserId: string;
let fieldWorkerUserId: string;
let otherOrgId: string;
let otherAdminUserId: string;

let adminCookie: string;
let fieldWorkerCookie: string;
let otherAdminCookie: string;

// Recordings created in our org
const eligibleIds: string[] = []; // PENDING/FAILED + transcript NULL
let recordingWithoutOpportunityId: string;
let recordingWithOpportunityId: string;

async function makeOrgAndAdmin(label: string) {
  const [org] = await db
    .insert(organizations)
    .values({
      name: `${TEST_ORG_PREFIX}${label}`,
      slug: `${TEST_ORG_PREFIX}${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    })
    .returning();
  const [admin] = await db
    .insert(users)
    .values({
      email: `${label}-admin-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: label,
      lastName: "Admin",
      organizationId: org.id,
      role: "ADMIN",
    })
    .returning();
  return { orgId: org.id, adminUserId: admin.id, adminUser: admin };
}

async function makeCall(opts: {
  organizationId: string;
  createdById: string;
  opportunityId?: string | null;
  contactId?: string | null;
  crmOrganisationId?: string | null;
}) {
  const [call] = await db
    .insert(crmCalls)
    .values({
      organizationId: opts.organizationId,
      direction: "OUTBOUND",
      durationSeconds: 60,
      createdById: opts.createdById,
      opportunityId: opts.opportunityId ?? null,
      contactId: opts.contactId ?? null,
      crmOrganisationId: opts.crmOrganisationId ?? null,
    })
    .returning();
  return call.id;
}

async function makeRecording(opts: {
  callId: string;
  status?: string;
  transcript?: string | null;
}) {
  const [rec] = await db
    .insert(crmCallRecordings)
    .values({
      callId: opts.callId,
      recordingUrl: `https://example.invalid/${Math.random().toString(36).slice(2)}.mp3`,
      durationSeconds: 30,
      transcript: opts.transcript ?? null,
      transcriptStatus: opts.status ?? "PENDING",
    })
    .returning();
  return rec.id;
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  // --- Primary org: admin + non-admin user ---
  const primary = await makeOrgAndAdmin("primary");
  orgId = primary.orgId;
  adminUserId = primary.adminUserId;
  adminCookie = `auth_token=${generateToken(primary.adminUser.id, primary.adminUser.tokenVersion)}`;

  const [fw] = await db
    .insert(users)
    .values({
      email: `primary-field-${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      passwordHash: "x",
      firstName: "Primary",
      lastName: "Field",
      organizationId: orgId,
      role: "FIELD_WORKER",
    })
    .returning();
  fieldWorkerUserId = fw.id;
  fieldWorkerCookie = `auth_token=${generateToken(fw.id, fw.tokenVersion)}`;

  // --- Secondary org used to prove cross-org isolation ---
  const other = await makeOrgAndAdmin("other");
  otherOrgId = other.orgId;
  otherAdminUserId = other.adminUserId;
  otherAdminCookie = `auth_token=${generateToken(
    other.adminUser.id,
    other.adminUser.tokenVersion,
  )}`;

  // --- Seed CRM org / contact / opportunity for primary org ---
  const [cOrg] = await db
    .insert(crmOrganisations)
    .values({
      organizationId: orgId,
      name: `Pending Endpoint Co ${SUFFIX}`,
      type: "CONTRACTOR",
      createdById: adminUserId,
    })
    .returning();
  const [contact] = await db
    .insert(crmContacts)
    .values({
      organizationId: orgId,
      organisationId: cOrg.id,
      firstName: "Pending",
      lastName: `Tester ${SUFFIX}`,
      email: `pending+${SUFFIX}@${TEST_EMAIL_DOMAIN}`,
      role: "PM",
      createdById: adminUserId,
    })
    .returning();
  const [opp] = await db
    .insert(crmOpportunities)
    .values({
      organizationId: orgId,
      organisationId: cOrg.id,
      contactId: contact.id,
      name: `Pending Opp ${SUFFIX}`,
      stage: "LEAD",
      createdById: adminUserId,
    })
    .returning();

  // Call WITH an opportunity → its eligible recording should report
  // opportunityId in the row.
  const callWithOpp = await makeCall({
    organizationId: orgId,
    createdById: adminUserId,
    opportunityId: opp.id,
    contactId: contact.id,
    crmOrganisationId: cOrg.id,
  });
  // Call WITHOUT an opportunity → its eligible recording should still
  // appear, but with opportunityId === null.
  const callWithoutOpp = await makeCall({
    organizationId: orgId,
    createdById: adminUserId,
  });

  // -- Eligible recordings (transcript NULL, status PENDING/FAILED) --
  recordingWithOpportunityId = await makeRecording({
    callId: callWithOpp,
    status: "PENDING",
  });
  eligibleIds.push(recordingWithOpportunityId);

  recordingWithoutOpportunityId = await makeRecording({
    callId: callWithoutOpp,
    status: "FAILED",
  });
  eligibleIds.push(recordingWithoutOpportunityId);

  // A second eligible PENDING on the with-opp call so we can prove
  // pagination (limit=1) still returns total=3.
  const extraPendingId = await makeRecording({
    callId: callWithOpp,
    status: "PENDING",
  });
  eligibleIds.push(extraPendingId);

  // -- Ineligible recordings (must NEVER appear) --
  // Already-transcribed: transcript NOT NULL, even if status PENDING.
  await makeRecording({
    callId: callWithOpp,
    status: "PENDING",
    transcript: "already done",
  });
  // Status COMPLETED.
  await makeRecording({ callId: callWithOpp, status: "COMPLETED" });
  // Status IN_PROGRESS.
  await makeRecording({ callId: callWithOpp, status: "IN_PROGRESS" });

  // -- Cross-org noise: an eligible recording in the OTHER org --
  const otherCall = await makeCall({
    organizationId: otherOrgId,
    createdById: otherAdminUserId,
  });
  await makeRecording({ callId: otherCall, status: "PENDING" });
  await makeRecording({ callId: otherCall, status: "FAILED" });
}, 60_000);

afterAll(async () => {
  try {
    await db
      .delete(crmCallRecordings)
      .where(
        sql`${crmCallRecordings.callId} IN (
          SELECT ${crmCalls.id} FROM ${crmCalls}
          WHERE ${crmCalls.organizationId} IN (${orgId}, ${otherOrgId})
        )`,
      )
      .catch(() => {});
    await db
      .delete(crmCalls)
      .where(inArray(crmCalls.organizationId, [orgId, otherOrgId]))
      .catch(() => {});
    await db
      .delete(crmOpportunities)
      .where(inArray(crmOpportunities.organizationId, [orgId, otherOrgId]))
      .catch(() => {});
    await db
      .delete(crmContacts)
      .where(inArray(crmContacts.organizationId, [orgId, otherOrgId]))
      .catch(() => {});
    await db
      .delete(crmOrganisations)
      .where(inArray(crmOrganisations.organizationId, [orgId, otherOrgId]))
      .catch(() => {});
    await db
      .delete(users)
      .where(
        inArray(users.id, [adminUserId, fieldWorkerUserId, otherAdminUserId]),
      )
      .catch(() => {});
    await db
      .delete(organizations)
      .where(inArray(organizations.id, [orgId, otherOrgId]))
      .catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("GET /api/crm/calls/transcripts/backfill/pending", () => {
  it("returns exactly the eligible recordings (transcript NULL + PENDING/FAILED) for the caller's org", async () => {
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 100, offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(eligibleIds.length);
    expect(res.body.limit).toBe(100);
    expect(res.body.offset).toBe(0);

    const returnedIds = (res.body.recordings as Array<{ recordingId: string }>)
      .map((r) => r.recordingId)
      .sort();
    expect(returnedIds).toEqual([...eligibleIds].sort());

    // Spot-check the row shape.
    const sample = (res.body.recordings as Array<Record<string, unknown>>)[0];
    expect(sample).toHaveProperty("recordingId");
    expect(sample).toHaveProperty("callId");
    expect(sample).toHaveProperty("transcriptStatus");
    expect(["PENDING", "FAILED"]).toContain(sample.transcriptStatus);
  });

  it("does not leak recordings from other organizations", async () => {
    // Sanity: the other-org admin sees only their org's eligible rows
    // (we seeded 2 there) and never any of ours.
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", otherAdminCookie)
      .query({ limit: 100, offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    const returnedIds = (res.body.recordings as Array<{ recordingId: string }>).map(
      (r) => r.recordingId,
    );
    for (const id of eligibleIds) {
      expect(returnedIds).not.toContain(id);
    }
  });

  it("includes recordings whose call has no opportunity (with opportunityId null)", async () => {
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 100, offset: 0 });

    expect(res.status).toBe(200);
    const rows = res.body.recordings as Array<{
      recordingId: string;
      opportunityId: string | null;
    }>;

    const noOppRow = rows.find((r) => r.recordingId === recordingWithoutOpportunityId);
    expect(noOppRow).toBeDefined();
    expect(noOppRow!.opportunityId).toBeNull();

    const withOppRow = rows.find((r) => r.recordingId === recordingWithOpportunityId);
    expect(withOppRow).toBeDefined();
    expect(withOppRow!.opportunityId).not.toBeNull();
  });

  it("paginates with limit/offset while reporting the unfiltered total", async () => {
    const page1 = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 1, offset: 0 });
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(eligibleIds.length);
    expect(page1.body.limit).toBe(1);
    expect(page1.body.offset).toBe(0);
    expect(page1.body.recordings).toHaveLength(1);

    const page2 = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 1, offset: 1 });
    expect(page2.status).toBe(200);
    expect(page2.body.total).toBe(eligibleIds.length);
    expect(page2.body.recordings).toHaveLength(1);

    const page3 = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 1, offset: 2 });
    expect(page3.status).toBe(200);
    expect(page3.body.recordings).toHaveLength(1);

    // Across the three pages we should have seen each eligible id once,
    // with no duplicates and no leakage of ineligible rows.
    const allReturned = [
      ...page1.body.recordings,
      ...page2.body.recordings,
      ...page3.body.recordings,
    ].map((r: { recordingId: string }) => r.recordingId);
    expect(new Set(allReturned).size).toBe(eligibleIds.length);
    for (const id of allReturned) {
      expect(eligibleIds).toContain(id);
    }

    // Offset past the end → empty page, total unchanged.
    const empty = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 10, offset: 999 });
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(eligibleIds.length);
    expect(empty.body.recordings).toEqual([]);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get(
      "/api/crm/calls/transcripts/backfill/pending",
    );
    expect(res.status).toBe(401);
  });

  it("rejects non-ADMIN callers with 403", async () => {
    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", fieldWorkerCookie);
    expect(res.status).toBe(403);
  });
});

// Confirm the endpoint mirrors fetchEligibleRecordingBatch (the worker uses
// it to decide what to enqueue). If these two diverge, admins triaging a
// reaped backfill see a different list than what a fresh backfill would
// actually process — the exact regression Task #1028 is meant to prevent.
describe("pending endpoint mirrors fetchEligibleRecordingBatch", () => {
  it("returns the same set of recording ids as fetchEligibleRecordingBatch for the same org", async () => {
    const { fetchEligibleRecordingBatch } = await import("../crmCallsRoutes");

    const res = await request(app)
      .get("/api/crm/calls/transcripts/backfill/pending")
      .set("Cookie", adminCookie)
      .query({ limit: 100, offset: 0 });
    expect(res.status).toBe(200);

    const endpointIds = (res.body.recordings as Array<{ recordingId: string }>)
      .map((r) => r.recordingId)
      .sort();
    const workerIds = (await fetchEligibleRecordingBatch(orgId, new Set(), 100))
      .slice()
      .sort();

    expect(endpointIds).toEqual(workerIds);
  });
});
