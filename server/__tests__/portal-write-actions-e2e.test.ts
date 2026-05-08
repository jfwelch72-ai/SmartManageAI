// Task #1625: end-to-end tests for the sub-portal WRITE endpoints
// (`POST /api/portal/rfis/:id/comment`, `POST /api/portal/submittals/:id/comment`,
// `POST /api/portal/submittals/:id/upload`,
// `POST /api/portal/transmittals/:id/acknowledge`).
//
// Tasks #1608 and #1613 covered the read endpoints. The write endpoints rerun
// the same `token.projectId` + `token.crmOrganisationId` checks AND additionally
// gate on a per-action permission ("comment"/"upload"/"acknowledge"). Nothing
// pinned that contract before this suite — a regression that loosened either
// check, or that let a token without the right permission perform the action,
// would silently let one external A/E post a comment / upload a file /
// acknowledge a transmittal that belongs to a different tenant.
//
// For each write endpoint this suite exercises:
//   1. Happy path  — token whose project + crm-org + permission all match.
//                    Verifies the row was actually written
//                    (rfi_activity / submittal_activity insert, attachments_json
//                    append, transmittal_recipients.acknowledged flip).
//   2. Mismatched crmOrganisationId — token whose projectId matches but whose
//                    crmOrganisationId does not. Expects 403, no row written.
//   3. Missing permission — token whose project + crm-org match but whose
//                    permissions array does not include the required action.
//                    Expects 403, no row written.
//
// `notifyGcTeamOfPortalActivity` (called fire-and-forget by every write route)
// inserts into `notifications` via `insertNotifications`. We mock that module
// to a no-op so the background task can't race with cleanup or leak rows
// across tests, mirroring the email-mock pattern used by #1608's
// `external-doc-portal-link-e2e.test.ts`. Email modules are also mocked
// defensively even though the write routes themselves don't call sendEmail.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcrypt";
import crypto from "crypto";
import type { Express, ErrorRequestHandler } from "express";
import request from "supertest";
import { eq, and, inArray } from "drizzle-orm";

const insertNotificationsMock = vi.fn(async () => undefined);
vi.mock("../services/notificationService", async () => {
  const actual = await vi.importActual<typeof import("../services/notificationService")>(
    "../services/notificationService",
  );
  return {
    ...actual,
    insertNotifications: insertNotificationsMock,
  };
});
vi.mock("../email", () => ({ sendEmail: async () => undefined }));
vi.mock("../services/emailService", () => ({ sendEmail: async () => undefined }));

import { db } from "../db";
import {
  organizations,
  users,
  projects,
  crmOrganisations,
  subcontractorPortalTokens,
  rfis,
  rfiActivity,
  submittals,
  submittalActivity,
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
  permissions: string[];
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
      permissions: args.permissions,
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
  rfiId: string;             // projectA + Alpha
  submittalId: string;       // projectA + Alpha
  transmittalId: string;     // projectA, recipient = Alpha
  recipientId: string;       // recipient row for Alpha on transmittal
  // Tokens
  tokenAlphaFull: MintedToken;     // projectA + Alpha + comment/upload/acknowledge → happy path
  tokenBravoFull: MintedToken;     // projectA + Bravo + comment/upload/acknowledge → mismatched crm org
  tokenAlphaViewOnly: MintedToken; // projectA + Alpha + only "view" → missing permission
}

let fixture: SeedFixture;
let app: Express;

async function seedFixture(): Promise<SeedFixture> {
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: `Portal-Write E2E Org ${uniq}`,
      slug: `portal-write-e2e-${uniq}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  createdOrgIds.add(org.id);

  const [user] = await db
    .insert(users)
    .values({
      email: `portal-write-e2e-${uniq}@example.test`,
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
      { name: `Portal Write E2E A ${uniq}`, code: `PWE2E-A-${uniq}`, clientName: "Client A" },
      { name: `Portal Write E2E B ${uniq}`, code: `PWE2E-B-${uniq}`, clientName: "Client B" },
    ])
    .returning();
  createdProjectIds.add(projectA.id);
  createdProjectIds.add(projectB.id);

  const [crmOrgAlpha, crmOrgBravo] = await db
    .insert(crmOrganisations)
    .values([
      { organizationId: org.id, type: "SUBCONTRACTOR", name: `Alpha Sub ${uniq}` },
      { organizationId: org.id, type: "SUBCONTRACTOR", name: `Bravo Sub ${uniq}` },
    ])
    .returning();
  createdCrmOrgIds.add(crmOrgAlpha.id);
  createdCrmOrgIds.add(crmOrgBravo.id);

  // Single RFI/submittal/transmittal — all attributed to Alpha on Project A.
  // The mismatched-crmOrg test uses tokenBravoFull (same project, different
  // sub) trying to act on these rows.
  const [rfi] = await db
    .insert(rfis)
    .values({
      organizationId: org.id,
      projectId: projectA.id,
      rfiNumber: `RFI-WRITE-${uniq}`,
      subject: "Portal write-action target RFI",
      question: "Need clarification on scope.",
      submittedById: user.id,
      subcontractorId: crmOrgAlpha.id,
    })
    .returning();
  createdRfiIds.add(rfi.id);

  const [submittal] = await db
    .insert(submittals)
    .values({
      organizationId: org.id,
      projectId: projectA.id,
      submittalNumber: `SUB-WRITE-${uniq}`,
      subject: "Portal write-action target submittal",
      submittedById: user.id,
      subcontractorId: crmOrgAlpha.id,
    })
    .returning();
  createdSubmittalIds.add(submittal.id);

  const [transmittal] = await db
    .insert(documentTransmittals)
    .values({
      organizationId: org.id,
      projectId: projectA.id,
      transmittalNumber: `TR-WRITE-${uniq}`,
      subject: "Portal write-action target transmittal",
      sentById: user.id,
    })
    .returning();
  createdTransmittalIds.add(transmittal.id);

  const [recipient] = await db
    .insert(transmittalRecipients)
    .values({
      transmittalId: transmittal.id,
      subcontractorId: crmOrgAlpha.id,
    })
    .returning();
  createdRecipientIds.add(recipient.id);

  // ---------- Tokens ----------
  const tokenAlphaFull = await mintToken({
    organizationId: org.id,
    projectId: projectA.id,
    crmOrganisationId: crmOrgAlpha.id,
    contactEmail: `alpha-full-${uniq}@example.test`,
    contactName: "Alpha Contact (Full Permissions)",
    permissions: ["view", "comment", "upload", "acknowledge"],
  });
  const tokenBravoFull = await mintToken({
    organizationId: org.id,
    projectId: projectA.id,
    crmOrganisationId: crmOrgBravo.id,
    contactEmail: `bravo-full-${uniq}@example.test`,
    contactName: "Bravo Contact (Full Permissions)",
    permissions: ["view", "comment", "upload", "acknowledge"],
  });
  const tokenAlphaViewOnly = await mintToken({
    organizationId: org.id,
    projectId: projectA.id,
    crmOrganisationId: crmOrgAlpha.id,
    contactEmail: `alpha-view-${uniq}@example.test`,
    contactName: "Alpha Contact (View Only)",
    permissions: ["view"],
  });

  // ---------- Placeholder users for the comment routes ----------
  // The RFI / submittal comment handlers insert into rfi_activity /
  // submittal_activity with `user_id = 'portal_<token.id>'`. Both columns
  // have a NOT NULL FK -> users.id, so the happy path requires a users row
  // whose id matches `portal_<tokenAlphaFull.id>`. tokenBravoFull and
  // tokenAlphaViewOnly never reach the insert — the projectId / crmOrgId
  // mismatch (403) and the permission middleware (403) both short-circuit
  // before any row is written — so they don't need a placeholder user.
  // This is a known production deficiency (see follow-up); without the
  // placeholder, the live route would 500 with a foreign-key violation.
  const [placeholderUser] = await db
    .insert(users)
    .values({
      id: `portal_${tokenAlphaFull.id}`,
      email: `placeholder-${tokenAlphaFull.id}@portal-write-e2e.test`,
      firstName: "Portal",
      lastName: "Placeholder",
      role: "FIELD_WORKER",
      organizationId: org.id,
      isActive: false,
    })
    .returning();
  createdUserIds.add(placeholderUser.id);

  return {
    orgId: org.id,
    userId: user.id,
    projectAId: projectA.id,
    projectBId: projectB.id,
    crmOrgAlphaId: crmOrgAlpha.id,
    crmOrgBravoId: crmOrgBravo.id,
    rfiId: rfi.id,
    submittalId: submittal.id,
    transmittalId: transmittal.id,
    recipientId: recipient.id,
    tokenAlphaFull,
    tokenBravoFull,
    tokenAlphaViewOnly,
  };
}

async function cleanup(): Promise<void> {
  // Delete in FK-respecting order. Token deletion cascades portal_activity_log.
  // RFI / submittal deletion cascades their activity tables, which lets us
  // safely drop the placeholder user afterwards.
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

describe("Task #1625 — sub-portal WRITE actions (projectId + crmOrganisationId + permission gating)", () => {
  // ============================================================
  // POST /api/portal/rfis/:id/comment
  // ============================================================
  describe("POST /api/portal/rfis/:id/comment", () => {
    it("happy path: token whose project + crm-org + permission match writes an rfi_activity row", async () => {
      const before = await db
        .select()
        .from(rfiActivity)
        .where(eq(rfiActivity.rfiId, fixture.rfiId));
      const beforeCount = before.length;

      const res = await request(app)
        .post(
          `/api/portal/rfis/${fixture.rfiId}/comment?token=${fixture.tokenAlphaFull.rawToken}`,
        )
        .send({ comment: "Question about the scope." });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });

      const after = await db
        .select()
        .from(rfiActivity)
        .where(eq(rfiActivity.rfiId, fixture.rfiId));
      expect(after.length).toBe(beforeCount + 1);
      const inserted = after.find(
        (row) =>
          !before.some((b) => b.id === row.id) &&
          row.userId === `portal_${fixture.tokenAlphaFull.id}`,
      );
      expect(inserted).toBeDefined();
      expect(inserted!.action).toBe("COMMENT");
      expect(inserted!.comment).toBe("Question about the scope.");
      expect(inserted!.userName).toBe("Alpha Contact (Full Permissions)");
    });

    it("403s and writes nothing when projectId matches but crmOrganisationId does not", async () => {
      const before = await db
        .select()
        .from(rfiActivity)
        .where(eq(rfiActivity.rfiId, fixture.rfiId));

      const res = await request(app)
        .post(
          `/api/portal/rfis/${fixture.rfiId}/comment?token=${fixture.tokenBravoFull.rawToken}`,
        )
        .send({ comment: "Trying to comment from a different sub." });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });

      const after = await db
        .select()
        .from(rfiActivity)
        .where(eq(rfiActivity.rfiId, fixture.rfiId));
      expect(after.length).toBe(before.length);
      expect(
        after.some((row) => row.userId === `portal_${fixture.tokenBravoFull.id}`),
      ).toBe(false);
    });

    it("403s and writes nothing when the token lacks the 'comment' permission", async () => {
      const before = await db
        .select()
        .from(rfiActivity)
        .where(eq(rfiActivity.rfiId, fixture.rfiId));

      const res = await request(app)
        .post(
          `/api/portal/rfis/${fixture.rfiId}/comment?token=${fixture.tokenAlphaViewOnly.rawToken}`,
        )
        .send({ comment: "View-only token should not be able to post." });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Permission 'comment' is required for this action",
      });

      const after = await db
        .select()
        .from(rfiActivity)
        .where(eq(rfiActivity.rfiId, fixture.rfiId));
      expect(after.length).toBe(before.length);
      expect(
        after.some((row) => row.userId === `portal_${fixture.tokenAlphaViewOnly.id}`),
      ).toBe(false);
    });
  });

  // ============================================================
  // POST /api/portal/submittals/:id/comment
  // ============================================================
  describe("POST /api/portal/submittals/:id/comment", () => {
    it("happy path: token whose project + crm-org + permission match writes a submittal_activity row", async () => {
      const before = await db
        .select()
        .from(submittalActivity)
        .where(eq(submittalActivity.submittalId, fixture.submittalId));
      const beforeCount = before.length;

      const res = await request(app)
        .post(
          `/api/portal/submittals/${fixture.submittalId}/comment?token=${fixture.tokenAlphaFull.rawToken}`,
        )
        .send({ comment: "Submittal comment from Alpha." });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });

      const after = await db
        .select()
        .from(submittalActivity)
        .where(eq(submittalActivity.submittalId, fixture.submittalId));
      expect(after.length).toBe(beforeCount + 1);
      const inserted = after.find(
        (row) =>
          !before.some((b) => b.id === row.id) &&
          row.userId === `portal_${fixture.tokenAlphaFull.id}`,
      );
      expect(inserted).toBeDefined();
      expect(inserted!.action).toBe("COMMENT");
      expect(inserted!.comment).toBe("Submittal comment from Alpha.");
      expect(inserted!.userName).toBe("Alpha Contact (Full Permissions)");
    });

    it("403s and writes nothing when projectId matches but crmOrganisationId does not", async () => {
      const before = await db
        .select()
        .from(submittalActivity)
        .where(eq(submittalActivity.submittalId, fixture.submittalId));

      const res = await request(app)
        .post(
          `/api/portal/submittals/${fixture.submittalId}/comment?token=${fixture.tokenBravoFull.rawToken}`,
        )
        .send({ comment: "Trying to comment from a different sub." });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });

      const after = await db
        .select()
        .from(submittalActivity)
        .where(eq(submittalActivity.submittalId, fixture.submittalId));
      expect(after.length).toBe(before.length);
      expect(
        after.some((row) => row.userId === `portal_${fixture.tokenBravoFull.id}`),
      ).toBe(false);
    });

    it("403s and writes nothing when the token lacks the 'comment' permission", async () => {
      const before = await db
        .select()
        .from(submittalActivity)
        .where(eq(submittalActivity.submittalId, fixture.submittalId));

      const res = await request(app)
        .post(
          `/api/portal/submittals/${fixture.submittalId}/comment?token=${fixture.tokenAlphaViewOnly.rawToken}`,
        )
        .send({ comment: "View-only token should not be able to post." });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Permission 'comment' is required for this action",
      });

      const after = await db
        .select()
        .from(submittalActivity)
        .where(eq(submittalActivity.submittalId, fixture.submittalId));
      expect(after.length).toBe(before.length);
      expect(
        after.some((row) => row.userId === `portal_${fixture.tokenAlphaViewOnly.id}`),
      ).toBe(false);
    });
  });

  // ============================================================
  // POST /api/portal/submittals/:id/upload
  // ============================================================
  describe("POST /api/portal/submittals/:id/upload", () => {
    async function readAttachments(submittalId: string): Promise<unknown[]> {
      const [row] = await db
        .select({ attachmentsJson: submittals.attachmentsJson })
        .from(submittals)
        .where(eq(submittals.id, submittalId))
        .limit(1);
      if (!row?.attachmentsJson) return [];
      try {
        const parsed = JSON.parse(row.attachmentsJson);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    it("happy path: token whose project + crm-org + permission match appends to attachments_json", async () => {
      const before = await readAttachments(fixture.submittalId);
      const beforeCount = before.length;

      const res = await request(app)
        .post(
          `/api/portal/submittals/${fixture.submittalId}/upload?token=${fixture.tokenAlphaFull.rawToken}`,
        )
        .send({
          fileUrl: "https://example.test/uploads/alpha-shop-drawings.pdf",
          fileName: "alpha-shop-drawings.pdf",
          fileSize: 1024,
          mimeType: "application/pdf",
          description: "Updated shop drawings",
        });

      expect(res.status).toBe(201);
      expect(res.body.fileName).toBe("alpha-shop-drawings.pdf");
      expect(res.body.uploadedByPortal).toBe(true);
      expect(res.body.uploadedByName).toBe("Alpha Contact (Full Permissions)");

      const after = await readAttachments(fixture.submittalId);
      expect(after.length).toBe(beforeCount + 1);
      const appended = after[after.length - 1] as Record<string, unknown>;
      expect(appended.fileName).toBe("alpha-shop-drawings.pdf");
      expect(appended.fileUrl).toBe("https://example.test/uploads/alpha-shop-drawings.pdf");
      expect(appended.uploadedByPortal).toBe(true);
      expect(appended.uploadedByName).toBe("Alpha Contact (Full Permissions)");
    });

    it("403s and writes nothing when projectId matches but crmOrganisationId does not", async () => {
      const before = await readAttachments(fixture.submittalId);

      const res = await request(app)
        .post(
          `/api/portal/submittals/${fixture.submittalId}/upload?token=${fixture.tokenBravoFull.rawToken}`,
        )
        .send({
          fileUrl: "https://example.test/uploads/bravo-leak.pdf",
          fileName: "bravo-leak.pdf",
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: "Access denied" });

      const after = await readAttachments(fixture.submittalId);
      expect(after.length).toBe(before.length);
      expect(
        after.some((a) => (a as { fileName?: string }).fileName === "bravo-leak.pdf"),
      ).toBe(false);
    });

    it("403s and writes nothing when the token lacks the 'upload' permission", async () => {
      const before = await readAttachments(fixture.submittalId);

      const res = await request(app)
        .post(
          `/api/portal/submittals/${fixture.submittalId}/upload?token=${fixture.tokenAlphaViewOnly.rawToken}`,
        )
        .send({
          fileUrl: "https://example.test/uploads/view-only-leak.pdf",
          fileName: "view-only-leak.pdf",
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Permission 'upload' is required for this action",
      });

      const after = await readAttachments(fixture.submittalId);
      expect(after.length).toBe(before.length);
      expect(
        after.some(
          (a) => (a as { fileName?: string }).fileName === "view-only-leak.pdf",
        ),
      ).toBe(false);
    });
  });

  // ============================================================
  // POST /api/portal/transmittals/:id/acknowledge
  // ============================================================
  describe("POST /api/portal/transmittals/:id/acknowledge", () => {
    async function readRecipient(recipientId: string) {
      const [row] = await db
        .select()
        .from(transmittalRecipients)
        .where(eq(transmittalRecipients.id, recipientId))
        .limit(1);
      return row;
    }

    it("403s and does NOT flip acknowledged when projectId matches but crmOrganisationId does not", async () => {
      // Run this before the happy path so the recipient row is still in its
      // pristine (acknowledged=false) state. tokenBravoFull is on Project A
      // but is NOT on this transmittal's recipient list, so the route's
      // recipient-lookup branch must reject it.
      const before = await readRecipient(fixture.recipientId);
      expect(before?.acknowledged).toBe(false);

      const res = await request(app).post(
        `/api/portal/transmittals/${fixture.transmittalId}/acknowledge?token=${fixture.tokenBravoFull.rawToken}`,
      );

      expect(res.status).toBe(403);
      // The route returns "Access denied - not a recipient" when the
      // crmOrganisationId predicate fails the recipient-lookup branch.
      expect(res.body).toEqual({ error: "Access denied - not a recipient" });

      const after = await readRecipient(fixture.recipientId);
      expect(after?.acknowledged).toBe(false);
      expect(after?.acknowledgedAt).toBeNull();
    });

    it("403s and does NOT flip acknowledged when the token lacks the 'acknowledge' permission", async () => {
      const before = await readRecipient(fixture.recipientId);
      expect(before?.acknowledged).toBe(false);

      const res = await request(app).post(
        `/api/portal/transmittals/${fixture.transmittalId}/acknowledge?token=${fixture.tokenAlphaViewOnly.rawToken}`,
      );

      expect(res.status).toBe(403);
      expect(res.body).toEqual({
        error: "Permission 'acknowledge' is required for this action",
      });

      const after = await readRecipient(fixture.recipientId);
      expect(after?.acknowledged).toBe(false);
      expect(after?.acknowledgedAt).toBeNull();
    });

    it("happy path: token whose project + crm-org + permission match flips transmittal_recipients.acknowledged true", async () => {
      const before = await readRecipient(fixture.recipientId);
      expect(before?.acknowledged).toBe(false);

      const res = await request(app).post(
        `/api/portal/transmittals/${fixture.transmittalId}/acknowledge?token=${fixture.tokenAlphaFull.rawToken}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(fixture.recipientId);
      expect(res.body.acknowledged).toBe(true);

      const after = await readRecipient(fixture.recipientId);
      expect(after?.acknowledged).toBe(true);
      expect(after?.acknowledgedAt).toBeInstanceOf(Date);

      // Sanity-check the scope of the update — only this token's recipient
      // row got flipped, not every recipient on this transmittal.
      const allForTransmittal = await db
        .select()
        .from(transmittalRecipients)
        .where(
          and(
            eq(transmittalRecipients.transmittalId, fixture.transmittalId),
            eq(transmittalRecipients.acknowledged, true),
          ),
        );
      expect(allForTransmittal.length).toBe(1);
      expect(allForTransmittal[0].subcontractorId).toBe(fixture.crmOrgAlphaId);
    });
  });
});
