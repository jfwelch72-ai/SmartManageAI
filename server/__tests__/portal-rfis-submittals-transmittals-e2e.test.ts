// Task #1613: end-to-end tests for the remaining sub-portal read endpoints
// (`/api/portal/rfis`, `/api/portal/rfis/:id`, `/api/portal/submittals`,
// `/api/portal/submittals/:id`, `/api/portal/transmittals`,
// `/api/portal/transmittals/:id`). Task #1608 already covered `/api/portal/info`.
//
// Each of these endpoints gates reads on BOTH `token.projectId` AND
// `token.crmOrganisationId` (transmittals additionally requires a recipient
// row for the token's CRM org). Nothing else pins that contract today, so a
// regression that loosens either filter would silently expose another
// tenant's RFI/submittal/transmittal to an external A/E. These tests run
// against the real DB through the same Express router production uses, so
// the join + WHERE clauses themselves are what's being verified.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcrypt";
import crypto from "crypto";
import type { Express, ErrorRequestHandler } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  crmOrganisations,
  subcontractorPortalTokens,
  rfis,
  submittals,
  documentTransmittals,
  transmittalRecipients,
} from "@shared/schema";

// Track every row this suite creates so cleanup never touches anything else.
const createdOrgIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdProjectIds = new Set<string>();
const createdCrmOrgIds = new Set<string>();
const createdRfiIds = new Set<string>();
const createdSubmittalIds = new Set<string>();
const createdTransmittalIds = new Set<string>();
const createdRecipientIds = new Set<string>();
const createdTokenIds = new Set<string>();

interface MintedToken {
  id: string;
  rawToken: string;
}

async function mintToken(args: {
  organizationId: string;
  projectId: string;
  crmOrganisationId: string;
  contactEmail: string;
  contactName: string;
  permissions?: string[];
}): Promise<MintedToken> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(rawToken, 10);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);
  const [row] = await db
    .insert(subcontractorPortalTokens)
    .values({
      organizationId: args.organizationId,
      projectId: args.projectId,
      crmOrganisationId: args.crmOrganisationId,
      contactEmail: args.contactEmail,
      contactName: args.contactName,
      tokenHash,
      permissions: args.permissions ?? ["view", "comment", "upload", "acknowledge"],
      status: "active",
      expiresAt,
    })
    .returning();
  createdTokenIds.add(row.id);
  return { id: row.id, rawToken };
}

interface SeedFixture {
  orgId: string;
  userId: string;
  projectAId: string;
  projectBId: string;
  crmOrgAlphaId: string;
  crmOrgBravoId: string;
  // RFIs
  rfiProjectAAlphaId: string;
  rfiProjectABravoId: string;
  rfiProjectBAlphaId: string;
  // Submittals
  submittalProjectAAlphaId: string;
  submittalProjectABravoId: string;
  submittalProjectBAlphaId: string;
  // Transmittals (each row identifies the project + which CRM org is on the recipient list)
  transmittalProjectAAlphaId: string;
  transmittalProjectABravoId: string;
  transmittalProjectBAlphaId: string;
  // CRM org with no RFIs / submittals / transmittals seeded against it —
  // used to prove list endpoints return [] for a token whose projectId
  // matches a seeded project but whose crmOrganisationId has nothing in
  // that project (the negative case the task description calls out).
  crmOrgCharlieId: string;
  // Tokens
  tokenAlphaInProjectA: MintedToken; // matches projectA + alpha (legit)
  tokenBravoInProjectA: MintedToken; // matches projectA + bravo (different sub, same project)
  tokenAlphaInProjectB: MintedToken; // matches projectB + alpha (different project)
  tokenCharlieInProjectA: MintedToken; // projectA matches, crm org has no rows → expect []
}

let fixture: SeedFixture;
let app: Express;

async function seedFixture(): Promise<SeedFixture> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Portal-Endpoints E2E Org ${uniq}`,
      slug: `portal-endpoints-e2e-${uniq}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  createdOrgIds.add(org.id);

  const [user] = await db
    .insert(users)
    .values({
      email: `portal-endpoints-e2e-${uniq}@example.test`,
      firstName: "Portal",
      lastName: "Tester",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();
  createdUserIds.add(user.id);

  const [projectA, projectB] = await db
    .insert(projects)
    .values([
      { name: `Portal Endpoints E2E A ${uniq}`, code: `PE2E-A-${uniq}`, clientName: "Client A" },
      { name: `Portal Endpoints E2E B ${uniq}`, code: `PE2E-B-${uniq}`, clientName: "Client B" },
    ])
    .returning();
  createdProjectIds.add(projectA.id);
  createdProjectIds.add(projectB.id);

  const [crmOrgAlpha, crmOrgBravo, crmOrgCharlie] = await db
    .insert(crmOrganisations)
    .values([
      { organizationId: org.id, type: "SUBCONTRACTOR", name: `Alpha Sub ${uniq}` },
      { organizationId: org.id, type: "SUBCONTRACTOR", name: `Bravo Sub ${uniq}` },
      { organizationId: org.id, type: "SUBCONTRACTOR", name: `Charlie Sub ${uniq}` },
    ])
    .returning();
  createdCrmOrgIds.add(crmOrgAlpha.id);
  createdCrmOrgIds.add(crmOrgBravo.id);
  createdCrmOrgIds.add(crmOrgCharlie.id);

  // ---------- RFIs ----------
  const rfiRows = await db
    .insert(rfis)
    .values([
      {
        organizationId: org.id,
        projectId: projectA.id,
        rfiNumber: `RFI-A-Alpha-${uniq}`,
        subject: "Conduit routing for Alpha in Project A",
        question: "Where does the conduit terminate?",
        submittedById: user.id,
        subcontractorId: crmOrgAlpha.id,
      },
      {
        organizationId: org.id,
        projectId: projectA.id,
        rfiNumber: `RFI-A-Bravo-${uniq}`,
        subject: "Slab penetration for Bravo in Project A",
        question: "Confirm penetration locations.",
        submittedById: user.id,
        subcontractorId: crmOrgBravo.id,
      },
      {
        organizationId: org.id,
        projectId: projectB.id,
        rfiNumber: `RFI-B-Alpha-${uniq}`,
        subject: "Coating system for Alpha in Project B",
        question: "Confirm the spec section.",
        submittedById: user.id,
        subcontractorId: crmOrgAlpha.id,
      },
    ])
    .returning();
  rfiRows.forEach((r) => createdRfiIds.add(r.id));
  const [rfiAA, rfiAB, rfiBA] = rfiRows;

  // ---------- Submittals ----------
  const submittalRows = await db
    .insert(submittals)
    .values([
      {
        organizationId: org.id,
        projectId: projectA.id,
        submittalNumber: `SUB-A-Alpha-${uniq}`,
        subject: "Anchor shop drawings (Alpha / Project A)",
        submittedById: user.id,
        subcontractorId: crmOrgAlpha.id,
      },
      {
        organizationId: org.id,
        projectId: projectA.id,
        submittalNumber: `SUB-A-Bravo-${uniq}`,
        subject: "Wall panels (Bravo / Project A)",
        submittedById: user.id,
        subcontractorId: crmOrgBravo.id,
      },
      {
        organizationId: org.id,
        projectId: projectB.id,
        submittalNumber: `SUB-B-Alpha-${uniq}`,
        subject: "Coating system (Alpha / Project B)",
        submittedById: user.id,
        subcontractorId: crmOrgAlpha.id,
      },
    ])
    .returning();
  submittalRows.forEach((s) => createdSubmittalIds.add(s.id));
  const [subAA, subAB, subBA] = submittalRows;

  // ---------- Transmittals + recipients ----------
  const transmittalRows = await db
    .insert(documentTransmittals)
    .values([
      {
        organizationId: org.id,
        projectId: projectA.id,
        transmittalNumber: `TR-A-Alpha-${uniq}`,
        subject: "Updated drawings to Alpha (Project A)",
        sentById: user.id,
      },
      {
        organizationId: org.id,
        projectId: projectA.id,
        transmittalNumber: `TR-A-Bravo-${uniq}`,
        subject: "Updated drawings to Bravo (Project A)",
        sentById: user.id,
      },
      {
        organizationId: org.id,
        projectId: projectB.id,
        transmittalNumber: `TR-B-Alpha-${uniq}`,
        subject: "Updated drawings to Alpha (Project B)",
        sentById: user.id,
      },
    ])
    .returning();
  transmittalRows.forEach((t) => createdTransmittalIds.add(t.id));
  const [trAA, trAB, trBA] = transmittalRows;

  const recipientRows = await db
    .insert(transmittalRecipients)
    .values([
      { transmittalId: trAA.id, subcontractorId: crmOrgAlpha.id },
      { transmittalId: trAB.id, subcontractorId: crmOrgBravo.id },
      { transmittalId: trBA.id, subcontractorId: crmOrgAlpha.id },
    ])
    .returning();
  recipientRows.forEach((r) => createdRecipientIds.add(r.id));

  // ---------- Tokens ----------
  const tokenAlphaInProjectA = await mintToken({
    organizationId: org.id,
    projectId: projectA.id,
    crmOrganisationId: crmOrgAlpha.id,
    contactEmail: `alpha-projA-${uniq}@example.test`,
    contactName: "Alpha Contact (Project A)",
  });
  const tokenBravoInProjectA = await mintToken({
    organizationId: org.id,
    projectId: projectA.id,
    crmOrganisationId: crmOrgBravo.id,
    contactEmail: `bravo-projA-${uniq}@example.test`,
    contactName: "Bravo Contact (Project A)",
  });
  const tokenAlphaInProjectB = await mintToken({
    organizationId: org.id,
    projectId: projectB.id,
    crmOrganisationId: crmOrgAlpha.id,
    contactEmail: `alpha-projB-${uniq}@example.test`,
    contactName: "Alpha Contact (Project B)",
  });
  const tokenCharlieInProjectA = await mintToken({
    organizationId: org.id,
    projectId: projectA.id,
    crmOrganisationId: crmOrgCharlie.id,
    contactEmail: `charlie-projA-${uniq}@example.test`,
    contactName: "Charlie Contact (Project A)",
  });

  return {
    orgId: org.id,
    userId: user.id,
    projectAId: projectA.id,
    projectBId: projectB.id,
    crmOrgAlphaId: crmOrgAlpha.id,
    crmOrgBravoId: crmOrgBravo.id,
    rfiProjectAAlphaId: rfiAA.id,
    rfiProjectABravoId: rfiAB.id,
    rfiProjectBAlphaId: rfiBA.id,
    submittalProjectAAlphaId: subAA.id,
    submittalProjectABravoId: subAB.id,
    submittalProjectBAlphaId: subBA.id,
    transmittalProjectAAlphaId: trAA.id,
    transmittalProjectABravoId: trAB.id,
    transmittalProjectBAlphaId: trBA.id,
    crmOrgCharlieId: crmOrgCharlie.id,
    tokenAlphaInProjectA,
    tokenBravoInProjectA,
    tokenAlphaInProjectB,
    tokenCharlieInProjectA,
  };
}

async function cleanup(): Promise<void> {
  // Delete in FK-respecting order. Token deletion cascades portal_activity_log
  // entries created by logPortalActivity during the test.
  if (createdTokenIds.size > 0) {
    await db
      .delete(subcontractorPortalTokens)
      .where(inArray(subcontractorPortalTokens.id, Array.from(createdTokenIds)));
  }
  if (createdRecipientIds.size > 0) {
    await db
      .delete(transmittalRecipients)
      .where(inArray(transmittalRecipients.id, Array.from(createdRecipientIds)));
  }
  if (createdTransmittalIds.size > 0) {
    await db
      .delete(documentTransmittals)
      .where(inArray(documentTransmittals.id, Array.from(createdTransmittalIds)));
  }
  if (createdSubmittalIds.size > 0) {
    await db.delete(submittals).where(inArray(submittals.id, Array.from(createdSubmittalIds)));
  }
  if (createdRfiIds.size > 0) {
    await db.delete(rfis).where(inArray(rfis.id, Array.from(createdRfiIds)));
  }
  if (createdCrmOrgIds.size > 0) {
    await db
      .delete(crmOrganisations)
      .where(inArray(crmOrganisations.id, Array.from(createdCrmOrgIds)));
  }
  if (createdUserIds.size > 0) {
    await db.delete(users).where(inArray(users.id, Array.from(createdUserIds)));
  }
  if (createdProjectIds.size > 0) {
    await db.delete(projects).where(inArray(projects.id, Array.from(createdProjectIds)));
  }
  if (createdOrgIds.size > 0) {
    await db.delete(organizations).where(inArray(organizations.id, Array.from(createdOrgIds)));
  }
  createdTokenIds.clear();
  createdRecipientIds.clear();
  createdTransmittalIds.clear();
  createdSubmittalIds.clear();
  createdRfiIds.clear();
  createdCrmOrgIds.clear();
  createdUserIds.clear();
  createdProjectIds.clear();
  createdOrgIds.clear();
}

beforeAll(async () => {
  const express = (await import("express")).default;
  const portalRouter = (await import("../portalRoutes")).default;

  app = express();
  app.use(express.json());
  app.use("/api", portalRouter);
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const e = err as { status?: number; statusCode?: number; message?: string } | null;
    const status = e?.status ?? e?.statusCode ?? 500;
    if (!res.headersSent) {
      res.status(status).json({ error: e?.message ?? "Internal Server Error" });
    }
  };
  app.use(errorHandler);

  fixture = await seedFixture();
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

describe("Task #1613 — sub-portal RFI/submittal/transmittal endpoints (projectId AND crmOrganisationId gating)", () => {
  describe("GET /api/portal/rfis", () => {
    it("returns only RFIs whose projectId AND subcontractorId match the token", async () => {
      const res = await request(app).get(
        `/api/portal/rfis?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);

      const ids = res.body.map((r: { id: string }) => r.id);
      expect(ids).toContain(fixture.rfiProjectAAlphaId);
      expect(ids).not.toContain(fixture.rfiProjectABravoId); // same project, different sub
      expect(ids).not.toContain(fixture.rfiProjectBAlphaId); // same sub, different project

      // No row should leak through with a mismatched projectId/subcontractorId.
      for (const row of res.body as Array<{ projectId: string; subcontractorId: string | null }>) {
        expect(row.projectId).toBe(fixture.projectAId);
        expect(row.subcontractorId).toBe(fixture.crmOrgAlphaId);
      }
    });

    it("a token whose projectId matches but crmOrganisationId does NOT only sees its own sub's RFIs", async () => {
      // tokenBravoInProjectA shares projectA with the alpha rows above but
      // belongs to a different CRM org — proves the subcontractorId predicate
      // still bites, not just the projectId one.
      const res = await request(app).get(
        `/api/portal/rfis?token=${fixture.tokenBravoInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(fixture.rfiProjectABravoId);
      expect(ids).not.toContain(fixture.rfiProjectAAlphaId);
      expect(ids).not.toContain(fixture.rfiProjectBAlphaId);
    });

    it("a token whose crmOrganisationId matches but projectId does NOT only sees its own project's RFIs", async () => {
      // tokenAlphaInProjectB shares the alpha CRM org with the alpha-in-A
      // rows above but belongs to a different project — proves the projectId
      // predicate still bites, not just the subcontractorId one.
      const res = await request(app).get(
        `/api/portal/rfis?token=${fixture.tokenAlphaInProjectB.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(fixture.rfiProjectBAlphaId);
      expect(ids).not.toContain(fixture.rfiProjectAAlphaId);
      expect(ids).not.toContain(fixture.rfiProjectABravoId);
    });

    it("returns an empty list (200) when the token's project has no RFIs for the token's sub", async () => {
      // tokenCharlieInProjectA: projectId = projectA (which DOES have RFIs
      // seeded — for alpha and bravo, not charlie). The crmOrganisationId
      // predicate must reject every one of those rows, so the response is [].
      const res = await request(app).get(
        `/api/portal/rfis?token=${fixture.tokenCharlieInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/portal/rfis/:id", () => {
    it("200s only when projectId AND subcontractorId match the token", async () => {
      const res = await request(app).get(
        `/api/portal/rfis/${fixture.rfiProjectAAlphaId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fixture.rfiProjectAAlphaId);
      expect(res.body.projectId).toBe(fixture.projectAId);
      expect(res.body.subcontractorId).toBe(fixture.crmOrgAlphaId);
    });

    it("403s when projectId matches but subcontractorId does not", async () => {
      const res = await request(app).get(
        `/api/portal/rfis/${fixture.rfiProjectABravoId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });
    });

    it("403s when subcontractorId matches but projectId does not", async () => {
      const res = await request(app).get(
        `/api/portal/rfis/${fixture.rfiProjectBAlphaId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });
    });
  });

  describe("GET /api/portal/submittals", () => {
    it("returns only submittals whose projectId AND subcontractorId match the token", async () => {
      const res = await request(app).get(
        `/api/portal/submittals?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain(fixture.submittalProjectAAlphaId);
      expect(ids).not.toContain(fixture.submittalProjectABravoId);
      expect(ids).not.toContain(fixture.submittalProjectBAlphaId);

      for (const row of res.body as Array<{ projectId: string; subcontractorId: string | null }>) {
        expect(row.projectId).toBe(fixture.projectAId);
        expect(row.subcontractorId).toBe(fixture.crmOrgAlphaId);
      }
    });

    it("a token whose projectId matches but crmOrganisationId does NOT only sees its own sub's submittals", async () => {
      const res = await request(app).get(
        `/api/portal/submittals?token=${fixture.tokenBravoInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain(fixture.submittalProjectABravoId);
      expect(ids).not.toContain(fixture.submittalProjectAAlphaId);
      expect(ids).not.toContain(fixture.submittalProjectBAlphaId);
    });

    it("a token whose crmOrganisationId matches but projectId does NOT only sees its own project's submittals", async () => {
      const res = await request(app).get(
        `/api/portal/submittals?token=${fixture.tokenAlphaInProjectB.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((s) => s.id);
      expect(ids).toContain(fixture.submittalProjectBAlphaId);
      expect(ids).not.toContain(fixture.submittalProjectAAlphaId);
      expect(ids).not.toContain(fixture.submittalProjectABravoId);
    });

    it("returns an empty list (200) when the token's project has no submittals for the token's sub", async () => {
      const res = await request(app).get(
        `/api/portal/submittals?token=${fixture.tokenCharlieInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/portal/submittals/:id", () => {
    it("200s only when projectId AND subcontractorId match the token", async () => {
      const res = await request(app).get(
        `/api/portal/submittals/${fixture.submittalProjectAAlphaId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fixture.submittalProjectAAlphaId);
      expect(res.body.projectId).toBe(fixture.projectAId);
      expect(res.body.subcontractorId).toBe(fixture.crmOrgAlphaId);
    });

    it("403s when projectId matches but subcontractorId does not", async () => {
      const res = await request(app).get(
        `/api/portal/submittals/${fixture.submittalProjectABravoId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });
    });

    it("403s when subcontractorId matches but projectId does not", async () => {
      const res = await request(app).get(
        `/api/portal/submittals/${fixture.submittalProjectBAlphaId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });
    });
  });

  describe("GET /api/portal/transmittals", () => {
    it("returns only transmittals whose projectId matches AND the token's crm org is on the recipient list", async () => {
      const res = await request(app).get(
        `/api/portal/transmittals?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(fixture.transmittalProjectAAlphaId);
      expect(ids).not.toContain(fixture.transmittalProjectABravoId); // same project, different recipient sub
      expect(ids).not.toContain(fixture.transmittalProjectBAlphaId); // same recipient sub, different project

      for (const row of res.body as Array<{ projectId: string }>) {
        expect(row.projectId).toBe(fixture.projectAId);
      }
    });

    it("a token whose projectId matches but crmOrganisationId does NOT only sees transmittals where its sub is the recipient", async () => {
      const res = await request(app).get(
        `/api/portal/transmittals?token=${fixture.tokenBravoInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(fixture.transmittalProjectABravoId);
      expect(ids).not.toContain(fixture.transmittalProjectAAlphaId);
      expect(ids).not.toContain(fixture.transmittalProjectBAlphaId);
    });

    it("a token whose crmOrganisationId matches but projectId does NOT only sees transmittals in its own project", async () => {
      const res = await request(app).get(
        `/api/portal/transmittals?token=${fixture.tokenAlphaInProjectB.rawToken}`,
      );
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((t) => t.id);
      expect(ids).toContain(fixture.transmittalProjectBAlphaId);
      expect(ids).not.toContain(fixture.transmittalProjectAAlphaId);
      expect(ids).not.toContain(fixture.transmittalProjectABravoId);
    });

    it("returns an empty list (200) when the token's project has transmittals but none list the token's sub as a recipient", async () => {
      // tokenCharlieInProjectA: projectId = projectA (which DOES have
      // transmittals seeded — for alpha and bravo, not charlie). The
      // recipient join must reject every one of those rows, so the
      // response is [].
      const res = await request(app).get(
        `/api/portal/transmittals?token=${fixture.tokenCharlieInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/portal/transmittals/:id", () => {
    it("200s only when projectId matches AND the token's sub is on the recipient list", async () => {
      const res = await request(app).get(
        `/api/portal/transmittals/${fixture.transmittalProjectAAlphaId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fixture.transmittalProjectAAlphaId);
      expect(res.body.projectId).toBe(fixture.projectAId);
    });

    it("403s with 'not a recipient' when projectId matches but the token's sub is not on the recipient list", async () => {
      // transmittalProjectABravoId is in projectA (matches tokenAlphaInProjectA's
      // projectId) but its only recipient row is for the bravo CRM org.
      const res = await request(app).get(
        `/api/portal/transmittals/${fixture.transmittalProjectABravoId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied - not a recipient" });
    });

    it("403s when the token's sub IS on the recipient list but the transmittal belongs to a different project", async () => {
      // transmittalProjectBAlphaId has alpha as a recipient, but its project
      // is projectB — so tokenAlphaInProjectA (projectA + alpha) must be
      // refused on the projectId predicate before the recipient check runs.
      const res = await request(app).get(
        `/api/portal/transmittals/${fixture.transmittalProjectBAlphaId}?token=${fixture.tokenAlphaInProjectA.rawToken}`,
      );
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });
    });
  });
});
