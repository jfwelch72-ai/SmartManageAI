// Task #1608: end-to-end test for the external-doc portal email link.
// `sendExternalDocEmail` mints a `subcontractor_portal_tokens` row and emails
// a `/sub-portal?token=…` link; this exercises the round trip back through
// `requirePortalAuth` against the real DB so the production status/TTL WHERE
// clauses are what gate access (an in-memory mock would mask regressions there).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import bcrypt from "bcrypt";
import type { Express, ErrorRequestHandler } from "express";
import request from "supertest";
import { sql, inArray } from "drizzle-orm";

const isFeatureEnabledMock = vi.fn(async () => true);
vi.mock("../services/featureFlagService", () => ({
  isFeatureEnabled: (...args: unknown[]) => isFeatureEnabledMock(...args),
}));

const sentEmails: Array<{ to: string; subject: string; html: string; text: string }> = [];
vi.mock("../services/emailService", () => ({
  sendEmail: async (msg: { to: string; subject: string; html: string; text: string }) => {
    sentEmails.push(msg);
  },
}));
vi.mock("../email", () => ({ sendEmail: async () => undefined }));

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  crmOrganisations,
  crmContacts,
  subcontractorPortalTokens,
  auditLog,
} from "@shared/schema";

interface SeededTenant {
  orgId: string;
  userId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  crmOrgId: string;
  crmOrgName: string;
  crmContactId: string;
  recipientEmail: string;
}

// Exact-ID trackers so cleanup only deletes rows this test created.
const createdOrgIds = new Set<string>();
const createdUserIds = new Set<string>();
const createdProjectIds = new Set<string>();
const createdCrmOrgIds = new Set<string>();
const createdCrmContactIds = new Set<string>();

async function seedTenant(label: string): Promise<SeededTenant> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `extdoc-e2e-${label}-${uniq}`;
  const projectCode = `EDPL-${label}-${uniq}`;
  const recipientEmail = `${label.toLowerCase()}-${uniq}@extdoc-e2e.test`;

  const [org] = await db.insert(organizations).values({
    name: `External-Doc Email E2E Org ${label}`,
    slug,
    tradeType: "GENERAL_CONTRACTOR",
    onboardingStatus: "COMPLETED",
    isActive: true,
  }).returning();
  createdOrgIds.add(org.id);

  const [user] = await db.insert(users).values({
    email: `inviter-${slug}@extdoc-e2e.test`,
    firstName: "Inviter",
    lastName: `User-${label}`,
    role: "ADMIN",
    organizationId: org.id,
    isActive: true,
  }).returning();
  createdUserIds.add(user.id);

  const projectName = `External-Doc Email E2E Project ${label}`;
  const [project] = await db.insert(projects).values({
    name: projectName,
    code: projectCode,
    clientName: `Client ${label}`,
  }).returning();
  createdProjectIds.add(project.id);

  const crmOrgName = `External A/E Firm ${label} ${uniq}`;
  const [crmOrg] = await db.insert(crmOrganisations).values({
    organizationId: org.id,
    type: "SUBCONTRACTOR",
    name: crmOrgName,
  }).returning();
  createdCrmOrgIds.add(crmOrg.id);

  const [contact] = await db.insert(crmContacts).values({
    organizationId: org.id,
    organisationId: crmOrg.id,
    firstName: "Pat",
    lastName: `Reviewer-${label}`,
    email: recipientEmail,
    role: "OTHER",
    isActive: true,
  }).returning();
  createdCrmContactIds.add(contact.id);

  return {
    orgId: org.id,
    userId: user.id,
    projectId: project.id,
    projectName,
    projectCode,
    crmOrgId: crmOrg.id,
    crmOrgName,
    crmContactId: contact.id,
    recipientEmail,
  };
}

async function cleanup(): Promise<void> {
  // Delete strictly by IDs we created, in FK-respecting order.
  if (createdOrgIds.size > 0) {
    await db.delete(subcontractorPortalTokens).where(
      inArray(subcontractorPortalTokens.organizationId, Array.from(createdOrgIds)),
    );
  }
  if (createdUserIds.size > 0) {
    // audit_log rows from sendExternalDocEmail reference user_id (FK to users).
    await db.delete(auditLog).where(inArray(auditLog.userId, Array.from(createdUserIds)));
  }
  if (createdCrmContactIds.size > 0) {
    await db.delete(crmContacts).where(inArray(crmContacts.id, Array.from(createdCrmContactIds)));
  }
  if (createdCrmOrgIds.size > 0) {
    await db.delete(crmOrganisations).where(inArray(crmOrganisations.id, Array.from(createdCrmOrgIds)));
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
  createdOrgIds.clear();
  createdUserIds.clear();
  createdProjectIds.clear();
  createdCrmOrgIds.clear();
  createdCrmContactIds.clear();
}

let app: Express;
let sendExternalDocEmail: typeof import("../services/externalDocEmailService")["sendExternalDocEmail"];

beforeAll(async () => {
  const express = (await import("express")).default;
  const portalRouter = (await import("../portalRoutes")).default;
  ({ sendExternalDocEmail } = await import("../services/externalDocEmailService"));

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
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

beforeEach(() => {
  sentEmails.length = 0;
  isFeatureEnabledMock.mockReset();
  isFeatureEnabledMock.mockResolvedValue(true);
});

function extractTokenFromEmail(html: string): string {
  const match = html.match(/\/sub-portal\?token=([a-f0-9]+)/);
  if (!match) throw new Error(`No /sub-portal?token=… link in email body`);
  return match[1];
}

describe("Task #1608 — external-doc portal email link end-to-end", () => {
  it("happy path: minted token unlocks /api/portal/info for the right project + crm org", async () => {
    const tenant = await seedTenant("Happy");

    const result = await sendExternalDocEmail({
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      recipientEmail: tenant.recipientEmail,
      documentNumber: "RFI-0001",
      documentSubject: "Conduit routing",
      kind: "RFI_FORWARD",
      inviterId: tenant.userId,
      inviterName: "PM Happy",
    });

    expect(result.delivered).toBe(true);
    expect(result.portalTokenId).toBeTruthy();
    expect(sentEmails).toHaveLength(1);

    const [stored] = await db
      .select()
      .from(subcontractorPortalTokens)
      .where(sql`${subcontractorPortalTokens.id} = ${result.portalTokenId}`);
    expect(stored).toBeDefined();
    expect(stored.organizationId).toBe(tenant.orgId);
    expect(stored.projectId).toBe(tenant.projectId);
    expect(stored.crmOrganisationId).toBe(tenant.crmOrgId);
    expect(stored.contactEmail).toBe(tenant.recipientEmail);
    expect(stored.status).toBe("active");
    const ttlMs = stored.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
    expect(ttlMs).toBeLessThan(91 * 24 * 60 * 60 * 1000);

    // Raw token isn't stored — recover it from the email and check it
    // bcrypt-verifies against the persisted hash.
    const rawToken = extractTokenFromEmail(sentEmails[0].html);
    expect(rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(await bcrypt.compare(rawToken, stored.tokenHash)).toBe(true);

    const res = await request(app).get(`/api/portal/info?token=${rawToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      project: { id: tenant.projectId, name: tenant.projectName, code: tenant.projectCode },
      subcontractor: { id: tenant.crmOrgId, name: tenant.crmOrgName },
      contactEmail: tenant.recipientEmail,
    });
    expect(res.body.contactName).toContain("Pat");
    expect(res.body.permissions).toEqual(expect.arrayContaining(["view", "comment"]));
  });

  it("tenant isolation: A's token cannot read B's project (and vice-versa)", async () => {
    const tenantA = await seedTenant("AAA");
    const tenantB = await seedTenant("BBB");

    await sendExternalDocEmail({
      organizationId: tenantA.orgId,
      projectId: tenantA.projectId,
      recipientEmail: tenantA.recipientEmail,
      documentNumber: "RFI-0001",
      documentSubject: "Conduit routing",
      kind: "RFI_FORWARD",
      inviterId: tenantA.userId,
      inviterName: "PM A",
    });
    const tokenA = extractTokenFromEmail(sentEmails[0].html);

    await sendExternalDocEmail({
      organizationId: tenantB.orgId,
      projectId: tenantB.projectId,
      recipientEmail: tenantB.recipientEmail,
      documentNumber: "SUB-0042",
      documentSubject: "Coating system",
      kind: "SUBMITTAL_REVIEW",
      inviterId: tenantB.userId,
      inviterName: "PM B",
    });
    const tokenB = extractTokenFromEmail(sentEmails[1].html);

    expect(tokenA).not.toEqual(tokenB);

    const resA = await request(app).get(`/api/portal/info?token=${tokenA}`);
    expect(resA.status).toBe(200);
    expect(resA.body.project.id).toBe(tenantA.projectId);
    expect(resA.body.subcontractor.id).toBe(tenantA.crmOrgId);
    expect(resA.body.contactEmail).toBe(tenantA.recipientEmail);
    const bodyA = JSON.stringify(resA.body);
    expect(bodyA).not.toContain(tenantB.projectId);
    expect(bodyA).not.toContain(tenantB.crmOrgId);
    expect(bodyA).not.toContain(tenantB.recipientEmail);

    const resB = await request(app).get(`/api/portal/info?token=${tokenB}`);
    expect(resB.status).toBe(200);
    expect(resB.body.project.id).toBe(tenantB.projectId);
    expect(resB.body.subcontractor.id).toBe(tenantB.crmOrgId);
    expect(resB.body.contactEmail).toBe(tenantB.recipientEmail);
    const bodyB = JSON.stringify(resB.body);
    expect(bodyB).not.toContain(tenantA.projectId);
    expect(bodyB).not.toContain(tenantA.crmOrgId);
    expect(bodyB).not.toContain(tenantA.recipientEmail);
  });

  it("rejects an expired token with 401", async () => {
    const tenant = await seedTenant("Expired");

    const result = await sendExternalDocEmail({
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      recipientEmail: tenant.recipientEmail,
      documentNumber: "RFI-0001",
      documentSubject: "Conduit routing",
      kind: "RFI_FORWARD",
      inviterId: tenant.userId,
      inviterName: "PM Expired",
    });
    const rawToken = extractTokenFromEmail(sentEmails[0].html);

    // Sanity: token works pre-expiry, so the only thing the negative
    // case below tests is the expiresAt predicate in requirePortalAuth.
    const okRes = await request(app).get(`/api/portal/info?token=${rawToken}`);
    expect(okRes.status).toBe(200);

    await db.execute(sql`
      UPDATE subcontractor_portal_tokens
      SET expires_at = ${new Date(Date.now() - 60 * 1000)}
      WHERE id = ${result.portalTokenId}
    `);

    const res = await request(app).get(`/api/portal/info?token=${rawToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired portal access token" });
  });

  it("rejects a revoked token with 401", async () => {
    const tenant = await seedTenant("Revoked");

    const result = await sendExternalDocEmail({
      organizationId: tenant.orgId,
      projectId: tenant.projectId,
      recipientEmail: tenant.recipientEmail,
      documentNumber: "RFI-0001",
      documentSubject: "Conduit routing",
      kind: "RFI_FORWARD",
      inviterId: tenant.userId,
      inviterName: "PM Revoked",
    });
    const rawToken = extractTokenFromEmail(sentEmails[0].html);

    const okRes = await request(app).get(`/api/portal/info?token=${rawToken}`);
    expect(okRes.status).toBe(200);

    await db.execute(sql`
      UPDATE subcontractor_portal_tokens
      SET status = 'revoked', revoked_at = NOW()
      WHERE id = ${result.portalTokenId}
    `);

    const res = await request(app).get(`/api/portal/info?token=${rawToken}`);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Invalid or expired portal access token" });
  });

  it("rejects a request with no token with 401", async () => {
    const res = await request(app).get("/api/portal/info");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Portal access token required" });
  });
});
