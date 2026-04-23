// Task #1124 — End-to-end tests for the prevailing wage rate importer
// (POST /api/labor-rates/prevailing-wage-rates/import-preview and
// POST /api/labor-rates/prevailing-wage-rates/import).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql, eq, and } from "drizzle-orm";
import * as XLSX from "xlsx";

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  jobClassifications,
  prevailingWageRates,
} from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

const PREFIX = "__pwimp__";

interface ClassificationRecord {
  id: string;
  name: string;
  code: string | null;
}

interface OrgFixture {
  orgId: string;
  projectId: string;
  token: string;
  classifications: {
    carpenter: ClassificationRecord;
    electrician: ClassificationRecord;
    laborer: ClassificationRecord;
  };
}

let app: Express;
let orgA: OrgFixture;
let orgB: OrgFixture;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];
  if (orgIds.length === 0) return;

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
  await db.delete(users).where(inArray(users.organizationId, orgIds)).catch(() => {});
  await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
}

async function seedOrg(label: string): Promise<OrgFixture> {
  const slug = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: `PW Import Org ${label}`,
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
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  const token = generateToken(user.id, user.tokenVersion ?? 0);

  const [project] = await db
    .insert(projects)
    .values({
      name: `PW Project ${label}`,
      code: `${PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      clientName: `PW Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const classRows = await db
    .insert(jobClassifications)
    .values([
      { organizationId: org.id, name: `Carpenter-${label}`, code: `CARP-${label}` },
      { organizationId: org.id, name: `Electrician-${label}`, code: `ELEC-${label}` },
      { organizationId: org.id, name: `Laborer-${label}`, code: `LAB-${label}` },
    ])
    .returning();

  const byName = new Map(classRows.map((c) => [c.name, c]));
  return {
    orgId: org.id,
    projectId: project.id,
    token,
    classifications: {
      carpenter: byName.get(`Carpenter-${label}`)!,
      electrician: byName.get(`Electrician-${label}`)!,
      laborer: byName.get(`Laborer-${label}`)!,
    },
  };
}

async function clearRatesFor(org: OrgFixture): Promise<void> {
  await db
    .delete(prevailingWageRates)
    .where(eq(prevailingWageRates.organizationId, org.orgId));
}

beforeAll(async () => {
  await cleanup();
  orgA = await seedOrg("A");
  orgB = await seedOrg("B");

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

function buildXlsxBuffer(headerRow: string[], dataRows: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rates");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function preview(org: OrgFixture, projectId: string, buffer: Buffer, filename: string) {
  return request(app)
    .post("/api/labor-rates/prevailing-wage-rates/import-preview")
    .set("Cookie", cookieFor(org.token))
    .field("projectId", projectId)
    .attach("file", buffer, filename);
}

async function commitImport(org: OrgFixture, projectId: string, rows: unknown[]) {
  return request(app)
    .post("/api/labor-rates/prevailing-wage-rates/import")
    .set("Cookie", cookieFor(org.token))
    .send({ projectId, rows });
}

describe("Prevailing wage importer — import-preview", () => {
  it("matches CSV header aliases case-insensitively (Trade / BHR / H&W / Pension / Vacation)", async () => {
    const buf = buildCsvBuffer(
      ["Trade", "BHR", "H&W", "Pension", "Vacation", "Training", "OT Mult", "Effective", "Expires", "WD #", "Notes"],
      [
        ["Carpenter-A", "$45.00", "5.50", "4.25", "1.00", "0.25", "1.5", "2026-01-01", "2026-12-31", "CA-2026-001", "general"],
      ],
    );
    const res = await preview(orgA, orgA.projectId, buf, "rates.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ totalRows: 1, toCreate: 1, toUpdate: 0, withErrors: 0 });
    const row = res.body.rows[0];
    expect(row.classificationId).toBe(orgA.classifications.carpenter.id);
    expect(row.wageRate).toBe("45.00");
    expect(row.fringeRate).toBe("11.00");
    expect(row.totalRate).toBe("56.00");
    expect(row.action).toBe("CREATE");
    expect(row.effectiveDate).toBe("2026-01-01");
    expect(row.expirationDate).toBe("2026-12-31");
  });

  it("parses XLSX uploads, including Excel serial date cells", async () => {
    const excelSerialJan1_2026 = 46023;
    const buf = buildXlsxBuffer(
      ["Classification", "Wage Rate", "Health/Welfare", "Pension", "Vacation/Holiday", "Training", "Overtime Multiplier", "Effective Date"],
      [["Electrician-A", 60, 6, 5, 2, 1, 1.5, excelSerialJan1_2026]],
    );
    const res = await preview(orgA, orgA.projectId, buf, "rates.xlsx");
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ totalRows: 1, toCreate: 1, withErrors: 0 });
    const row = res.body.rows[0];
    expect(row.classificationId).toBe(orgA.classifications.electrician.id);
    expect(row.effectiveDate).toBe("2026-01-01");
    expect(row.fringeRate).toBe("14.00");
    expect(row.totalRate).toBe("74.00");
  });

  it("explicit total fringe wins; blank total falls back to the breakdown sum", async () => {
    const buf = buildCsvBuffer(
      ["Classification", "Wage", "Health", "Pension", "Vacation", "Training", "Fringe", "Effective"],
      [
        ["Carpenter-A", "40.00", "5.00", "4.00", "1.00", "1.00", "12.00", "2026-02-01"],
        ["Electrician-A", "55.00", "5.00", "4.00", "1.00", "0.50", "", "2026-02-01"],
      ],
    );
    const res = await preview(orgA, orgA.projectId, buf, "rates.csv");
    expect(res.status).toBe(200);
    expect(res.body.summary.withErrors).toBe(0);
    const carp = res.body.rows.find((r: { classificationId: string }) => r.classificationId === orgA.classifications.carpenter.id);
    const elec = res.body.rows.find((r: { classificationId: string }) => r.classificationId === orgA.classifications.electrician.id);
    expect(carp.fringeRate).toBe("12.00");
    expect(carp.totalRate).toBe("52.00");
    expect(elec.fringeRate).toBe("10.50");
    expect(elec.totalRate).toBe("65.50");
  });

  it("matches classifications by name and by code (case-insensitive); flags unknown/missing as ERROR", async () => {
    const buf = buildCsvBuffer(
      ["Classification", "Wage", "Effective"],
      [
        ["Carpenter-A", "40", "2026-03-01"],
        ["elec-a", "60", "2026-03-01"],
        ["ELEC-A", "60", "2026-03-01"],
        ["Glazier", "30", "2026-03-01"],
        ["", "20", "2026-03-01"],
      ],
    );
    const res = await preview(orgA, orgA.projectId, buf, "rates.csv");
    expect(res.status).toBe(200);
    const rows = res.body.rows as Array<{
      rawClassification: string;
      classificationId: string | null;
      action: string;
      errors: string[];
    }>;
    expect(rows).toHaveLength(5);
    const byRaw = new Map(rows.map((r) => [r.rawClassification, r]));
    expect(byRaw.get("Carpenter-A")!.classificationId).toBe(orgA.classifications.carpenter.id);
    expect(byRaw.get("Carpenter-A")!.action).toBe("CREATE");
    expect(byRaw.get("ELEC-A")!.classificationId).toBe(orgA.classifications.electrician.id);
    expect(byRaw.get("ELEC-A")!.action).toBe("CREATE");
    expect(byRaw.get("elec-a")!.classificationId).toBe(orgA.classifications.electrician.id);
    expect(byRaw.get("Glazier")!.action).toBe("ERROR");
    expect(byRaw.get("Glazier")!.errors.join(" ")).toMatch(/Unknown classification/i);
    expect(byRaw.get("")!.action).toBe("ERROR");
    expect(byRaw.get("")!.errors.join(" ")).toMatch(/Missing classification/i);
    expect(res.body.summary.withErrors).toBe(2);
  });

  it("preview rejects a projectId belonging to another organization", async () => {
    const buf = buildCsvBuffer(
      ["Classification", "Wage", "Effective"],
      [["Carpenter-A", "40", "2026-04-01"]],
    );
    const res = await preview(orgB, orgA.projectId, buf, "rates.csv");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Project not found/);
  });
});

describe("Prevailing wage importer — commit import", () => {
  beforeAll(async () => {
    await clearRatesFor(orgA);
    await clearRatesFor(orgB);
  });

  it("creates new rates and updates them on a second import (per-project, per-classification upsert)", async () => {
    await clearRatesFor(orgA);

    const first = await commitImport(orgA, orgA.projectId, [
      {
        rowNumber: 2,
        classificationId: orgA.classifications.laborer.id,
        wageRate: "30.00",
        fringeHealthRate: "3.00",
        fringePensionRate: "2.00",
        fringeVacationRate: "0.50",
        fringeTrainingRate: "0.50",
        fringeRate: "",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
        expirationDate: "2026-12-31",
        wageDecision: "WD-1",
        notes: "initial",
        action: "CREATE",
      },
      {
        rowNumber: 3,
        classificationId: orgA.classifications.carpenter.id,
        wageRate: "45.00",
        fringeHealthRate: "5.00",
        fringePensionRate: "4.00",
        fringeVacationRate: "1.00",
        fringeTrainingRate: "1.00",
        fringeRate: "",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
        action: "CREATE",
      },
    ]);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ created: 2, updated: 0 });

    const afterFirst = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, orgA.orgId),
        eq(prevailingWageRates.projectId, orgA.projectId),
      ));
    expect(afterFirst).toHaveLength(2);
    const laborer = afterFirst.find((r) => r.classificationId === orgA.classifications.laborer.id)!;
    expect(laborer.wageRate).toBe("30.00");
    expect(laborer.fringeRate).toBe("6.00");
    expect(laborer.totalRate).toBe("36.00");
    expect(laborer.notes).toBe("initial");

    const second = await commitImport(orgA, orgA.projectId, [
      {
        rowNumber: 2,
        classificationId: orgA.classifications.laborer.id,
        wageRate: "33.00",
        fringeHealthRate: "4.00",
        fringePensionRate: "2.50",
        fringeVacationRate: "0.50",
        fringeTrainingRate: "0.50",
        fringeRate: "",
        overtimeMultiplier: "2.0",
        effectiveDate: "2026-07-01",
        wageDecision: "WD-2",
        notes: "raise",
        action: "UPDATE",
      },
      {
        rowNumber: 3,
        classificationId: orgA.classifications.electrician.id,
        wageRate: "60.00",
        fringeHealthRate: "6.00",
        fringePensionRate: "5.00",
        fringeVacationRate: "2.00",
        fringeTrainingRate: "1.00",
        fringeRate: "",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-07-01",
        action: "CREATE",
      },
    ]);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ created: 1, updated: 1 });

    const afterSecond = await db
      .select()
      .from(prevailingWageRates)
      .where(and(
        eq(prevailingWageRates.organizationId, orgA.orgId),
        eq(prevailingWageRates.projectId, orgA.projectId),
      ));
    expect(afterSecond).toHaveLength(3);
    const updatedLaborer = afterSecond.find((r) => r.classificationId === orgA.classifications.laborer.id)!;
    expect(updatedLaborer.id).toBe(laborer.id);
    expect(updatedLaborer.wageRate).toBe("33.00");
    expect(updatedLaborer.fringeRate).toBe("7.50");
    expect(updatedLaborer.totalRate).toBe("40.50");
    expect(updatedLaborer.overtimeMultiplier).toBe("2.00");
    expect(updatedLaborer.notes).toBe("raise");
  });

  it("skips ERROR rows, cross-org classifications, and rows that fail server-side validation", async () => {
    await clearRatesFor(orgA);

    const resp = await commitImport(orgA, orgA.projectId, [
      {
        rowNumber: 2,
        classificationId: orgA.classifications.carpenter.id,
        wageRate: "1.00",
        effectiveDate: "2026-08-01",
        action: "ERROR",
      },
      {
        rowNumber: 3,
        classificationId: orgB.classifications.carpenter.id,
        wageRate: "100.00",
        effectiveDate: "2026-08-01",
        action: "CREATE",
      },
      {
        rowNumber: 4,
        classificationId: orgA.classifications.electrician.id,
        wageRate: "0",
        effectiveDate: "2026-08-01",
        action: "CREATE",
      },
      {
        rowNumber: 5,
        classificationId: orgA.classifications.laborer.id,
        wageRate: "30.00",
        overtimeMultiplier: "-1",
        effectiveDate: "2026-08-01",
        action: "UPDATE",
      },
    ]);
    expect(resp.status).toBe(200);
    expect(resp.body.created).toBe(0);
    expect(resp.body.updated).toBe(0);
    expect(resp.body.skipped).toBeGreaterThanOrEqual(4);

    const after = await db
      .select()
      .from(prevailingWageRates)
      .where(eq(prevailingWageRates.projectId, orgA.projectId));
    expect(after).toHaveLength(0);
    expect(after.find((r) => r.classificationId === orgB.classifications.carpenter.id)).toBeUndefined();
  });

  it("commit-import rejects another organization's project and leaves rates untouched", async () => {
    await clearRatesFor(orgA);
    await clearRatesFor(orgB);

    const baseline = await commitImport(orgA, orgA.projectId, [
      {
        rowNumber: 2,
        classificationId: orgA.classifications.carpenter.id,
        wageRate: "45.00",
        fringeHealthRate: "5.00",
        fringePensionRate: "4.00",
        fringeVacationRate: "1.00",
        fringeTrainingRate: "1.00",
        fringeRate: "",
        overtimeMultiplier: "1.5",
        effectiveDate: "2026-01-01",
        action: "CREATE",
      },
    ]);
    expect(baseline.status).toBe(200);
    expect(baseline.body).toMatchObject({ created: 1 });

    const before = await db
      .select()
      .from(prevailingWageRates)
      .where(eq(prevailingWageRates.projectId, orgA.projectId));
    const beforeJson = before.map((r) => ({ id: r.id, wageRate: r.wageRate, totalRate: r.totalRate }));

    const resp = await commitImport(orgB, orgA.projectId, [
      {
        rowNumber: 2,
        classificationId: orgB.classifications.carpenter.id,
        wageRate: "999.00",
        effectiveDate: "2026-09-01",
        action: "CREATE",
      },
    ]);
    expect(resp.status).toBe(404);
    expect(resp.body.error).toMatch(/Project not found/);

    const after = await db
      .select()
      .from(prevailingWageRates)
      .where(eq(prevailingWageRates.projectId, orgA.projectId));
    const afterJson = after.map((r) => ({ id: r.id, wageRate: r.wageRate, totalRate: r.totalRate }));
    expect(afterJson).toEqual(beforeJson);

    const orgBRates = await db
      .select()
      .from(prevailingWageRates)
      .where(eq(prevailingWageRates.organizationId, orgB.orgId));
    expect(orgBRates).toHaveLength(0);
  });
});
