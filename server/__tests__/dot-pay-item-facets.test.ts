// Task #1110 — Tests for the DOT pay-item facets endpoint and the
// multi-select category / spec-section filtering on /api/dot/pay-items.

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
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import { setAllFeatureFlags } from "../services/featureFlagService";

const PREFIX = "__dot_facets__";

let app: Express;
let userToken: string;
let specBookId: string;

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
  await db
    .delete(dotPayItems)
    .where(sql`${dotPayItems.itemNumber} LIKE ${PREFIX + "%"}`)
    .catch(() => {});
  await db
    .delete(dotSpecBooks)
    .where(sql`${dotSpecBooks.edition} LIKE ${PREFIX + "%"}`)
    .catch(() => {});
  await db
    .delete(dotAgencies)
    .where(sql`${dotAgencies.code} LIKE ${PREFIX + "%"}`)
    .catch(() => {});
  if (userIds.length > 0) await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  if (orgIds.length > 0) await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

beforeAll(async () => {
  await cleanup();

  const slug = `${PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `Facets Org`, slug, tradeType: "GENERAL_CONTRACTOR", onboardingStatus: "COMPLETED", isActive: true })
    .returning();
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Facets",
      lastName: "User",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  userToken = generateToken({ userId: user.id, email: user.email, role: user.role, organizationId: org.id });
  await setAllFeatureFlags(org.id, { DOT_PAY_ITEMS: true } as Record<FeatureFlagKey, boolean>);

  const [agency] = await db
    .insert(dotAgencies)
    .values({ code: `${PREFIX}AG-${Date.now()}`, name: "Facet DOT", fullName: "Facet DOT", kind: "STATE_DOT" })
    .returning();
  const [book] = await db
    .insert(dotSpecBooks)
    .values({ agencyId: agency.id, edition: `${PREFIX}-1`, title: "Facet Spec Book" })
    .returning();
  specBookId = book.id;

  const items = [
    { number: "EW-001", desc: "Embankment fill", category: "Earthwork", section: "203" },
    { number: "EW-002", desc: "Borrow excavation", category: "Earthwork", section: "203" },
    { number: "EW-003", desc: "Topsoil strip", category: "Earthwork", section: "204" },
    { number: "AS-001", desc: "Asphalt surface course", category: "Asphalt", section: "401" },
    { number: "AS-002", desc: "Asphalt binder course", category: "Asphalt", section: "401" },
    { number: "DR-001", desc: "Storm drain pipe", category: "Drainage", section: "603" },
  ];
  for (const it of items) {
    await db.insert(dotPayItems).values({
      specBookId,
      agencyId: agency.id,
      itemNumber: `${PREFIX}${it.number}`,
      description: it.desc,
      unit: "CY",
      category: it.category,
      specSection: it.section,
      isActive: true,
    });
  }

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

describe("DOT pay-item facets", () => {
  it("returns distinct category counts for the spec book", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items/facets?specBookId=${specBookId}`)
      .set("Cookie", cookie());
    expect(res.status).toBe(200);
    const cats = (res.body.categories as Array<{ value: string; count: number }>).reduce<Record<string, number>>(
      (m, c) => ({ ...m, [c.value]: c.count }),
      {},
    );
    expect(cats.Earthwork).toBe(3);
    expect(cats.Asphalt).toBe(2);
    expect(cats.Drainage).toBe(1);
  });

  it("returns distinct spec-section counts for the spec book", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items/facets?specBookId=${specBookId}`)
      .set("Cookie", cookie());
    expect(res.status).toBe(200);
    const secs = (res.body.specSections as Array<{ value: string; count: number }>).reduce<Record<string, number>>(
      (m, c) => ({ ...m, [c.value]: c.count }),
      {},
    );
    expect(secs["203"]).toBe(2);
    expect(secs["204"]).toBe(1);
    expect(secs["401"]).toBe(2);
    expect(secs["603"]).toBe(1);
  });

  it("rejects facet requests with no scope", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items/facets`)
      .set("Cookie", cookie());
    expect(res.status).toBe(400);
  });

  it("filters pay-items by a single category via the multi-select param", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items?specBookId=${specBookId}&categories=Earthwork`)
      .set("Cookie", cookie());
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ category: string }>;
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.category === "Earthwork")).toBe(true);
  });

  it("filters pay-items by multiple categories (OR semantics)", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items?specBookId=${specBookId}&categories=Earthwork,Drainage`)
      .set("Cookie", cookie());
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ category: string }>;
    expect(rows.length).toBe(4);
    expect(new Set(rows.map((r) => r.category))).toEqual(new Set(["Earthwork", "Drainage"]));
  });

  it("filters pay-items by a single spec section", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items?specBookId=${specBookId}&specSections=401`)
      .set("Cookie", cookie());
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ specSection: string }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.specSection === "401")).toBe(true);
  });

  it("combines category + section filters", async () => {
    const res = await request(app)
      .get(`/api/dot/pay-items?specBookId=${specBookId}&categories=Earthwork&specSections=203`)
      .set("Cookie", cookie());
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ specSection: string; category: string }>;
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.category === "Earthwork" && r.specSection === "203")).toBe(true);
  });
});
