// Task #1191 — Integration tests for the "create missing classifications"
// branch of the prevailing wage importer (preview + commit), covering:
//   • mixed existing + new classifications in one file (preview)
//   • two rows referencing the same new classification name (dedup, commit)
//   • createMissing=false still rejects unknown classifications
//   • already-existing classification is reused (refetch / no double-create)
//   • audit_log entries written for each auto-created classification

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  jobClassifications,
  prevailingWageRates,
  auditLog,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__pwcm__";

interface ClassificationRecord {
  id: string;
  name: string;
  code: string | null;
}

interface OrgFixture {
  orgId: string;
  userId: string;
  projectId: string;
  token: string;
  classifications: {
    carpenter: ClassificationRecord;
    laborer: ClassificationRecord;
  };
}

let app: Express;
let org: OrgFixture;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;

  const userRows = await db.select({ id: users.id }).from(users).where(inArray(users.organizationId, orgIds));
  const userIds = userRows.map((r) => r.id);

  await db
    .delete(prevailingWageRates)
    .where(inArray(prevailingWageRates.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(jobClassifications)
    .where(inArray(jobClassifications.organizationId, orgIds))
    .catch(() => {});
  await db
    .delete(projects)
    .where(inArray(projects.gcOrganizationId, orgIds))
    .catch(() => {});
  if (userIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.userId, userIds)).catch(() => {});
  }
  await db.delete(users).where(inArray(users.organizationId, orgIds)).catch(() => {});
  await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

async function seedOrg(label: string): Promise<OrgFixture> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [orgRow] = await db
    .insert(organizations)
    .values({
      name: `PW CreateMissing Org ${label}`,
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
      firstName: "PW",
      lastName: `Admin-${label}`,
      role: "ADMIN",
      organizationId: orgRow.id,
      isActive: true,
    })
    .returning();
  const token = generateToken(user.id, user.tokenVersion ?? 0);

  const [project] = await db
    .insert(projects)
    .values({
      name: `PW CreateMissing Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      clientName: `PW Client ${label}`,
      gcOrganizationId: orgRow.id,
      status: "ACTIVE",
    })
    .returning();

  const classRows = await db
    .insert(jobClassifications)
    .values([
      { organizationId: orgRow.id, name: `Carpenter-${label}`, code: `CARP-${label}` },
      { organizationId: orgRow.id, name: `Laborer-${label}`, code: `LAB-${label}` },
    ])
    .returning();

  const byName = new Map(classRows.map((c) => [c.name, c]));
  return {
    orgId: orgRow.id,
    userId: user.id,
    projectId: project.id,
    token,
    classifications: {
      carpenter: byName.get(`Carpenter-${label}`)!,
      laborer: byName.get(`Laborer-${label}`)!,
    },
  };
}

async function clearOrgState(): Promise<void> {
  await db
    .delete(prevailingWageRates)
    .where(eq(prevailingWageRates.organizationId, org.orgId));
  // Remove any auto-created classifications, keep the seeded ones.
  await db
    .delete(jobClassifications)
    .where(and(
      eq(jobClassifications.organizationId, org.orgId),
      sql`${jobClassifications.id} NOT IN (${org.classifications.carpenter.id}, ${org.classifications.laborer.id})`,
    ));
  await db.delete(auditLog).where(eq(auditLog.userId, org.userId));
}

beforeAll(async () => {
  await cleanup();
  org = await seedOrg("X");

  const laborRateRoutes = (await import("../laborRateRoutes")).default;
  app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use("/api/labor-rates", laborRateRoutes);
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

const cookieFor = (token: string) => `auth_token=${token}`;

function buildCsvBuffer(headerRow: string[], dataRows: string[][]): Buffer {
  const escape = (cell: string) => {
    if (/[",\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
    return cell;
  };
  const lines = [headerRow, ...dataRows].map((r) => r.map(escape).join(","));
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

async function preview(buffer: Buffer, filename: string, opts: { createMissing?: boolean } = {}) {
  const req = request(app)
    .post("/api/labor-rates/prevailing-wage-rates/import-preview")
    .set("Cookie", cookieFor(org.token))
    .field("projectId", org.projectId);
  if (opts.createMissing !== undefined) {
    req.field("createMissing", opts.createMissing ? "true" : "false");
  }
  return req.attach("file", buffer, filename);
}

async function commitImport(rows: unknown[], opts: { createMissing?: boolean } = {}) {
  return request(app)
    .post("/api/labor-rates/prevailing-wage-rates/import")
    .set("Cookie", cookieFor(org.token))
    .send({ projectId: org.projectId, rows, createMissing: opts.createMissing ?? false });
}

describe("Prevailing wage importer — createMissing preview", () => {
  it("flags unknown classifications as CREATE (not ERROR) when createMissing=true and mixes them with existing classifications", async () => {
    await clearOrgState();
    const buf = buildCsvBuffer(
      ["Classification", "Wage", "Health", "Pension", "Effective"],
      [
        ["Carpenter-X", "45.00", "5.00", "4.00", "2026-01-01"],
        ["Plumber-New", "50.00", "6.00", "5.00", "2026-01-01"],
        ["Ironworker-New", "55.00", "7.00", "5.00", "2026-01-01"],
      ],
    );
    const res = await preview(buf, "rates.csv", { createMissing: true });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      totalRows: 3,
      toCreate: 3,
      toUpdate: 0,
      withErrors: 0,
      classificationsToCreate: 2,
    });

    const rows = res.body.rows as Array<{
      rawClassification: string;
      classificationId: string | null;
      classificationName: string | null;
      newClassificationName: string | null;
      createClassification: boolean;
      action: string;
      errors: string[];
    }>;
    const byRaw = new Map(rows.map((r) => [r.rawClassification, r]));

    const carp = byRaw.get("Carpenter-X")!;
    expect(carp.action).toBe("CREATE");
    expect(carp.classificationId).toBe(org.classifications.carpenter.id);
    expect(carp.createClassification).toBe(false);
    expect(carp.newClassificationName).toBeNull();

    const plumber = byRaw.get("Plumber-New")!;
    expect(plumber.action).toBe("CREATE");
    expect(plumber.classificationId).toBeNull();
    expect(plumber.createClassification).toBe(true);
    expect(plumber.newClassificationName).toBe("Plumber-New");
    expect(plumber.classificationName).toBe("Plumber-New");
    expect(plumber.errors).toHaveLength(0);

    const iron = byRaw.get("Ironworker-New")!;
    expect(iron.action).toBe("CREATE");
    expect(iron.createClassification).toBe(true);
    expect(iron.newClassificationName).toBe("Ironworker-New");
  });

  it("preview with createMissing=false still flags unknown classifications as ERROR", async () => {
    await clearOrgState();
    const buf = buildCsvBuffer(
      ["Classification", "Wage", "Effective"],
      [
        ["Carpenter-X", "45.00", "2026-01-01"],
        ["Plumber-New", "50.00", "2026-01-01"],
      ],
    );
    const res = await preview(buf, "rates.csv", { createMissing: false });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      totalRows: 2,
      toCreate: 1,
      withErrors: 1,
      classificationsToCreate: 0,
    });
    const rows = res.body.rows as Array<{ rawClassification: string; action: string; errors: string[]; createClassification: boolean; classificationId: string | null }>;
    const plumber = rows.find((r) => r.rawClassification === "Plumber-New")!;
    expect(plumber.action).toBe("ERROR");
    expect(plumber.errors.join(" ")).toMatch(/Unknown classification/i);
    expect(plumber.createClassification).toBe(false);
    expect(plumber.classificationId).toBeNull();
  });
});

describe("Prevailing wage importer — createMissing commit", () => {
  it("auto-creates a missing classification, writes a rate, and emits an audit_log CREATE entry", async () => {
    await clearOrgState();

    const resp = await commitImport(
      [
        {
          rowNumber: 2,
          classificationId: null,
          createClassification: true,
          newClassificationName: "Welder-New",
          wageRate: "48.00",
          fringeHealthRate: "5.00",
          fringePensionRate: "4.00",
          fringeVacationRate: "1.00",
          fringeTrainingRate: "0.50",
          fringeRate: "",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-01-01",
          action: "CREATE",
        },
      ],
      { createMissing: true },
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ created: 1, updated: 0, classificationsCreated: 1 });

    const created = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        eq(jobClassifications.name, "Welder-New"),
      ));
    expect(created).toHaveLength(1);
    expect(created[0].defaultRegularRate).toBe("48.00");
    expect(created[0].defaultOvertimeRate).toBe("72.00");
    expect(created[0].description).toMatch(/Auto-created/i);

    const rates = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, org.orgId),
        eq(prevailingWageRates.classificationId, created[0].id),
      ));
    expect(rates).toHaveLength(1);
    expect(rates[0].wageRate).toBe("48.00");
    expect(rates[0].fringeRate).toBe("10.50");
    expect(rates[0].totalRate).toBe("58.50");

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.userId, org.userId),
        eq(auditLog.entityType, "job_classification"),
        eq(auditLog.entityId, created[0].id),
      ));
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("CREATE");
    expect(audits[0].newValue).toMatch(/Welder-New/);
  });

  it("dedupes two rows referencing the same new classification name (case-insensitive) into a single classification", async () => {
    await clearOrgState();

    const resp = await commitImport(
      [
        {
          rowNumber: 2,
          classificationId: null,
          createClassification: true,
          newClassificationName: "Pipefitter-Dup",
          wageRate: "40.00",
          fringeHealthRate: "3.00",
          fringePensionRate: "2.00",
          fringeVacationRate: "0.50",
          fringeTrainingRate: "0.50",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-02-01",
          action: "CREATE",
        },
        {
          rowNumber: 3,
          classificationId: null,
          createClassification: true,
          newClassificationName: "pipefitter-dup",
          wageRate: "44.00",
          fringeHealthRate: "3.50",
          fringePensionRate: "2.50",
          fringeVacationRate: "0.75",
          fringeTrainingRate: "0.75",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-02-01",
          action: "CREATE",
        },
      ],
      { createMissing: true },
    );
    expect(resp.status).toBe(200);
    expect(resp.body.classificationsCreated).toBe(1);
    expect(resp.body.created + resp.body.updated).toBe(1);
    expect(resp.body.skipped).toBeGreaterThanOrEqual(1);
    expect(resp.body.errors.some((e: { message: string }) => /Superseded/i.test(e.message))).toBe(true);

    const created = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        sql`LOWER(${jobClassifications.name}) = ${"pipefitter-dup"}`,
      ));
    expect(created).toHaveLength(1);

    const rates = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, org.orgId),
        eq(prevailingWageRates.classificationId, created[0].id),
      ));
    expect(rates).toHaveLength(1);
    // Last-row-wins on the same dedup key.
    expect(rates[0].wageRate).toBe("44.00");

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.userId, org.userId),
        eq(auditLog.entityType, "job_classification"),
        eq(auditLog.action, "CREATE"),
      ));
    expect(audits).toHaveLength(1);
    expect(audits[0].entityId).toBe(created[0].id);
  });

  it("commit with createMissing=false skips rows that need an auto-created classification (no insert, no audit entry)", async () => {
    await clearOrgState();

    const resp = await commitImport(
      [
        {
          rowNumber: 2,
          classificationId: null,
          createClassification: true,
          newClassificationName: "ShouldNotBeCreated",
          wageRate: "50.00",
          fringeHealthRate: "5.00",
          fringePensionRate: "4.00",
          fringeVacationRate: "1.00",
          fringeTrainingRate: "0.50",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-03-01",
          action: "CREATE",
        },
      ],
      { createMissing: false },
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ created: 0, updated: 0, classificationsCreated: 0 });
    expect(resp.body.skipped).toBeGreaterThanOrEqual(1);

    const created = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        eq(jobClassifications.name, "ShouldNotBeCreated"),
      ));
    expect(created).toHaveLength(0);

    const rates = await db
      .select()
      .from(prevailingWageRates)
      .where(eq(prevailingWageRates.organizationId, org.orgId));
    expect(rates).toHaveLength(0);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.userId, org.userId),
        eq(auditLog.entityType, "job_classification"),
      ));
    expect(audits).toHaveLength(0);
  });

  it("normal-reuse path: when a classification with the same name already exists at request time, the importer skips auto-create and writes a rate to the existing row", async () => {
    await clearOrgState();

    // Pre-create the classification that the import will try to "auto-create".
    const [pre] = await db
      .insert(jobClassifications)
      .values({
        organizationId: org.orgId,
        name: "Glazier-Existing",
        description: "Pre-existing fixture row",
      })
      .returning();

    const resp = await commitImport(
      [
        {
          rowNumber: 2,
          classificationId: null,
          createClassification: true,
          newClassificationName: "Glazier-Existing",
          wageRate: "42.00",
          fringeHealthRate: "4.00",
          fringePensionRate: "3.00",
          fringeVacationRate: "0.50",
          fringeTrainingRate: "0.50",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-04-01",
          action: "CREATE",
        },
      ],
      { createMissing: true },
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ created: 1, classificationsCreated: 0 });

    const all = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        eq(jobClassifications.name, "Glazier-Existing"),
      ));
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(pre.id);

    const rates = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, org.orgId),
        eq(prevailingWageRates.classificationId, pre.id),
      ));
    expect(rates).toHaveLength(1);
    expect(rates[0].wageRate).toBe("42.00");
    expect(rates[0].totalRate).toBe("50.00");

    // No CREATE audit entry was emitted for the pre-existing classification.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.userId, org.userId),
        eq(auditLog.entityType, "job_classification"),
        eq(auditLog.entityId, pre.id),
      ));
    expect(audits).toHaveLength(0);
  });

  it("falls back to refetch when the classification is concurrently inserted (unique-constraint catch path)", async () => {
    await clearOrgState();
    const raceName = "Race-Class-Refetch";

    // Sanity: the classification does not exist before the request, so the
    // route's in-memory `classByNameLower` cache will NOT short-circuit and
    // will attempt the actual db.insert — which we force to fail with a
    // unique-constraint error after another writer has won the race.
    const before = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        eq(jobClassifications.name, raceName),
      ));
    expect(before).toHaveLength(0);

    const dbAny = db as unknown as { insert: (...args: unknown[]) => unknown };
    const originalInsert = dbAny.insert.bind(db);
    let triggered = false;
    dbAny.insert = ((table: unknown, ...rest: unknown[]) => {
      if (!triggered && table === jobClassifications) {
        triggered = true;
        return {
          values: (_vals: unknown) => ({
            returning: async () => {
              // Simulate a concurrent process winning the race by inserting
              // the row directly via raw SQL (which bypasses this spy), then
              // surface the duplicate-key error our route is supposed to
              // catch and recover from via refetch.
              await db.execute(sql`INSERT INTO job_classifications (organization_id, name, description) VALUES (${org.orgId}, ${raceName}, ${"Inserted by concurrent writer"})`);
              const err = new Error('duplicate key value violates unique constraint "job_classifications_organization_id_name_unique"') as Error & { code?: string };
              err.code = "23505";
              throw err;
            },
          }),
        };
      }
      return (originalInsert as (...a: unknown[]) => unknown)(table, ...rest);
    }) as typeof dbAny.insert;

    let resp;
    try {
      resp = await commitImport(
        [
          {
            rowNumber: 2,
            classificationId: null,
            createClassification: true,
            newClassificationName: raceName,
            wageRate: "55.00",
            fringeHealthRate: "5.00",
            fringePensionRate: "4.00",
            fringeVacationRate: "1.00",
            fringeTrainingRate: "0.50",
            overtimeMultiplier: "1.5",
            effectiveDate: "2026-06-01",
            action: "CREATE",
          },
        ],
        { createMissing: true },
      );
    } finally {
      dbAny.insert = originalInsert as typeof dbAny.insert;
    }

    expect(triggered).toBe(true);
    expect(resp.status).toBe(200);
    // The catch path refetched the existing row instead of creating a new
    // one, so `classificationsCreated` is NOT incremented but the rate is
    // still written for the recovered classification.
    expect(resp.body).toMatchObject({ created: 1, updated: 0, classificationsCreated: 0 });

    // No double-create: exactly one classification row with this name.
    const all = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        eq(jobClassifications.name, raceName),
      ));
    expect(all).toHaveLength(1);
    // The row in the DB is the one inserted by the simulated concurrent
    // writer (the route's own insert was the one that threw).
    expect(all[0].description).toBe("Inserted by concurrent writer");

    // The rate is linked to the refetched/recovered classification id.
    const rates = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, org.orgId),
        eq(prevailingWageRates.classificationId, all[0].id),
      ));
    expect(rates).toHaveLength(1);
    expect(rates[0].wageRate).toBe("55.00");
    expect(rates[0].totalRate).toBe("65.50");

    // No CREATE audit entry was emitted for the classification — the route
    // only audits when its own insert succeeded, so the refetch path leaves
    // no audit footprint for the classification row.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.userId, org.userId),
        eq(auditLog.entityType, "job_classification"),
        eq(auditLog.entityId, all[0].id),
      ));
    expect(audits).toHaveLength(0);
  });

  it("writes one audit_log CREATE entry per auto-created classification when several are created in a single import", async () => {
    await clearOrgState();

    const resp = await commitImport(
      [
        {
          rowNumber: 2,
          classificationId: null,
          createClassification: true,
          newClassificationName: "Roofer-Multi",
          wageRate: "38.00",
          fringeHealthRate: "3.00",
          fringePensionRate: "2.00",
          fringeVacationRate: "0.50",
          fringeTrainingRate: "0.50",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-05-01",
          action: "CREATE",
        },
        {
          rowNumber: 3,
          classificationId: null,
          createClassification: true,
          newClassificationName: "Mason-Multi",
          wageRate: "41.00",
          fringeHealthRate: "3.50",
          fringePensionRate: "2.50",
          fringeVacationRate: "0.75",
          fringeTrainingRate: "0.25",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-05-01",
          action: "CREATE",
        },
        {
          rowNumber: 4,
          classificationId: org.classifications.carpenter.id,
          wageRate: "47.00",
          fringeHealthRate: "5.00",
          fringePensionRate: "4.00",
          fringeVacationRate: "1.00",
          fringeTrainingRate: "0.50",
          overtimeMultiplier: "1.5",
          effectiveDate: "2026-05-01",
          action: "CREATE",
        },
      ],
      { createMissing: true },
    );
    expect(resp.status).toBe(200);
    expect(resp.body).toMatchObject({ created: 3, updated: 0, classificationsCreated: 2 });

    const newClasses = await db
      .select()
      .from(jobClassifications)
      .where(and(
        eq(jobClassifications.organizationId, org.orgId),
        inArray(jobClassifications.name, ["Roofer-Multi", "Mason-Multi"]),
      ));
    expect(newClasses).toHaveLength(2);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(
        eq(auditLog.userId, org.userId),
        eq(auditLog.entityType, "job_classification"),
        eq(auditLog.action, "CREATE"),
        inArray(auditLog.entityId, newClasses.map((c) => c.id)),
      ));
    expect(audits).toHaveLength(2);
    const auditedIds = new Set(audits.map((a) => a.entityId));
    for (const c of newClasses) expect(auditedIds.has(c.id)).toBe(true);
  });
});
