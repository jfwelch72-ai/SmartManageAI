/**
 * Task #1814 — End-to-end coverage for the group / ungroup Undo
 * round-trips that fan out through
 * `POST /api/plan-documents/:docId/markup-group-assignments`.
 *
 * The plan markup layer's undo stack handles five action types
 * (`move`, `create`, `delete`, `group`, `ungroup`). Tasks #1725 and
 * #1739 already cover the `move` round-trip end-to-end, and #1737 / the
 * sibling `plan-document-markups-undo-roundtrip.test.ts` exercises the
 * delete / restore path. Group membership undo, however, only had
 * client-side helper coverage — a regression in
 * `/markup-group-assignments` (or its persistence path) would let a
 * Ctrl+Z silently merge formerly-distinct groups into one, or fail to
 * restore membership at all, without a single server test catching it.
 *
 * Each case below mirrors the contract `PlanMarkupLayer` enforces in
 * `dispatchUndo`:
 *   - For `ungroup`, `onMutate` snapshots each member's existing
 *     `groupId` (filtering out members that were already null since
 *     they contribute nothing inverse-mutation-wise) and the undo
 *     replays those snapshots verbatim, so each markup must land back
 *     in its ORIGINAL group — even if those groups were distinct.
 *   - For `group`, the new `groupId` is shared across all members but
 *     each member's `previousGroupId` is captured per-row, so the undo
 *     must restore a heterogeneous mix (some null, some pointing at a
 *     pre-existing group) without merging them.
 *
 * The fixture / tenant scaffolding intentionally mirrors the sibling
 * `plan-document-markups-undo-roundtrip.test.ts` so the two suites read
 * the same way and share the same cleanup contract.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { sql, inArray } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  planDocuments,
  planDocumentMarkups,
} from "@shared/schema";
import { generateToken } from "../auth";

const TEST_PREFIX = "__plandoc_groupundo_e2e__";

interface MarkupResponse {
  id: string;
  planDocumentId: string;
  tool: string;
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
  text: string | null;
  groupId: string | null;
}

interface Tenant {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  docId: string;
}

let app: Express;
let server: Server;
let tenant: Tenant;

function apiPost(path: string, token: string, body?: Record<string, unknown>) {
  const r = request(app).post(path).set("Cookie", `auth_token=${token}`);
  if (body) r.send(body).set("Content-Type", "application/json");
  return r;
}

async function setupTenant(label: string): Promise<Tenant> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db.insert(organizations).values({
    name: `PD GroupUndo ${label}`,
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

  const token = generateToken(admin.id, admin.tokenVersion ?? 0);

  const [project] = await db.insert(projects).values({
    code: `${slug}-PRJ`,
    name: `PD GroupUndo Project ${label}`,
    clientName: `PD GroupUndo Client ${label}`,
    gcOrganizationId: org.id,
  }).returning();

  const [doc] = await db.insert(planDocuments).values({
    projectId: project.id,
    organizationId: org.id,
    scope: "PROJECT",
    type: "PLANS",
    title: `Doc ${label}`,
    fileName: `groupundo-${label}.pdf`,
    fileUrl: `https://example.com/groupundo-${label}.pdf`,
    uploadedById: admin.id,
  }).returning();

  return {
    orgId: org.id,
    userId: admin.id,
    token,
    projectId: project.id,
    docId: doc.id,
  };
}

async function cleanup(): Promise<void> {
  const orgs = await db.execute<{ id: string }>(
    sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
  );
  const rows = orgs.rows;
  for (const { id: orgId } of rows) {
    const projSub = sql`(SELECT id FROM projects WHERE gc_organization_id = ${orgId})`;
    const docSub = sql`(SELECT id FROM plan_documents WHERE project_id IN ${projSub})`;
    await db.execute(sql`DELETE FROM plan_document_markups WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_pins WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_markup_layer_visibility WHERE layer_id IN (SELECT id FROM plan_markup_layers WHERE plan_document_id IN ${docSub})`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_markup_layers WHERE plan_document_id IN ${docSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM plan_documents WHERE project_id IN ${projSub}`).catch(() => {});
    await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
    await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
  }
}

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  tenant = await setupTenant("groupundo");
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

/**
 * Read each markup's raw `group_id` column straight from the DB and
 * return a Map<id, groupId|null>. We intentionally bypass the API list
 * route here so a regression that happens to round-trip through the
 * read path (e.g. a stray transformer or default) cannot mask a real
 * persistence bug.
 */
async function readGroupIdsFromDb(
  ids: string[],
): Promise<Map<string, string | null>> {
  const rows = await db
    .select({ id: planDocumentMarkups.id, groupId: planDocumentMarkups.groupId })
    .from(planDocumentMarkups)
    .where(inArray(planDocumentMarkups.id, ids));
  const out = new Map<string, string | null>();
  for (const r of rows) out.set(r.id, r.groupId ?? null);
  return out;
}

async function createMarkup(
  pageNumber: number,
  points: Array<{ x: number; y: number }>,
): Promise<MarkupResponse> {
  const res = await apiPost(
    `/api/plan-documents/${tenant.docId}/markups`,
    tenant.token,
    { pageNumber, tool: "ARROW", points },
  );
  expect(res.status).toBe(201);
  return res.body as MarkupResponse;
}

describe("plan_document_markups — group/ungroup Undo round-trips through POST /markup-group-assignments (Task #1814)", () => {
  it("undoing an ungroup that spanned two distinct groups restores each markup's ORIGINAL group_id (no merging)", async () => {
    // Seed four markups split across two pre-existing groups so the
    // ungroup-then-undo path has something heterogeneous to restore.
    // If a regression makes the undo replay the wrong groupId, members
    // {a, b} would land in the same (or different-from-original) group
    // as {c, d} — exactly the "silent merge" the task description
    // warns about. We deliberately use four members (not three) so
    // both pre-existing groups satisfy the forward route's >=2-member
    // minimum and the test exercises the live group-creation path
    // instead of seeding group_id directly.
    const a = await createMarkup(10, [{ x: 0.10, y: 0.10 }, { x: 0.15, y: 0.15 }]);
    const b = await createMarkup(10, [{ x: 0.20, y: 0.20 }, { x: 0.25, y: 0.25 }]);
    const c = await createMarkup(10, [{ x: 0.30, y: 0.30 }, { x: 0.35, y: 0.35 }]);
    const d = await createMarkup(10, [{ x: 0.40, y: 0.40 }, { x: 0.45, y: 0.45 }]);

    // Group {a, b} — one round-trip through the live forward route so
    // the test exercises the same group-id assignment path the UI uses.
    const groupAB = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [a.id, b.id] },
    );
    expect(groupAB.status).toBe(200);
    expect(groupAB.body.ok).toBe(true);
    const groupIdAB = groupAB.body.groupId as string;
    expect(typeof groupIdAB).toBe("string");

    // Group {c, d} — a SECOND, distinct group. Proving the two
    // groupIds differ is what lets the final assertion catch a "silent
    // merge" regression where the undo collapses both groups into one.
    const groupCD = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [c.id, d.id] },
    );
    expect(groupCD.status).toBe(200);
    const groupIdCD = groupCD.body.groupId as string;
    expect(typeof groupIdCD).toBe("string");
    expect(groupIdCD).not.toEqual(groupIdAB);

    // Sanity check: the DB matches what the forward routes told us.
    const beforeUngroup = await readGroupIdsFromDb([a.id, b.id, c.id, d.id]);
    expect(beforeUngroup.get(a.id)).toEqual(groupIdAB);
    expect(beforeUngroup.get(b.id)).toEqual(groupIdAB);
    expect(beforeUngroup.get(c.id)).toEqual(groupIdCD);
    expect(beforeUngroup.get(d.id)).toEqual(groupIdCD);

    // Capture the per-member previousGroupId snapshot the same way
    // PlanMarkupLayer's `ungroupMutation.onMutate` does. The client
    // filters members whose previousGroupId is null (they contribute
    // nothing to the inverse mutation); here every member is grouped
    // so all four are in the snapshot.
    const ungroupSnapshot: Array<{ id: string; previousGroupId: string }> = [
      { id: a.id, previousGroupId: groupIdAB },
      { id: b.id, previousGroupId: groupIdAB },
      { id: c.id, previousGroupId: groupIdCD },
      { id: d.id, previousGroupId: groupIdCD },
    ];

    // Forward ungroup — clears group_id on all four members in one
    // request, just like the toolbar's Ungroup button.
    const ungroup = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-ungroup`,
      tenant.token,
      { markupIds: [a.id, b.id, c.id, d.id] },
    );
    expect(ungroup.status).toBe(200);
    expect(ungroup.body.ok).toBe(true);
    expect(ungroup.body.count).toBe(4);

    // Sanity check: the ungroup actually mutated the DB so the undo
    // step has something to restore.
    const afterUngroup = await readGroupIdsFromDb([a.id, b.id, c.id, d.id]);
    expect(afterUngroup.get(a.id)).toBeNull();
    expect(afterUngroup.get(b.id)).toBeNull();
    expect(afterUngroup.get(c.id)).toBeNull();
    expect(afterUngroup.get(d.id)).toBeNull();

    // Undo — replay the captured snapshot through the same
    // `/markup-group-assignments` route the layer's
    // `groupAssignMutation` posts to, mapping previousGroupId to the
    // route's `groupId` field exactly as `dispatchUndo` does.
    const undo = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-group-assignments`,
      tenant.token,
      {
        assignments: ungroupSnapshot.map((s) => ({
          id: s.id,
          groupId: s.previousGroupId,
        })),
      },
    );
    expect(undo.status).toBe(200);
    expect(undo.body.ok).toBe(true);
    expect(undo.body.count).toBe(4);

    // The DB `group_id` columns must equal the ORIGINAL pre-ungroup
    // values — including the fact that {a, b} share one groupId and
    // {c, d} share a *different* groupId. Asserting both the per-row
    // mapping AND the cross-row distinctness catches a regression that
    // (a) restored everything to the wrong group, or (b) silently
    // merged the two groups into one new one.
    const afterUndo = await readGroupIdsFromDb([a.id, b.id, c.id, d.id]);
    expect(afterUndo.get(a.id)).toEqual(groupIdAB);
    expect(afterUndo.get(b.id)).toEqual(groupIdAB);
    expect(afterUndo.get(c.id)).toEqual(groupIdCD);
    expect(afterUndo.get(d.id)).toEqual(groupIdCD);
    expect(afterUndo.get(a.id)).not.toEqual(afterUndo.get(c.id));
  });

  it("undoing a group that pulled in a mix of ungrouped + already-grouped members restores each previousGroupId (some null, some pointing at a pre-existing group)", async () => {
    // Three new markups on a fresh page. d starts ungrouped, e + f
    // start in their own pre-existing group. After the forward Group
    // action all three share a brand-new groupId; the undo must put
    // d back to null and put e + f back into their original group —
    // not into the new group, and not into nothing.
    const d = await createMarkup(11, [{ x: 0.40, y: 0.40 }, { x: 0.45, y: 0.45 }]);
    const e = await createMarkup(11, [{ x: 0.50, y: 0.50 }, { x: 0.55, y: 0.55 }]);
    const f = await createMarkup(11, [{ x: 0.60, y: 0.60 }, { x: 0.65, y: 0.65 }]);

    // Pre-existing group {e, f}. d is intentionally left ungrouped so
    // the captured previousGroupId snapshot is heterogeneous.
    const groupEF = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [e.id, f.id] },
    );
    expect(groupEF.status).toBe(200);
    const groupIdEF = groupEF.body.groupId as string;
    expect(typeof groupIdEF).toBe("string");

    // Sanity check the seeded baseline.
    const baseline = await readGroupIdsFromDb([d.id, e.id, f.id]);
    expect(baseline.get(d.id)).toBeNull();
    expect(baseline.get(e.id)).toEqual(groupIdEF);
    expect(baseline.get(f.id)).toEqual(groupIdEF);

    // Capture the per-member snapshot the same way PlanMarkupLayer's
    // `groupMutation.onMutate` does — one entry per id with the prior
    // groupId (or null) preserved verbatim.
    const previousGroupIds: Array<{ id: string; previousGroupId: string | null }> = [
      { id: d.id, previousGroupId: null },
      { id: e.id, previousGroupId: groupIdEF },
      { id: f.id, previousGroupId: groupIdEF },
    ];

    // Forward group — pulls all three into a brand-new groupId. The
    // route returns the freshly-minted groupId so we can assert the
    // forward step actually mutated the DB.
    const groupForward = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-groups`,
      tenant.token,
      { markupIds: [d.id, e.id, f.id] },
    );
    expect(groupForward.status).toBe(200);
    const newGroupId = groupForward.body.groupId as string;
    expect(typeof newGroupId).toBe("string");
    expect(newGroupId).not.toEqual(groupIdEF);

    const afterGroup = await readGroupIdsFromDb([d.id, e.id, f.id]);
    expect(afterGroup.get(d.id)).toEqual(newGroupId);
    expect(afterGroup.get(e.id)).toEqual(newGroupId);
    expect(afterGroup.get(f.id)).toEqual(newGroupId);

    // Undo — replay the snapshot through `/markup-group-assignments`
    // exactly as `dispatchUndo` does for a `group` history entry. The
    // critical contract here is per-row: d -> null, e -> groupIdEF,
    // f -> groupIdEF. A regression that hard-coded a single groupId
    // (or that lost the null) would surface here.
    const undo = await apiPost(
      `/api/plan-documents/${tenant.docId}/markup-group-assignments`,
      tenant.token,
      {
        assignments: previousGroupIds.map((p) => ({
          id: p.id,
          groupId: p.previousGroupId,
        })),
      },
    );
    expect(undo.status).toBe(200);
    expect(undo.body.ok).toBe(true);
    expect(undo.body.count).toBe(3);

    // The DB must now match the baseline exactly: d is back to NULL
    // (not pointing at any group), and e + f are back in their
    // ORIGINAL pre-group groupIdEF — not in the new merged group.
    const afterUndo = await readGroupIdsFromDb([d.id, e.id, f.id]);
    expect(afterUndo.get(d.id)).toBeNull();
    expect(afterUndo.get(e.id)).toEqual(groupIdEF);
    expect(afterUndo.get(f.id)).toEqual(groupIdEF);

    // Cross-check: the new merged groupId from the forward step is
    // GONE from every member, proving the route really did per-row
    // assignments and didn't just leave the new id in place anywhere.
    expect(afterUndo.get(d.id)).not.toEqual(newGroupId);
    expect(afterUndo.get(e.id)).not.toEqual(newGroupId);
    expect(afterUndo.get(f.id)).not.toEqual(newGroupId);
  });
});
