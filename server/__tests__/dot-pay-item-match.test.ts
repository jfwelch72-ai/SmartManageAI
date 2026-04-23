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
  dotPayItemMatchHistory,
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
    await db.delete(dotPayItemMatchHistory).where(inArray(dotPayItemMatchHistory.organizationId, orgIds)).catch(() => {});
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
    matchReason: "alias" | "fuzzy" | "history";
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

  it("boosts items the org has previously accepted for the same description", async () => {
    // Baseline: with no history, "Concrete pavement" returns A002 first (better
    // unit/category overlap is absent here, so order is determined by token
    // overlap and id/tie-breakers).
    const baseline = await match({
      description: "Concrete pavement",
      agencyIds: [agencyAId, agencyBId],
    });
    const baselineB002 = baseline.find((m) => m.payItem.id === itemIds["B002"]);
    expect(baselineB002).toBeDefined();

    // Record three accepts for B002 against this exact description.
    const fbRes = await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", cookie())
      .send({
        decisions: Array.from({ length: 3 }, () => ({
          description: "Concrete pavement",
          payItemId: itemIds["B002"],
          accepted: true,
        })),
      });
    expect(fbRes.status).toBe(200);
    expect(fbRes.body.recorded).toBe(3);

    try {
      const after = await match({
        description: "Concrete pavement",
        agencyIds: [agencyAId, agencyBId],
      });
      const b002After = after.find((m) => m.payItem.id === itemIds["B002"]);
      expect(b002After).toBeDefined();
      expect(b002After!.score).toBeGreaterThan(baselineB002!.score);
      // matchReason flips to "history" once accepts dominate the score.
      expect(b002After!.matchReason).toBe("history");
    } finally {
      await db
        .delete(dotPayItemMatchHistory)
        .where(inArray(dotPayItemMatchHistory.organizationId, [orgId]))
        .catch(() => {});
    }
  });

  it("exposes top auto-matches with sample descriptions and alias status", async () => {
    await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", cookie())
      .send({
        decisions: [
          { description: "Roadway excavation north", payItemId: itemIds["A001"], accepted: true },
          { description: "Roadway excavation south", payItemId: itemIds["A001"], accepted: true },
          { description: "Storm drain pipe 12 inch", payItemId: itemIds["A003"], accepted: true },
        ],
      })
      .expect(200);

    try {
      const res = await request(app)
        .get("/api/dot/pay-items/match-history/top?limit=10")
        .set("Cookie", cookie());
      expect(res.status).toBe(200);
      const items = res.body.items as Array<{
        payItem: { id: string };
        acceptCount: number;
        rejectCount: number;
        sampleDescriptions: string[];
        hasAlias: boolean;
      }>;
      const a001 = items.find((i) => i.payItem.id === itemIds["A001"]);
      const a003 = items.find((i) => i.payItem.id === itemIds["A003"]);
      expect(a001).toBeDefined();
      expect(a001!.acceptCount).toBeGreaterThanOrEqual(2);
      expect(a001!.sampleDescriptions.length).toBeGreaterThan(0);
      expect(a001!.hasAlias).toBe(false);
      expect(a003).toBeDefined();
      expect(a003!.hasAlias).toBe(false);
      // Items already aliased should still be reported but flagged.
      const a005 = items.find((i) => i.payItem.id === itemIds["A005"]);
      if (a005) expect(a005.hasAlias).toBe(true);
    } finally {
      await db
        .delete(dotPayItemMatchHistory)
        .where(inArray(dotPayItemMatchHistory.organizationId, [orgId]))
        .catch(() => {});
    }
  });

  // Task #1249 — additional history-aware ranking + isolation cases.

  it("rejects suppress an item that would otherwise win on token overlap", async () => {
    const baseline = await match({
      description: "Concrete pavement",
      agencyIds: [agencyAId, agencyBId],
    });
    const baselineA002 = baseline.find((m) => m.payItem.id === itemIds["A002"]);
    const baselineB002 = baseline.find((m) => m.payItem.id === itemIds["B002"]);
    expect(baselineA002).toBeDefined();
    expect(baselineB002).toBeDefined();

    const fb = await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", cookie())
      .send({
        decisions: Array.from({ length: 4 }, () => ({
          description: "Concrete pavement",
          payItemId: itemIds["A002"],
          accepted: false,
        })),
      });
    expect(fb.status).toBe(200);

    try {
      const after = await match({
        description: "Concrete pavement",
        agencyIds: [agencyAId, agencyBId],
      });
      const a002After = after.find((m) => m.payItem.id === itemIds["A002"]);
      const b002After = after.find((m) => m.payItem.id === itemIds["B002"]);
      expect(a002After).toBeDefined();
      expect(b002After).toBeDefined();
      // A002's score must drop below baseline thanks to the reject penalty,
      // and B002 (no history) must now rank above it.
      expect(a002After!.score).toBeLessThan(baselineA002!.score);
      expect(b002After!.score).toBeGreaterThan(a002After!.score);
    } finally {
      await db
        .delete(dotPayItemMatchHistory)
        .where(inArray(dotPayItemMatchHistory.organizationId, [orgId]))
        .catch(() => {});
    }
  });

  it("only applies the per-agency boost when the recorded agency matches the candidate's agency", async () => {
    // Matching agency: B002 in agency B, accept tagged with agency B.
    await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", cookie())
      .send({
        decisions: [{
          description: "Concrete pavement",
          payItemId: itemIds["B002"],
          agencyId: agencyBId,
          accepted: true,
        }],
      })
      .expect(200);

    const matchedAgency = await match({
      description: "Concrete pavement",
      agencyIds: [agencyAId, agencyBId],
    });
    const matchedAgencyB002 = matchedAgency.find((m) => m.payItem.id === itemIds["B002"]);
    expect(matchedAgencyB002).toBeDefined();

    await db
      .delete(dotPayItemMatchHistory)
      .where(inArray(dotPayItemMatchHistory.organizationId, [orgId]));

    // Mismatched agency: same payItem (B002) but accept tagged with agency A.
    // Same-description boost still applies (same payItem); per-agency +0.15
    // must NOT fire because B002.agencyId !== agencyA.
    await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", cookie())
      .send({
        decisions: [{
          description: "Concrete pavement",
          payItemId: itemIds["B002"],
          agencyId: agencyAId,
          accepted: true,
        }],
      })
      .expect(200);

    try {
      const mismatchedAgency = await match({
        description: "Concrete pavement",
        agencyIds: [agencyAId, agencyBId],
      });
      const mismatchedB002 = mismatchedAgency.find((m) => m.payItem.id === itemIds["B002"]);
      expect(mismatchedB002).toBeDefined();
      const delta = matchedAgencyB002!.score - mismatchedB002!.score;
      // Scores are rounded to 2 decimals; the +0.15 agency boost is the only
      // difference between the two runs.
      expect(delta).toBeGreaterThan(0.1);
      expect(delta).toBeLessThan(0.2);
    } finally {
      await db
        .delete(dotPayItemMatchHistory)
        .where(inArray(dotPayItemMatchHistory.organizationId, [orgId]))
        .catch(() => {});
    }
  });

  it("the top endpoint never returns history rows from another organization", async () => {
    const otherSlug = `${PREFIX}org2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "Other Match Org", slug: otherSlug, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true })
      .returning();
    const otherPasswordHash = await bcrypt.hash("TestPass123!", 10);
    const [otherUser] = await db
      .insert(users)
      .values({
        email: `${otherSlug}@test.local`,
        passwordHash: otherPasswordHash,
        firstName: "Other",
        lastName: "User",
        role: "ADMIN",
        organizationId: otherOrg.id,
        isActive: true,
      })
      .returning();
    const otherToken = generateToken(otherUser.id, otherUser.tokenVersion ?? 0);
    await setAllFeatureFlags(otherOrg.id, { DOT_PAY_ITEMS: true } as Record<FeatureFlagKey, boolean>);
    const otherCookie = `auth_token=${otherToken}`;

    await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", otherCookie)
      .send({
        decisions: Array.from({ length: 5 }, () => ({
          description: "Roadway excavation common borrow",
          payItemId: itemIds["B001"],
          accepted: true,
        })),
      })
      .expect(200);

    await request(app)
      .post("/api/dot/pay-items/match/feedback")
      .set("Cookie", cookie())
      .send({
        decisions: [{
          description: "Roadway excavation",
          payItemId: itemIds["A001"],
          accepted: true,
        }],
      })
      .expect(200);

    try {
      const ours = await request(app)
        .get("/api/dot/pay-items/match-history/top?limit=50")
        .set("Cookie", cookie());
      expect(ours.status).toBe(200);
      const ourItems = ours.body.items as Array<{ payItem: { id: string }; acceptCount: number }>;
      const ourB001 = ourItems.find((i) => i.payItem.id === itemIds["B001"]);
      // Either B001 is absent, or its accept count must not include the other
      // org's 5 entries (proving the org filter held).
      if (ourB001) expect(ourB001.acceptCount).toBeLessThan(5);
      expect(ourItems.some((i) => i.payItem.id === itemIds["A001"])).toBe(true);

      const theirs = await request(app)
        .get("/api/dot/pay-items/match-history/top?limit=50")
        .set("Cookie", otherCookie);
      expect(theirs.status).toBe(200);
      const theirItems = theirs.body.items as Array<{ payItem: { id: string }; acceptCount: number }>;
      const theirB001 = theirItems.find((i) => i.payItem.id === itemIds["B001"]);
      expect(theirB001).toBeDefined();
      expect(theirB001!.acceptCount).toBe(5);
      expect(theirItems.some((i) => i.payItem.id === itemIds["A001"])).toBe(false);
    } finally {
      await db
        .delete(dotPayItemMatchHistory)
        .where(inArray(dotPayItemMatchHistory.organizationId, [orgId, otherOrg.id]))
        .catch(() => {});
      await db.delete(users).where(inArray(users.id, [otherUser.id])).catch(() => {});
      await db.delete(organizations).where(inArray(organizations.id, [otherOrg.id])).catch(() => {});
    }
  });

  it("returns 403 from both new endpoints when the DOT_PAY_ITEMS feature flag is off", async () => {
    await setAllFeatureFlags(orgId, { DOT_PAY_ITEMS: false } as Record<FeatureFlagKey, boolean>);
    try {
      const fb = await request(app)
        .post("/api/dot/pay-items/match/feedback")
        .set("Cookie", cookie())
        .send({
          decisions: [{
            description: "Concrete pavement",
            payItemId: itemIds["A002"],
            accepted: true,
          }],
        });
      expect(fb.status).toBe(403);
      expect(fb.body.featureFlag).toBe("DOT_PAY_ITEMS");

      const top = await request(app)
        .get("/api/dot/pay-items/match-history/top")
        .set("Cookie", cookie());
      expect(top.status).toBe(403);
      expect(top.body.featureFlag).toBe("DOT_PAY_ITEMS");
    } finally {
      await setAllFeatureFlags(orgId, { DOT_PAY_ITEMS: true } as Record<FeatureFlagKey, boolean>);
    }
  });
});
