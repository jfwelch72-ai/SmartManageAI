// Task #488 — Integration tests for the security guards on the new
// DOT/heavy-civil endpoints in server/dotRoutes.ts.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  crmOrganisations,
  auditLog,
  dotAgencies,
  dotSpecBooks,
  dotPayItems,
  type FeatureFlagKey,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setAllFeatureFlags } from "../services/featureFlagService";
import { exportLimiter } from "../rateLimiter";

const PREFIX = "__dot_sec__";

interface TenantCtx {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  crmOrgId: string;
}

let app: Express;
let tenantOn: TenantCtx;
let tenantOff: TenantCtx;
let superAdmin: { userId: string; token: string };
let sharedSpecBookId: string;

const ALL_NEW_FLAGS: FeatureFlagKey[] = [
  "DOT_PAY_ITEMS",
  "DBE_TRACKING",
  "HAUL_TICKETS",
  "DAILY_INSPECTOR_REPORTS",
  "SWPPP_INSPECTIONS",
  "SURETY_BONDS",
  "BUY_AMERICA",
];

async function seedTenant(label: string): Promise<TenantCtx> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `DotSec Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash,
      firstName: "Dot",
      lastName: `Admin-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `DotSec Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}`,
      clientName: `DotSec Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [crmOrg] = await db
    .insert(crmOrganisations)
    .values({
      name: `DotSec CRM ${label}`,
      organizationId: org.id,
      type: "VENDOR",
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);

  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    crmOrgId: crmOrg.id,
  };
}

async function seedSuperAdmin(): Promise<{ userId: string; token: string }> {
  const passwordHash = await bcrypt.hash("TestPass123!", 10);
  const [user] = await db
    .insert(users)
    .values({
      email: `${PREFIX}super-${Date.now()}@test.local`,
      passwordHash,
      firstName: "Dot",
      lastName: "Super",
      role: "SUPER_ADMIN",
      organizationId: null,
      isActive: true,
    })
    .returning();
  return { userId: user.id, token: generateToken(user.id, user.tokenVersion ?? 0) };
}

async function seedSharedDotPayItem(): Promise<{ specBookId: string }> {
  const [agency] = await db
    .insert(dotAgencies)
    .values({
      code: `${PREFIX}AG-${Date.now()}`,
      name: "Test Agency",
      fullName: "Test DOT Agency",
      kind: "STATE_DOT",
    })
    .returning();
  const [specBook] = await db
    .insert(dotSpecBooks)
    .values({
      agencyId: agency.id,
      edition: `${PREFIX}-1`,
      title: "Test Spec Book",
    })
    .returning();
  return { specBookId: specBook.id };
}

interface IdRow { id: string }
interface ExecuteResult<T> { rows?: T[] }

async function cleanup(): Promise<void> {
  const orgs = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as ExecuteResult<IdRow>;
  const orgIds: string[] = orgs.rows?.map((r) => r.id) ?? [];
  const userRows = (await db.execute(
    sql`SELECT id FROM users WHERE email LIKE ${PREFIX + "%"}`,
  )) as unknown as ExecuteResult<IdRow>;
  const userIds: string[] = userRows.rows?.map((r) => r.id) ?? [];

  if (userIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.userId, userIds)).catch(() => {});
  }
  if (orgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
  }
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }
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
}

beforeAll(async () => {
  await cleanup();

  const dotRoutes = (await import("../dotRoutes")).default;
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(dotRoutes);

  [tenantOn, tenantOff, superAdmin] = await Promise.all([
    seedTenant("on"),
    seedTenant("off"),
    seedSuperAdmin(),
  ]);
  ({ specBookId: sharedSpecBookId } = await seedSharedDotPayItem());

  await setAllFeatureFlags(
    tenantOn.orgId,
    Object.fromEntries(ALL_NEW_FLAGS.map((k) => [k, true])) as Record<FeatureFlagKey, boolean>,
  );
  await setAllFeatureFlags(
    tenantOff.orgId,
    Object.fromEntries(ALL_NEW_FLAGS.map((k) => [k, false])) as Record<FeatureFlagKey, boolean>,
  );
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(() => {
  exportLimiter.resetKey(`user:${superAdmin.userId}`);
});

function authCookie(token: string): string {
  return `auth_token=${token}`;
}

interface RawResponse { status: number; body: Record<string, unknown> }
interface RawRequestOptions {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

function rawRequest(port: number, opts: RawRequestOptions): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, method: opts.method, path: opts.path, headers: opts.headers },
      (resp) => {
        const chunks: Buffer[] = [];
        resp.on("data", (c: Buffer) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: Record<string, unknown> = {};
          try {
            const json: unknown = JSON.parse(text);
            if (json && typeof json === "object") parsed = json as Record<string, unknown>;
          } catch {
            parsed = { raw: text };
          }
          resolve({ status: resp.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(opts.body);
    req.end();
  });
}

async function countAuditRows(
  userId: string,
  entityType: string,
  entityId: string,
  action: "CREATE" | "UPDATE" | "DELETE",
): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.userId, userId),
        eq(auditLog.entityType, entityType),
        eq(auditLog.entityId, entityId),
        eq(auditLog.action, action),
      ),
    );
  return rows.length;
}

interface PrefixCase {
  name: string;
  flag: FeatureFlagKey;
  readPath: (ctx: TenantCtx) => string;
}

const PREFIX_CASES: PrefixCase[] = [
  { name: "DOT pay items",            flag: "DOT_PAY_ITEMS",           readPath: () => "/api/dot/pay-items" },
  { name: "DBE goals",                flag: "DBE_TRACKING",            readPath: (c) => `/api/projects/${c.projectId}/dbe-goals` },
  { name: "Surety bonds",             flag: "SURETY_BONDS",            readPath: () => "/api/surety-bonds" },
  { name: "Haul tickets",             flag: "HAUL_TICKETS",            readPath: () => "/api/haul-tickets" },
  { name: "Daily inspector reports",  flag: "DAILY_INSPECTOR_REPORTS", readPath: () => "/api/daily-inspector-reports" },
  { name: "SWPPP inspections",        flag: "SWPPP_INSPECTIONS",       readPath: () => "/api/swppp-inspections" },
  { name: "Material certifications",  flag: "BUY_AMERICA",             readPath: () => "/api/material-certifications" },
];

describe("DOT endpoint security guards — feature-flag matrix", () => {
  for (const c of PREFIX_CASES) {
    describe(`${c.name} (flag=${c.flag})`, () => {
      it("returns 403 with upgradeRequired when the org flag is off", async () => {
        const res = await request(app)
          .get(c.readPath(tenantOff))
          .set("Cookie", authCookie(tenantOff.token));
        expect(res.status).toBe(403);
        expect(res.body).toMatchObject({ upgradeRequired: true });
        expect(res.body.featureFlag ?? c.flag).toBe(c.flag);
      });

      it("returns 200 when the flag is on and the caller has the right permission", async () => {
        const res = await request(app)
          .get(c.readPath(tenantOn))
          .set("Cookie", authCookie(tenantOn.token));
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
      });

      it("lets SUPER_ADMIN bypass the flag entirely", async () => {
        const res = await request(app)
          .get(c.readPath(tenantOff))
          .set("Cookie", authCookie(superAdmin.token));
        expect(res.status).toBe(200);
      });
    });
  }
});

describe("DOT endpoint security guards — audit logging", () => {
  it("writes CREATE / UPDATE / DELETE audit rows for surety bonds", async () => {
    const create = await request(app)
      .post("/api/surety-bonds")
      .set("Cookie", authCookie(tenantOn.token))
      .send({
        projectId: tenantOn.projectId,
        bondType: "BID",
        bondNumber: `${PREFIX}BOND-${Date.now()}`,
        suretyCompany: "ACME Surety",
        bondAmount: "10000.00",
      });
    expect(create.status).toBe(201);
    const bondId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "surety_bond", bondId, "CREATE")).toBe(1);

    const patch = await request(app)
      .patch(`/api/surety-bonds/${bondId}`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ notes: "audit-test" });
    expect(patch.status).toBe(200);
    expect(await countAuditRows(tenantOn.userId, "surety_bond", bondId, "UPDATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/surety-bonds/${bondId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "surety_bond", bondId, "DELETE")).toBe(1);
  });

  it("writes CREATE / UPDATE / DELETE audit rows for haul tickets", async () => {
    const create = await request(app)
      .post("/api/haul-tickets")
      .set("Cookie", authCookie(tenantOn.token))
      .send({
        projectId: tenantOn.projectId,
        ticketNumber: `${PREFIX}HT-${Date.now()}`,
        ticketDate: "2026-04-22",
        materialClass: "ASPHALT",
        quantity: "12.500",
        unit: "TON",
      });
    expect(create.status).toBe(201);
    const ticketId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "haul_ticket", ticketId, "CREATE")).toBe(1);

    const patch = await request(app)
      .patch(`/api/haul-tickets/${ticketId}`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ notes: "audit-test" });
    expect(patch.status).toBe(200);
    expect(await countAuditRows(tenantOn.userId, "haul_ticket", ticketId, "UPDATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/haul-tickets/${ticketId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "haul_ticket", ticketId, "DELETE")).toBe(1);
  });

  it("writes CREATE + DELETE audit rows for daily inspector reports", async () => {
    const create = await request(app)
      .post("/api/daily-inspector-reports")
      .set("Cookie", authCookie(tenantOn.token))
      .send({
        projectId: tenantOn.projectId,
        reportDate: `2026-05-${String((Math.floor(Math.random() * 27) + 1)).padStart(2, "0")}`,
        inspectorName: "Inspector McTest",
      });
    expect(create.status).toBe(201);
    const idrId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "daily_inspector_report", idrId, "CREATE")).toBe(1);

    const patch = await request(app)
      .patch(`/api/daily-inspector-reports/${idrId}`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ workPerformed: "audit-test" });
    expect(patch.status).toBe(200);
    expect(await countAuditRows(tenantOn.userId, "daily_inspector_report", idrId, "UPDATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/daily-inspector-reports/${idrId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "daily_inspector_report", idrId, "DELETE")).toBe(1);
  });

  it("writes CREATE / UPDATE / DELETE audit rows for SWPPP inspections", async () => {
    const create = await request(app)
      .post("/api/swppp-inspections")
      .set("Cookie", authCookie(tenantOn.token))
      .send({
        projectId: tenantOn.projectId,
        inspectionDate: "2026-04-22",
        inspectionType: "ROUTINE",
      });
    expect(create.status).toBe(201);
    const inspId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "swppp_inspection", inspId, "CREATE")).toBe(1);

    const patch = await request(app)
      .patch(`/api/swppp-inspections/${inspId}`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ notes: "audit-test" });
    expect(patch.status).toBe(200);
    expect(await countAuditRows(tenantOn.userId, "swppp_inspection", inspId, "UPDATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/swppp-inspections/${inspId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "swppp_inspection", inspId, "DELETE")).toBe(1);
  });

  it("writes CREATE / UPDATE / DELETE audit rows for material certifications", async () => {
    const create = await request(app)
      .post("/api/material-certifications")
      .set("Cookie", authCookie(tenantOn.token))
      .send({
        projectId: tenantOn.projectId,
        materialDescription: "Steel Rebar #5",
      });
    expect(create.status).toBe(201);
    const mcId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "material_certification", mcId, "CREATE")).toBe(1);

    const patch = await request(app)
      .patch(`/api/material-certifications/${mcId}`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ notes: "audit-test" });
    expect(patch.status).toBe(200);
    expect(await countAuditRows(tenantOn.userId, "material_certification", mcId, "UPDATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/material-certifications/${mcId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "material_certification", mcId, "DELETE")).toBe(1);
  });

  it("writes CREATE / UPDATE / DELETE audit rows for project DBE goals", async () => {
    const create = await request(app)
      .post(`/api/projects/${tenantOn.projectId}/dbe-goals`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ certificationType: "DBE", goalPercent: "10.00" });
    expect(create.status).toBe(201);
    const goalId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "project_dbe_goal", goalId, "CREATE")).toBe(1);

    const patch = await request(app)
      .patch(`/api/projects/${tenantOn.projectId}/dbe-goals/${goalId}`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({ goalPercent: "12.50" });
    expect(patch.status).toBe(200);
    expect(await countAuditRows(tenantOn.userId, "project_dbe_goal", goalId, "UPDATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/projects/${tenantOn.projectId}/dbe-goals/${goalId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "project_dbe_goal", goalId, "DELETE")).toBe(1);
  });

  it("writes CREATE + DELETE audit rows for CRM organisation certifications", async () => {
    const create = await request(app)
      .post(`/api/crm/organisations/${tenantOn.crmOrgId}/certifications`)
      .set("Cookie", authCookie(tenantOn.token))
      .send({
        certificationType: "DBE",
        certifyingAgency: "Test Cert Authority",
        certificationNumber: `${PREFIX}CERT-${Date.now()}`,
      });
    expect(create.status).toBe(201);
    const certId = create.body.id as string;
    expect(await countAuditRows(tenantOn.userId, "crm_organisation_certification", certId, "CREATE")).toBe(1);

    const del = await request(app)
      .delete(`/api/crm/organisations/${tenantOn.crmOrgId}/certifications/${certId}`)
      .set("Cookie", authCookie(tenantOn.token));
    expect(del.status).toBe(204);
    expect(await countAuditRows(tenantOn.userId, "crm_organisation_certification", certId, "DELETE")).toBe(1);
  });
});

describe("DOT bulk pay-item upload — body and rate-limit guards", () => {
  function makePayload(itemCount: number) {
    return {
      specBookId: sharedSpecBookId,
      items: Array.from({ length: itemCount }, (_, i) => ({
        itemNumber: `${PREFIX}ITEM-${Date.now()}-${i}`,
        description: "Test pay item ".repeat(20),
        unit: "EA",
      })),
    };
  }

  it("rejects requests without a Content-Length header (411)", async () => {
    const server = http.createServer(app).listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const body = JSON.stringify(makePayload(1));
      const result = await rawRequest(port, {
        method: "POST",
        path: "/api/dot/pay-items/bulk-upload",
        headers: {
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
          Cookie: authCookie(superAdmin.token),
        },
        body,
      });
      expect(result.status).toBe(411);
      expect(String(result.body.error ?? "")).toMatch(/Content-Length/i);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("rejects payloads larger than 2 MB (413)", async () => {
    const server = http.createServer(app).listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const claimedLen = 3 * 1024 * 1024;
      const fake = "x".repeat(claimedLen);
      const result = await rawRequest(port, {
        method: "POST",
        path: "/api/dot/pay-items/bulk-upload",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(claimedLen),
          Cookie: authCookie(superAdmin.token),
        },
        body: fake,
      });
      expect(result.status).toBe(413);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  it("accepts a small, well-formed bulk upload (sanity)", async () => {
    const res = await request(app)
      .post("/api/dot/pay-items/bulk-upload")
      .set("Cookie", authCookie(superAdmin.token))
      .send({
        specBookId: sharedSpecBookId,
        items: [
          {
            itemNumber: `${PREFIX}OK-${Date.now()}`,
            description: "Sanity item",
            unit: "EA",
          },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inserted: expect.any(Number), total: 1 });
  });

  it("trips the export rate-limiter after exhausting the per-user budget (429)", async () => {
    const goodPayload = {
      specBookId: sharedSpecBookId,
      items: [
        {
          itemNumber: `${PREFIX}RL-WARMUP`,
          description: "Rate-limit warmup",
          unit: "EA",
        },
      ],
    };

    let limited = false;
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post("/api/dot/pay-items/bulk-upload")
        .set("Cookie", authCookie(superAdmin.token))
        .send({
          specBookId: sharedSpecBookId,
          items: [
            {
              itemNumber: `${PREFIX}RL-${Date.now()}-${i}`,
              description: "Rate-limit probe",
              unit: "EA",
            },
          ],
        });
      if (res.status === 429) {
        limited = true;
        expect(res.body.error).toMatch(/too many/i);
        break;
      }
      expect(res.status).toBe(200);
    }

    expect(limited).toBe(true);
    const blocked = await request(app)
      .post("/api/dot/pay-items/bulk-upload")
      .set("Cookie", authCookie(superAdmin.token))
      .send(goodPayload);
    expect(blocked.status).toBe(429);
  }, 30_000);
});

