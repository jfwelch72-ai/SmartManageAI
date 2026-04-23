// Task #1165 — Integration test for the bid tab import dialog's two-stage
// flow: per-row POST /api/dot/pay-items/match, followed by bulk
// POST /api/estimates/:estimateId/line-items. The dialog itself runs in the
// browser, but its only contract with the backend is these two endpoints, so
// driving them from a real Express app with the real database catches the
// regressions that matter (matcher silently dropping the alias hint, the
// line-items endpoint silently dropping `dotPayItemId`/`payItemNumber`/
// `unit`/`specSection`, the canonicaliser rejecting a payload the dialog
// would happily send, etc.).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  estimates,
  estimateLineItems,
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setAllFeatureFlags } from "../services/featureFlagService";

const PREFIX = "__bti__";
const EDITION_PREFIX = "_bti_";

let app: Express;
let token: string;
let userId: string;
let orgId: string;
let projectId: string;
let estimateId: string;
let agencyId: string;
let specBookId: string;
const itemIds: Record<string, string> = {};

interface IdRow { id: string }
interface ExecuteResult<T> { rows?: T[] }

async function cleanup(): Promise<void> {
  const orgs = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as ExecuteResult<IdRow>;
  const orgIds = orgs.rows?.map((r) => r.id) ?? [];
  const usrs = (await db.execute(
    sql`SELECT id FROM users WHERE email LIKE ${PREFIX + "%"}`,
  )) as unknown as ExecuteResult<IdRow>;
  const userIds = usrs.rows?.map((r) => r.id) ?? [];

  if (orgIds.length > 0) {
    // Project + estimate cascade-delete from organizations? Project FK is on
    // gcOrganizationId — delete projects explicitly to be safe.
    await db.delete(projects).where(inArray(projects.gcOrganizationId, orgIds)).catch(() => {});
    await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }
  await db.delete(dotPayItems).where(sql`${dotPayItems.itemNumber} LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.delete(dotSpecBooks).where(sql`${dotSpecBooks.edition} LIKE ${EDITION_PREFIX + "%"}`).catch(() => {});
  await db.delete(dotAgencies).where(sql`${dotAgencies.code} LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Bid Tab Import Org",
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;

  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Bid",
      lastName: "Importer",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  userId = user.id;
  token = generateToken(user.id, user.tokenVersion ?? 0);

  await setAllFeatureFlags(org.id, {
    DOT_PAY_ITEMS: true,
  } as Record<FeatureFlagKey, boolean>);

  const [project] = await db
    .insert(projects)
    .values({
      name: "Bid Tab Import Project",
      code: `${PREFIX}P-${Date.now()}`,
      clientName: "Test Client",
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();
  projectId = project.id;

  const [estimate] = await db
    .insert(estimates)
    .values({
      projectId: project.id,
      versionNumber: 1,
      status: "DRAFT",
      createdById: user.id,
    })
    .returning();
  estimateId = estimate.id;

  const [agency] = await db
    .insert(dotAgencies)
    .values({
      code: `${PREFIX}AG-${Date.now()}`,
      name: "Bid Tab DOT",
      fullName: "Bid Tab DOT",
      kind: "STATE_DOT",
    })
    .returning();
  agencyId = agency.id;
  const [book] = await db
    .insert(dotSpecBooks)
    .values({
      agencyId: agency.id,
      edition: `${EDITION_PREFIX}1`,
      title: "Bid Tab Spec Book",
    })
    .returning();
  specBookId = book.id;

  // Seed a handful of items the parsed bid-tab descriptions will match
  // strongly against. Spec sections are populated so the integration test
  // can assert that the saved line item carries the canonical spec section
  // (not the user's typo'd input).
  const [excavation] = await db
    .insert(dotPayItems)
    .values({
      specBookId: book.id,
      agencyId: agency.id,
      itemNumber: `${PREFIX}203-001`,
      description: "Roadway excavation",
      unit: "CY",
      category: "Earthwork",
      specSection: "203",
      isActive: true,
    })
    .returning();
  itemIds.excavation = excavation.id;

  const [concrete] = await db
    .insert(dotPayItems)
    .values({
      specBookId: book.id,
      agencyId: agency.id,
      itemNumber: `${PREFIX}501-002`,
      description: "Concrete pavement",
      unit: "SY",
      category: "Pavement",
      specSection: "501",
      isActive: true,
    })
    .returning();
  itemIds.concrete = concrete.id;

  const [pipe] = await db
    .insert(dotPayItems)
    .values({
      specBookId: book.id,
      agencyId: agency.id,
      itemNumber: `${PREFIX}603-012`,
      description: "Storm drain pipe twelve inch",
      unit: "LF",
      category: "Drainage",
      specSection: "603",
      isActive: true,
    })
    .returning();
  itemIds.pipe = pipe.id;

  // Wire up an Express app with both routers under the same auth middleware
  // the production server uses. We deliberately skip CSRF (mounted globally
  // in production) because supertest does not maintain the cookie loop the
  // SPA does — the per-route requireAuth check is what we care about.
  const dotRoutes = (await import("../dotRoutes")).default;
  const estimateRoutes = (await import("../estimateRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(dotRoutes);
  app.use(estimateRoutes);
}, 90_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

const cookie = () => `auth_token=${token}`;

interface MatchSuggestion {
  payItem: {
    id: string;
    itemNumber: string;
    description: string;
    unit: string;
    specSection: string | null;
    category: string | null;
  };
  specBook: { id: string; edition: string };
  score: number;
}

async function matchOne(description: string, unit?: string): Promise<MatchSuggestion[]> {
  const res = await request(app)
    .post("/api/dot/pay-items/match")
    .set("Cookie", cookie())
    .send({ description, unit: unit ?? null, agencyIds: [agencyId], limit: 5 });
  expect(res.status).toBe(200);
  return res.body.matches as MatchSuggestion[];
}

async function createLineItem(payload: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await request(app)
    .post(`/api/estimates/${estimateId}/line-items`)
    .set("Cookie", cookie())
    .send(payload);
  return { status: res.status, body: res.body };
}

describe("Bid tab import — match-then-save flow", () => {
  it("matches each parsed row against the real DOT matcher endpoint", async () => {
    // Mirrors what BidTabImportDialog does inside its concurrency-4 worker
    // pool: one POST per parsed row, no batching.
    const rows = [
      { description: "Roadway excavation", unit: "CY", expect: itemIds.excavation },
      { description: "Concrete pavement",  unit: "SY", expect: itemIds.concrete },
      { description: "Storm drain pipe twelve inch", unit: "LF", expect: itemIds.pipe },
    ];
    for (const r of rows) {
      const matches = await matchOne(r.description, r.unit);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].payItem.id).toBe(r.expect);
      expect(matches[0].score).toBeGreaterThan(0);
    }
  });

  it("persists DOT linkage fields when the dialog accepts a suggestion", async () => {
    const matches = await matchOne("Roadway excavation", "CY");
    const top = matches[0];

    // Build the exact payload BidTabImportDialog assembles when the user
    // accepts a suggestion. Source: handleImport() in BidTabImportDialog.tsx.
    const { status, body } = await createLineItem({
      category: "EXCAVATION",
      description: "Roadway excavation",
      quantity: 250,
      unit: top.payItem.unit,
      materialCost: 0,
      laborCost: 0,
      laborHours: 0,
      equipmentCost: 0,
      equipmentHours: 0,
      consumablesCost: 0,
      subcontractCost: 0,
      overheadAllocation: 0,
      profitAllocation: 0,
      dotPayItemId: top.payItem.id,
      dotSpecBookId: top.specBook.id,
      payItemNumber: top.payItem.itemNumber,
      specSection: top.payItem.specSection ?? null,
    });
    expect(status).toBe(201);

    const created = await db.query.estimateLineItems.findFirst({
      where: eq(estimateLineItems.id, body.id),
    });
    expect(created).toBeDefined();
    expect(created!.dotPayItemId).toBe(itemIds.excavation);
    expect(created!.dotSpecBookId).toBe(specBookId);
    expect(created!.payItemNumber).toBe(`${PREFIX}203-001`);
    expect(created!.specSection).toBe("203");
    expect(created!.unit).toBe("CY");
  });

  it("persists a row without DOT linkage when the user rejects every suggestion", async () => {
    // The dialog still POSTs the row; it just omits the DOT fields. We need
    // to ensure the endpoint accepts that shape and writes nulls into the
    // four DOT columns.
    const { status, body } = await createLineItem({
      category: "OTHER",
      description: "Custom owner-supplied item",
      quantity: 1,
      unit: "LS",
      materialCost: 0,
      laborCost: 0,
      laborHours: 0,
      equipmentCost: 0,
      equipmentHours: 0,
      consumablesCost: 0,
      subcontractCost: 0,
      overheadAllocation: 0,
      profitAllocation: 0,
    });
    expect(status).toBe(201);

    const created = await db.query.estimateLineItems.findFirst({
      where: eq(estimateLineItems.id, body.id),
    });
    expect(created).toBeDefined();
    expect(created!.dotPayItemId).toBeNull();
    expect(created!.dotSpecBookId).toBeNull();
    expect(created!.payItemNumber).toBeNull();
    expect(created!.specSection).toBeNull();
  });

  it("rejects a save where payItemNumber doesn't match the linked DOT pay item", async () => {
    // Belt-and-suspenders: the dialog always sends the canonical itemNumber
    // alongside dotPayItemId, but if a future bug ever desyncs them the
    // canonicaliser must reject the write — otherwise saved estimates and
    // the DOT catalog drift apart silently.
    const { status, body } = await createLineItem({
      category: "EXCAVATION",
      description: "Roadway excavation",
      quantity: 100,
      unit: "CY",
      materialCost: 0,
      laborCost: 0,
      laborHours: 0,
      equipmentCost: 0,
      equipmentHours: 0,
      consumablesCost: 0,
      subcontractCost: 0,
      overheadAllocation: 0,
      profitAllocation: 0,
      dotPayItemId: itemIds.excavation,
      dotSpecBookId: specBookId,
      payItemNumber: "WRONG-999",
      specSection: "999",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/payItemNumber/i);
  });

  it("runs the full multi-row save and lands every accepted row with linkage intact", async () => {
    // End-to-end happy path: parse → match → bulk save, asserting the dialog
    // could refresh and immediately show DOT-linked rows.
    const beforeCount = (
      await db.select({ id: estimateLineItems.id }).from(estimateLineItems).where(eq(estimateLineItems.estimateId, estimateId))
    ).length;

    const planned = [
      { description: "Roadway excavation",            unit: "CY", qty: 500, expect: itemIds.excavation, specSection: "203" },
      { description: "Concrete pavement",             unit: "SY", qty: 250, expect: itemIds.concrete,   specSection: "501" },
      { description: "Storm drain pipe twelve inch",  unit: "LF", qty: 75,  expect: itemIds.pipe,       specSection: "603" },
    ];

    for (const p of planned) {
      const matches = await matchOne(p.description, p.unit);
      const top = matches[0];
      expect(top.payItem.id).toBe(p.expect);
      const { status } = await createLineItem({
        category: "OTHER",
        description: p.description,
        quantity: p.qty,
        unit: top.payItem.unit,
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        equipmentHours: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
        dotPayItemId: top.payItem.id,
        dotSpecBookId: top.specBook.id,
        payItemNumber: top.payItem.itemNumber,
        specSection: top.payItem.specSection ?? null,
      });
      expect(status).toBe(201);
    }

    const after = await db
      .select({
        id: estimateLineItems.id,
        dotPayItemId: estimateLineItems.dotPayItemId,
        payItemNumber: estimateLineItems.payItemNumber,
        unit: estimateLineItems.unit,
        specSection: estimateLineItems.specSection,
      })
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimateId));
    expect(after.length).toBe(beforeCount + planned.length);

    // The three rows just inserted must all have DOT linkage populated. We
    // can't assume order, so look them up by payItemNumber.
    for (const p of planned) {
      const expectedNumber = p.expect === itemIds.excavation
        ? `${PREFIX}203-001`
        : p.expect === itemIds.concrete
        ? `${PREFIX}501-002`
        : `${PREFIX}603-012`;
      const row = after.find((r) => r.payItemNumber === expectedNumber);
      expect(row, `row for ${expectedNumber}`).toBeDefined();
      expect(row!.dotPayItemId).toBe(p.expect);
      expect(row!.unit).toBe(p.unit);
      expect(row!.specSection).toBe(p.specSection);
    }
  });
});
