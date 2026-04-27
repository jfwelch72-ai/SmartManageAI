import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";

// Stub object storage so the photo resolver inside the PDF route can read a
// fake binary without touching real Replit Object Storage. The route does
// `await import("./objectStorage")`, so the mock must be registered before
// the route module is loaded.
const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

vi.mock("../objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../objectStorage")>();
  const file = (_name: string) => ({
    exists: async () => [true],
    getMetadata: async () => [{ metadata: { contentType: "image/png" } }],
    download: async () => [PNG_1x1],
    createReadStream: () => {
      const { Readable } = require("stream");
      return Readable.from([PNG_1x1]);
    },
  });
  return {
    ...actual,
    objectStorageClient: {
      bucket: (_name: string) => ({ file }),
    },
  };
});

import { db } from "../db";
import {
  users,
  organizations,
  projects,
  estimates,
  estimateLineItems,
} from "@shared/schema";
import { generateToken } from "../auth";
import { sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const TEST_PREFIX = "__estimate_export_test__";

interface SeededOrg {
  orgId: string;
  userId: string;
  token: string;
  projectId: string;
  estimateId: string;
  lineItemIds: string[];
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const slug = `${TEST_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const passwordHash = await bcrypt.hash("TestPass123!", 4);

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Export Test Org ${label}`,
      slug,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}-admin@test.local`,
      passwordHash,
      firstName: "Export",
      lastName: `Tester-${label}`,
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      name: `Export Project ${label}`,
      code: `${TEST_PREFIX}P-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      clientName: `Export Client ${label}`,
      gcOrganizationId: org.id,
      status: "ACTIVE",
    })
    .returning();

  const [estimate] = await db
    .insert(estimates)
    .values({
      projectId: project.id,
      createdById: user.id,
      status: "DRAFT",
    })
    .returning();

  // Two line items: one with photoUrls and a legacy photoUrl, one without.
  const li1Photo = `/api/estimates/line-item-photos/${org.id}/li-1/a.png`;
  const li1Photo2 = `/api/estimates/line-item-photos/${org.id}/li-1/b.png`;
  const [li1] = await db
    .insert(estimateLineItems)
    .values({
      estimateId: estimate.id,
      category: "CONCRETE",
      description: `Concrete pour ${label}`,
      quantity: "10.00",
      unit: "CY",
      materialCost: "1000.00",
      laborCost: "300.00",
      equipmentCost: "100.00",
      subcontractCost: "0.00",
      overheadAllocation: "50.00",
      profitAllocation: "50.00",
      totalCost: "1500.00",
      photoUrl: li1Photo,
      photoUrls: [li1Photo, li1Photo2],
    })
    .returning();

  const [li2] = await db
    .insert(estimateLineItems)
    .values({
      estimateId: estimate.id,
      category: "GENERAL",
      description: `Misc supplies ${label}`,
      quantity: "1.00",
      unit: "LS",
      materialCost: "200.00",
      laborCost: "0.00",
      equipmentCost: "0.00",
      subcontractCost: "0.00",
      overheadAllocation: "0.00",
      profitAllocation: "0.00",
      totalCost: "200.00",
    })
    .returning();

  const token = generateToken(user.id, user.tokenVersion ?? 0);
  return {
    orgId: org.id,
    userId: user.id,
    token,
    projectId: project.id,
    estimateId: estimate.id,
    lineItemIds: [li1.id, li2.id],
  };
}

interface IdRow {
  id: string;
}

interface ExecuteResult<T> {
  rows?: T[];
}

async function cleanup(): Promise<void> {
  try {
    const orgIdsResult = (await db.execute(
      sql`SELECT id FROM organizations WHERE slug LIKE ${TEST_PREFIX + "%"}`,
    )) as unknown as ExecuteResult<IdRow>;
    const orgIds: string[] = (orgIdsResult.rows ?? []).map((r) => r.id);
    for (const orgId of orgIds) {
      await db.execute(sql`DELETE FROM estimate_line_items WHERE estimate_id IN (SELECT id FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId}))`).catch(() => {});
      await db.execute(sql`DELETE FROM estimates WHERE project_id IN (SELECT id FROM projects WHERE gc_organization_id = ${orgId})`).catch(() => {});
      await db.execute(sql`DELETE FROM projects WHERE gc_organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM users WHERE organization_id = ${orgId}`).catch(() => {});
      await db.execute(sql`DELETE FROM organizations WHERE id = ${orgId}`).catch(() => {});
    }
  } catch {
    // best-effort cleanup
  }
}

let app: Express;
let server: Server;
let orgA: SeededOrg;
let orgB: SeededOrg;

beforeAll(async () => {
  process.env.PRIVATE_OBJECT_DIR = process.env.PRIVATE_OBJECT_DIR || "/test-bucket/private";

  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { registerRoutes } = await import("../routes");

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  server = await registerRoutes(app);

  [orgA, orgB] = await Promise.all([seedOrg("A"), seedOrg("B")]);
}, 60_000);

afterAll(async () => {
  await cleanup();
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

describe("Estimate export routes — line item photos", () => {
  it("PDF export returns a non-empty PDF buffer for an estimate that has photo URLs", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/export/pdf`)
      .set("Cookie", `auth_token=${orgA.token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/pdf/);
    const body: Buffer = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body);
    expect(body.length).toBeGreaterThan(500);
    expect(body.slice(0, 4).toString()).toBe("%PDF");
  });

  it("Excel export contains a Photos sheet and the Line Items sheet has a populated 'Photo URLs' column", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/export/excel`)
      .buffer(true)
      .parse((response, callback) => {
        const data: Buffer[] = [];
        response.on("data", (chunk: Buffer) => data.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(data)));
      })
      .set("Cookie", `auth_token=${orgA.token}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/spreadsheetml\.sheet/);

    const XLSX = await import("xlsx");
    const wb = XLSX.read(res.body as Buffer, { type: "buffer" });

    expect(wb.SheetNames).toContain("Line Items");
    expect(wb.SheetNames).toContain("Summary");
    expect(wb.SheetNames).toContain("Photos");

    interface LineItemRow {
      Description?: string;
      "Photo URLs"?: string;
      "Photo Count"?: number | string;
    }
    interface PhotoRow {
      "Line Item"?: string;
      Category?: string;
      "Photo URL"?: string;
    }

    const lineItemsRows = XLSX.utils.sheet_to_json<LineItemRow>(wb.Sheets["Line Items"]);
    expect(lineItemsRows.length).toBe(2);
    expect(lineItemsRows[0]).toHaveProperty("Photo URLs");

    const populated = lineItemsRows.find(
      (r) => typeof r["Photo URLs"] === "string" && r["Photo URLs"]!.length > 0,
    );
    expect(populated, "expected at least one Line Items row to have a populated Photo URLs cell").toBeDefined();
    expect(populated!["Photo URLs"]).toMatch(/line-item-photos/);
    expect(Number(populated!["Photo Count"])).toBeGreaterThan(0);

    const photoRows = XLSX.utils.sheet_to_json<PhotoRow>(wb.Sheets["Photos"]);
    expect(photoRows.length).toBeGreaterThan(0);
    for (const row of photoRows) {
      expect(row).toHaveProperty("Line Item");
      expect(row).toHaveProperty("Photo URL");
      expect(String(row["Photo URL"])).toMatch(/line-item-photos/);
    }
  });

  it("Excel export omits the 'Calculation Breakdowns' sheet by default", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/export/excel`)
      .buffer(true)
      .parse((response, callback) => {
        const data: Buffer[] = [];
        response.on("data", (chunk: Buffer) => data.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(data)));
      })
      .set("Cookie", `auth_token=${orgA.token}`);

    expect(res.status).toBe(200);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(res.body as Buffer, { type: "buffer" });
    expect(wb.SheetNames).not.toContain("Calculation Breakdowns");
  });

  it("Excel export with includeFormulas=true adds a 'Calculation Breakdowns' sheet matching the formula helper output", async () => {
    // Seed a calculator-driven line item just for this assertion so
    // we can verify rows appear and numbers match the helper exactly.
    const [calcLi] = await db
      .insert(estimateLineItems)
      .values({
        estimateId: orgA.estimateId,
        category: "CONCRETE",
        description: `Calc slab ${Date.now()}`,
        quantity: "100.00",
        unit: "SF",
        materialCost: "0.00",
        laborCost: "0.00",
        equipmentCost: "0.00",
        subcontractCost: "0.00",
        overheadAllocation: "0.00",
        profitAllocation: "0.00",
        totalCost: "0.00",
        concreteDepthInches: "4.00",
        concreteWasteFactor: "10.00",
        calculatedConcreteYards: "1.36",
      })
      .returning();
    orgA.lineItemIds.push(calcLi.id);

    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/export/excel?includeFormulas=true`)
      .buffer(true)
      .parse((response, callback) => {
        const data: Buffer[] = [];
        response.on("data", (chunk: Buffer) => data.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(data)));
      })
      .set("Cookie", `auth_token=${orgA.token}`);

    expect(res.status).toBe(200);
    const XLSX = await import("xlsx");
    const wb = XLSX.read(res.body as Buffer, { type: "buffer" });
    expect(wb.SheetNames).toContain("Calculation Breakdowns");

    interface BreakdownRow {
      "Line Item"?: string;
      Section?: string;
      Formula?: string;
      "Step #"?: number | string;
      Label?: string;
      Calculation?: string;
      Value?: string;
      Result?: number | string;
      Unit?: string;
    }
    const rows = XLSX.utils.sheet_to_json<BreakdownRow>(
      wb.Sheets["Calculation Breakdowns"],
    );
    const slabRows = rows.filter((r) => r["Line Item"] === calcLi.description);
    expect(slabRows.length).toBeGreaterThan(0);

    // All rows for one line-item / section should share the same Formula text.
    const concreteRows = slabRows.filter((r) => r.Section?.startsWith("Concrete"));
    expect(concreteRows.length).toBeGreaterThan(0);
    expect(concreteRows[0].Formula).toMatch(/Quantity.*Depth.*Waste/);

    // Sanity-check against the helper itself so the spreadsheet stays
    // in lock-step with the on-screen calculator and the PDF.
    const { buildLineItemFormulaBreakdowns } = await import(
      "../materialFormulaBreakdown"
    );
    const expected = buildLineItemFormulaBreakdowns({
      quantity: "100.00",
      unit: "SF",
      concreteDepthInches: "4.00",
      concreteWasteFactor: "10.00",
      calculatedConcreteYards: "1.36",
    });
    expect(expected.length).toBeGreaterThan(0);
    const concreteBlock = expected.find((b) => b.title.startsWith("Concrete"))!;
    expect(concreteBlock).toBeDefined();
    expect(concreteRows).toHaveLength(concreteBlock.steps.length);
    concreteBlock.steps.forEach((step, idx) => {
      expect(concreteRows[idx].Label).toBe(step.label);
      expect(concreteRows[idx].Value).toBe(step.value);
      if (step.calculation !== undefined) {
        expect(concreteRows[idx].Calculation).toBe(step.calculation);
      }
    });
    const last = concreteRows[concreteRows.length - 1];
    expect(Number(last.Result)).toBeCloseTo(concreteBlock.result, 2);
    expect(last.Unit).toBe(concreteBlock.resultUnit);
  });

  it("denies cross-tenant PDF export with 404 when caller's org doesn't own the estimate", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/export/pdf`)
      .set("Cookie", `auth_token=${orgB.token}`);

    expect(res.status).toBe(404);
  });

  it("denies cross-tenant Excel export with 404 when caller's org doesn't own the estimate", async () => {
    const res = await request(app)
      .get(`/api/estimates/${orgA.estimateId}/export/excel`)
      .set("Cookie", `auth_token=${orgB.token}`);

    expect(res.status).toBe(404);
  });
});
