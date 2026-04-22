// Task #1113 — Tests for the DOT pay-item auto-match endpoint.
// Verifies the ranking heuristic in POST /api/dot/pay-items/match:
//   • org alias overrides outrank fuzzy matches
//   • exact item-number mention boosts the right item to #1
//   • unit + category boosts elevate same-overlap candidates
//   • org preferred agencies are honoured when no agencyIds are passed

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  dotPayItemOverrides,
  organizationDotPreferences,
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setAllFeatureFlags } from "../services/featureFlagService";

const PREFIX = "__dotmatch__";
const EDITION_PREFIX = "_dm_";

let app: Express;
let userToken: string;
let orgId: string;
let agencyAId: string;
let agencyBId: string;
let specBookAId: string;
let specBookBId: string;
let itemIds: Record<string, string> = {};

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
    await db.delete(dotPayItemOverrides).where(inArray(dotPayItemOverrides.organizationId, orgIds)).catch(() => {});
    await db.delete(organizationDotPreferences).where(inArray(organizationDotPreferences.organizationId, orgIds)).catch(() => {});
  }
  await db.delete(dotPayItems).where(sql`${dotPayItems.itemNumber} LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.delete(dotSpecBooks).where(sql`${dotSpecBooks.edition} LIKE ${EDITION_PREFIX + "%"}`).catch(() => {});
  await db.delete(dotAgencies).where(sql`${dotAgencies.code} LIKE ${PREFIX + "%"}`).catch(() => {});
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

async function insertItem(
  agencyId: string,
  specBookId: string,
  number: string,
  description: string,
  unit: string,
  category: string,
): Promise<string> {
  const itemNumber = `${PREFIX}${number}`;
  const [row] = await db
    .insert(dotPayItems)
    .values({
      specBookId,
      agencyId,
      itemNumber,
      description,
      unit,
      category,
      isActive: true,
    })
    .returning();
  itemIds[number] = row.id;
  return row.id;
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `Match Org`, slug, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true })
    .returning();
  orgId = org.id;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Match",
      lastName: "User",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  userToken = generateToken(user.id, user.tokenVersion ?? 0);
  await setAllFeatureFlags(org.id, { DOT_PAY_ITEMS: true } as Record<FeatureFlagKey, boolean>);

  const [agencyA] = await db
    .insert(dotAgencies)
    .values({ code: `${PREFIX}AG-A-${Date.now()}`, name: "Match DOT A", fullName: "Match DOT A", kind: "STATE_DOT" })
    .returning();
  agencyAId = agencyA.id;
  const [agencyB] = await db
    .insert(dotAgencies)
    .values({ code: `${PREFIX}AG-B-${Date.now()}`, name: "Match DOT B", fullName: "Match DOT B", kind: "STATE_DOT" })
    .returning();
  agencyBId = agencyB.id;

  const [bookA] = await db
    .insert(dotSpecBooks)
    .values({ agencyId: agencyAId, edition: `${EDITION_PREFIX}A1`, title: "Match Book A" })
    .returning();
  specBookAId = bookA.id;
  const [bookB] = await db
    .insert(dotSpecBooks)
    .values({ agencyId: agencyBId, edition: `${EDITION_PREFIX}B1`, title: "Match Book B" })
    .returning();
  specBookBId = bookB.id;

  await insertItem(agencyAId, specBookAId, "A001", "Roadway excavation", "CY", "Earthwork");
  await insertItem(agencyAId, specBookAId, "A002", "Concrete pavement", "SY", "Pavement");
  await insertItem(agencyAId, specBookAId, "A003", "Storm drain pipe twelve inch", "LF", "Drainage");
  await insertItem(agencyAId, specBookAId, "A004", "Asphalt binder course", "TON", "Asphalt");
  await insertItem(agencyAId, specBookAId, "A005", "Embankment fill compacted", "CY", "Earthwork");

  await insertItem(agencyBId, specBookBId, "B001", "Roadway excavation common borrow", "CY", "Earthwork");
  await insertItem(agencyBId, specBookBId, "B002", "Concrete pavement", "CY", "Earthwork");

  // Alias override: bind A005 ("Embankment fill compacted") to a custom alias
  // that will rank it above unrelated competitors in test #1.
  await db.insert(dotPayItemOverrides).values({
    organizationId: orgId,
    payItemId: itemIds["A005"],
    internalAlias: "zillophonic widget special",
  });

  const dotRoutes = (await import("../dotRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(dotRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

const cookie = () => `auth_token=${userToken}`;

async function match(body: Record<string, unknown>) {
  const res = await request(app)
    .post("/api/dot/pay-items/match")
    .set("Cookie", cookie())
    .send(body);
  expect(res.status).toBe(200);
  return res.body.matches as Array<{
    payItem: { id: string; itemNumber: string; description: string };
    score: number;
    matchReason: "alias" | "fuzzy";
    aliasText: string | null;
  }>;
}

describe("DOT pay-item auto-match ranking", () => {
  it("ranks an alias-overridden item above stronger fuzzy matches", async () => {
    const matches = await match({
      description: "zillophonic widget special concrete pavement",
      agencyIds: [agencyAId, agencyBId],
    });
    expect(matches.length).toBeGreaterThan(0);
    const top = matches[0];
    expect(top.payItem.id).toBe(itemIds["A005"]);
    expect(top.matchReason).toBe("alias");
    expect(top.aliasText).toBe("zillophonic widget special");
    // The alias boost (+1.0) must outrank pure-overlap "Concrete pavement" hits.
    const a002 = matches.find((m) => m.payItem.id === itemIds["A002"]);
    if (a002) expect(top.score).toBeGreaterThan(a002.score);
  });

  it("promotes an item whose number is mentioned verbatim in the description", async () => {
    // A002 ("Concrete pavement") shares zero descriptive words with the query;
    // it should still rank #1 because the exact item number appears.
    const target = `${PREFIX}A002`;
    const matches = await match({
      description: `Use ${target} for the south ramp section`,
      agencyIds: [agencyAId, agencyBId],
    });
    expect(matches[0].payItem.id).toBe(itemIds["A002"]);
    expect(matches[0].payItem.itemNumber).toBe(target);
  });

  it("applies unit and category boosts to break ties between identical descriptions", async () => {
    // Both A002 and B002 are "Concrete pavement" with identical token overlap.
    // A002 (unit=SY, category=Pavement) should beat B002 (unit=CY, category=Earthwork)
    // when the caller specifies unit=SY, category=Pavement.
    const matches = await match({
      description: "Concrete pavement",
      unit: "SY",
      category: "Pavement",
      agencyIds: [agencyAId, agencyBId],
    });
    const a = matches.find((m) => m.payItem.id === itemIds["A002"]);
    const b = matches.find((m) => m.payItem.id === itemIds["B002"]);
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(a!.score).toBeGreaterThan(b!.score);
    expect(matches[0].payItem.id).toBe(itemIds["A002"]);
  });

  it("respects org-preferred agencies when no agencyIds are passed", async () => {
    // Mark agency A as the org's preferred agency. Items in agency B should
    // be excluded from the candidate pool entirely.
    const [pref] = await db
      .insert(organizationDotPreferences)
      .values({ organizationId: orgId, agencyId: agencyAId, isDefault: true })
      .returning();
    try {
      const matches = await match({ description: "Roadway excavation" });
      expect(matches.length).toBeGreaterThan(0);
      const agencyIds = new Set(matches.map((m) => m.payItem.id));
      expect(agencyIds.has(itemIds["A001"])).toBe(true);
      expect(agencyIds.has(itemIds["B001"])).toBe(false);
      // Sanity-check: removing the preference puts B-agency items back in play.
      await db.delete(organizationDotPreferences).where(inArray(organizationDotPreferences.id, [pref.id]));
      const matches2 = await match({ description: "Roadway excavation" });
      const ids2 = new Set(matches2.map((m) => m.payItem.id));
      expect(ids2.has(itemIds["B001"])).toBe(true);
    } finally {
      await db
        .delete(organizationDotPreferences)
        .where(inArray(organizationDotPreferences.id, [pref.id]))
        .catch(() => {});
    }
  });
});
