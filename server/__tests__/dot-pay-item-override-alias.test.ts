// Task #1171 — Tests for the alias-saving flow on the pay-item picker.
// Covers:
//   • POST /api/dot/pay-item-overrides with internalAlias makes the next
//     /api/dot/pay-items/match call return matchReason "alias" (score >= 1.0).
//   • POST upsert path: an existing override with customDescription gets the
//     alias merged in without wiping any sibling fields.
//   • DELETE /api/dot/pay-item-overrides/:id returns 404 when the org doesn't
//     own the row, 204 when it does, and the cached GET reflects the deletion.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  dotPayItemOverrides,
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setAllFeatureFlags } from "../services/featureFlagService";

const PREFIX = "__dotalias__";
const EDITION_PREFIX = "_da_";

let app: Express;
let tokenA: string;
let tokenB: string;
let orgAId: string;
let orgBId: string;
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
    await db.delete(dotPayItemOverrides).where(inArray(dotPayItemOverrides.organizationId, orgIds)).catch(() => {});
  }
  await db.delete(dotPayItems).where(sql`${dotPayItems.itemNumber} LIKE ${PREFIX + "%"}`).catch(() => {});
  await db.delete(dotSpecBooks).where(sql`${dotSpecBooks.edition} LIKE ${EDITION_PREFIX + "%"}`).catch(() => {});
  await db.delete(dotAgencies).where(sql`${dotAgencies.code} LIKE ${PREFIX + "%"}`).catch(() => {});
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

async function seedOrg(label: string): Promise<{ orgId: string; token: string }> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: `Alias Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Alias",
      lastName: `User-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  await setAllFeatureFlags(org.id, { DOT_PAY_ITEMS: true } as Record<FeatureFlagKey, boolean>);
  return { orgId: org.id, token: generateToken(user.id, user.tokenVersion ?? 0) };
}

async function insertItem(number: string, description: string, unit: string, category: string): Promise<string> {
  const itemNumber = `${PREFIX}${number}`;
  const [row] = await db
    .insert(dotPayItems)
    .values({ specBookId, agencyId, itemNumber, description, unit, category, isActive: true })
    .returning();
  itemIds[number] = row.id;
  return row.id;
}

beforeAll(async () => {
  await cleanup();

  ({ orgId: orgAId, token: tokenA } = await seedOrg("A"));
  ({ orgId: orgBId, token: tokenB } = await seedOrg("B"));

  const [agency] = await db
    .insert(dotAgencies)
    .values({ code: `${PREFIX}AG-${Date.now()}`, name: "Alias DOT", fullName: "Alias DOT", kind: "STATE_DOT" })
    .returning();
  agencyId = agency.id;
  const [book] = await db
    .insert(dotSpecBooks)
    .values({ agencyId, edition: `${EDITION_PREFIX}1`, title: "Alias Book" })
    .returning();
  specBookId = book.id;

  await insertItem("X100", "Curb and gutter type B", "LF", "Concrete");
  await insertItem("X200", "Riprap class III", "TON", "Erosion control");

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

const cookieFor = (token: string) => `auth_token=${token}`;

describe("DOT pay-item override alias-saving flow", () => {
  it("makes the next match call return matchReason 'alias' after saving an internalAlias", async () => {
    // The alias text shares zero tokens with any seeded description, so it
    // can only top the ranking through the alias path.
    const aliasText = "quibble flange marker";
    const payItemId = itemIds["X100"];

    const post = await request(app)
      .post("/api/dot/pay-item-overrides")
      .set("Cookie", cookieFor(tokenA))
      .send({ payItemId, internalAlias: aliasText });
    expect([200, 201]).toContain(post.status);
    expect(post.body.payItemId).toBe(payItemId);
    expect(post.body.internalAlias).toBe(aliasText);

    const matchRes = await request(app)
      .post("/api/dot/pay-items/match")
      .set("Cookie", cookieFor(tokenA))
      .send({ description: aliasText, agencyIds: [agencyId] });
    expect(matchRes.status).toBe(200);
    const matches = matchRes.body.matches as Array<{
      payItem: { id: string };
      score: number;
      matchReason: "alias" | "fuzzy";
      aliasText: string | null;
    }>;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].payItem.id).toBe(payItemId);
    expect(matches[0].matchReason).toBe("alias");
    expect(matches[0].aliasText).toBe(aliasText);
    expect(matches[0].score).toBeGreaterThanOrEqual(1.0);
  });

  it("merges internalAlias into an existing override without wiping customDescription", async () => {
    const payItemId = itemIds["X200"];
    const originalDescription = "Heavy riprap (org-specific naming)";

    // Seed an override that already carries a customDescription + notes.
    const seed = await request(app)
      .post("/api/dot/pay-item-overrides")
      .set("Cookie", cookieFor(tokenA))
      .send({ payItemId, customDescription: originalDescription, notes: "keep me" });
    expect([200, 201]).toContain(seed.status);
    const seededId = seed.body.id as string;

    // Save an alias against the same pay item — the upsert should merge, not replace.
    const aliasText = "wobbly stones";
    const upsert = await request(app)
      .post("/api/dot/pay-item-overrides")
      .set("Cookie", cookieFor(tokenA))
      .send({ payItemId, internalAlias: aliasText });
    expect([200, 201]).toContain(upsert.status);
    expect(upsert.body.id).toBe(seededId); // same row, not a duplicate
    expect(upsert.body.internalAlias).toBe(aliasText);
    expect(upsert.body.customDescription).toBe(originalDescription);
    expect(upsert.body.notes).toBe("keep me");

    // And confirm the row in the DB also reflects both fields.
    const [persisted] = await db
      .select()
      .from(dotPayItemOverrides)
      .where(and(
        eq(dotPayItemOverrides.organizationId, orgAId),
        eq(dotPayItemOverrides.payItemId, payItemId),
      ));
    expect(persisted.internalAlias).toBe(aliasText);
    expect(persisted.customDescription).toBe(originalDescription);
    expect(persisted.notes).toBe("keep me");
  });

  it("DELETE returns 404 cross-org, 204 in-org, and invalidates the cached list", async () => {
    // Create a fresh override owned by org A on a brand-new pay item so the
    // delete is isolated from the other tests in this file.
    await insertItem("X300", "Pavement marking arrow", "EA", "Markings");
    const payItemId = itemIds["X300"];

    const created = await request(app)
      .post("/api/dot/pay-item-overrides")
      .set("Cookie", cookieFor(tokenA))
      .send({ payItemId, internalAlias: "left arrow" });
    expect([200, 201]).toContain(created.status);
    const overrideId = created.body.id as string;

    // Prime the cached GET response for org A.
    const listBefore = await request(app)
      .get("/api/dot/pay-item-overrides")
      .set("Cookie", cookieFor(tokenA));
    expect(listBefore.status).toBe(200);
    expect((listBefore.body as Array<{ id: string }>).some((r) => r.id === overrideId)).toBe(true);

    // Org B tries to delete org A's row — should 404 and leave the row intact.
    const crossOrg = await request(app)
      .delete(`/api/dot/pay-item-overrides/${overrideId}`)
      .set("Cookie", cookieFor(tokenB));
    expect(crossOrg.status).toBe(404);
    const [stillThere] = await db
      .select()
      .from(dotPayItemOverrides)
      .where(eq(dotPayItemOverrides.id, overrideId));
    expect(stillThere).toBeDefined();

    // The row's owning org deletes it — should 204.
    const ownDelete = await request(app)
      .delete(`/api/dot/pay-item-overrides/${overrideId}`)
      .set("Cookie", cookieFor(tokenA));
    expect(ownDelete.status).toBe(204);
    const [gone] = await db
      .select()
      .from(dotPayItemOverrides)
      .where(eq(dotPayItemOverrides.id, overrideId));
    expect(gone).toBeUndefined();

    // The cached GET must reflect the deletion immediately. If the cache were
    // not invalidated by DELETE, the prior list would still include overrideId.
    const listAfter = await request(app)
      .get("/api/dot/pay-item-overrides")
      .set("Cookie", cookieFor(tokenA));
    expect(listAfter.status).toBe(200);
    expect((listAfter.body as Array<{ id: string }>).some((r) => r.id === overrideId)).toBe(false);
  });
});
