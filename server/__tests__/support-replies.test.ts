// Task #2825 — Integration tests for the ticket reply flow.
// Covers: POST /api/support/tickets/:id/replies and GET /api/support/tickets/:id/replies
//
// Behaviours under test:
//   1. POST /replies stamps firstResponseAt exactly once (idempotent on second reply)
//   2. POST /replies moves ticket status from open → in_progress
//   3. POST /replies sends email to the ticket submitter
//   4. POST /replies still succeeds (201) when email sending fails
//   5. POST /replies by a non-SUPER_ADMIN returns 403
//   6. POST /replies for a non-existent ticket returns 404
//   7. GET /replies returns replies in ascending (createdAt) order

import { describe, it, expect, beforeAll, afterAll, vi, type MockInstance } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { users, organizations, supportTickets, supportTicketReplies } from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";

// ─── mock email so tests never actually send mail ───────────────────────────
vi.mock("../email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// Import the mock *after* vi.mock is hoisted so we can inspect calls.
// We use a lazy import inside each test block via getSendEmailMock() below.
async function getSendEmailMock(): Promise<MockInstance> {
  const mod = await import("../email");
  return mod.sendEmail as unknown as MockInstance;
}

// Unique per-run prefix keeps tickets scoped to this suite only.
const PREFIX = `__sup_replies_${Date.now()}_`;
const SUBMITTER_EMAIL = `${PREFIX}submitter@test.local`;

let app: Express;
let superAdminToken: string;
let adminToken: string;

async function seedSuperAdmin() {
  const slug = `${PREFIX}sa-${Math.random().toString(36).slice(2, 8)}`;
  const [user] = await db
    .insert(users)
    .values({
      email: `${slug}@test.local`,
      passwordHash: await bcrypt.hash("TestPass!", 10),
      firstName: "Super",
      lastName: "Admin",
      role: "SUPER_ADMIN",
      organizationId: null,
      isActive: true,
    })
    .returning();
  return { userId: user.id, token: generateToken(user.id, user.tokenVersion ?? 0) };
}

async function seedOrgAdmin() {
  const slug = `${PREFIX}admin-${Math.random().toString(36).slice(2, 8)}`;

  const [org] = await db
    .insert(organizations)
    .values({
      name: `SupportReplies Org ${slug}`,
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
      passwordHash: await bcrypt.hash("TestPass!", 10),
      firstName: "Org",
      lastName: "Admin",
      role: "ADMIN",
      organizationId: org.id,
      isActive: true,
    })
    .returning();

  return { userId: user.id, token: generateToken(user.id, user.tokenVersion ?? 0) };
}

async function insertTicket(overrides: Partial<typeof supportTickets.$inferInsert> = {}) {
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      submitterEmail: SUBMITTER_EMAIL,
      submitterName: "Test Submitter",
      subject: "Test subject",
      body: "Test body text",
      status: "open",
      priority: "normal",
      tier: "starter",
      ...overrides,
    })
    .returning();
  return ticket;
}

async function cleanup() {
  const userRows = (await db.execute(
    sql`SELECT id FROM users WHERE email LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const userIds = userRows.rows?.map((r) => r.id) ?? [];

  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const orgIds = orgRows.rows?.map((r) => r.id) ?? [];

  // Use the per-run SUBMITTER_EMAIL so cleanup is strictly scoped to this suite.
  const ticketRows = (await db.execute(
    sql`SELECT id FROM support_tickets WHERE submitter_email = ${SUBMITTER_EMAIL}`,
  )) as unknown as { rows?: { id: string }[] };
  const ticketIds = ticketRows.rows?.map((r) => r.id) ?? [];

  if (ticketIds.length > 0) {
    await db
      .delete(supportTicketReplies)
      .where(inArray(supportTicketReplies.ticketId, ticketIds))
      .catch(() => {});
    await db
      .delete(supportTickets)
      .where(inArray(supportTickets.id, ticketIds))
      .catch(() => {});
  }

  // Delete users before orgs to avoid FK constraint violations.
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
  }

  if (orgIds.length > 0) {
    await db.delete(organizations).where(inArray(organizations.id, orgIds)).catch(() => {});
  }
}

beforeAll(async () => {
  await cleanup();

  const supportRoutes = (await import("../supportRoutes")).default;

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(supportRoutes);

  const [sa, admin] = await Promise.all([seedSuperAdmin(), seedOrgAdmin()]);
  superAdminToken = sa.token;
  adminToken = admin.token;
}, 60_000);

afterAll(async () => {
  await cleanup();
}, 30_000);

function authCookie(token: string) {
  return `auth_token=${token}`;
}

// ============================================================================

describe("POST /api/support/tickets/:id/replies", () => {
  it("stamps firstResponseAt exactly once across multiple replies", async () => {
    const ticket = await insertTicket();

    const res1 = await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "First reply from support" })
      .expect(201);

    expect(res1.body.ticket.firstResponseAt).toBeTruthy();
    const firstResponseAt = res1.body.ticket.firstResponseAt;

    const res2 = await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Second reply from support" })
      .expect(201);

    // secondReply must not overwrite firstResponseAt
    expect(res2.body.ticket.firstResponseAt).toBe(firstResponseAt);
  });

  it("transitions ticket status from open to in_progress", async () => {
    const ticket = await insertTicket({ status: "open" });

    const res = await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Moving you to in-progress" })
      .expect(201);

    expect(res.body.ticket.status).toBe("in_progress");
  });

  it("does not change status when ticket is already in_progress", async () => {
    const ticket = await insertTicket({ status: "in_progress" });

    const res = await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Follow-up reply" })
      .expect(201);

    expect(res.body.ticket.status).toBe("in_progress");
  });

  it("sends an email to the ticket submitter on success", async () => {
    const sendEmail = await getSendEmailMock();
    sendEmail.mockClear();

    const ticket = await insertTicket({
      submitterEmail: SUBMITTER_EMAIL,
      subject: "Email test subject",
    });

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Hello, here is your reply" })
      .expect(201);

    // Poll until the best-effort async email fires (avoids fragile fixed delay).
    const deadline = Date.now() + 2_000;
    while (sendEmail.mock.calls.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(sendEmail).toHaveBeenCalledOnce();
    const [emailOpts] = sendEmail.mock.calls[0] as [{ to: string; subject: string }];
    expect(emailOpts.to).toBe(SUBMITTER_EMAIL);
    expect(emailOpts.subject).toContain(ticket.subject);
  });

  it("still returns 201 and persists the reply even when email sending fails", async () => {
    const sendEmail = await getSendEmailMock();
    sendEmail.mockClear();
    sendEmail.mockRejectedValueOnce(new Error("SMTP unavailable"));

    const ticket = await insertTicket();

    const res = await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Reply despite email failure" })
      .expect(201);

    // Endpoint succeeds
    expect(res.body.reply.body).toBe("Reply despite email failure");
    expect(res.body.ticket.status).toBe("in_progress");

    // Reply was persisted to the database
    const dbReply = await db
      .select()
      .from(supportTicketReplies)
      .where(sql`${supportTicketReplies.id} = ${res.body.reply.id}`);
    expect(dbReply).toHaveLength(1);
    expect(dbReply[0].body).toBe("Reply despite email failure");

    // Restore default mock behaviour for subsequent tests
    sendEmail.mockResolvedValue(undefined);
  });

  it("returns 403 for a non-SUPER_ADMIN caller", async () => {
    const ticket = await insertTicket();

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(adminToken))
      .send({ body: "Unauthorized reply attempt" })
      .expect(403);
  });

  it("returns 401 for an unauthenticated request", async () => {
    const ticket = await insertTicket();

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .send({ body: "No cookie" })
      .expect(401);
  });

  it("returns 404 for a non-existent ticket", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";

    await request(app)
      .post(`/api/support/tickets/${fakeId}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Reply to ghost ticket" })
      .expect(404);
  });

  it("returns 400 when body is missing", async () => {
    const ticket = await insertTicket();

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({})
      .expect(400);
  });
});

// ============================================================================

describe("GET /api/support/tickets/:id/replies", () => {
  it("returns replies in ascending createdAt order", async () => {
    const ticket = await insertTicket();

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Reply A" })
      .expect(201);

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Reply B" })
      .expect(201);

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Reply C" })
      .expect(201);

    const res = await request(app)
      .get(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .expect(200);

    const replies: Array<{ body: string; createdAt: string }> = res.body.replies;
    expect(replies.length).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < replies.length - 1; i++) {
      expect(new Date(replies[i].createdAt).getTime()).toBeLessThanOrEqual(
        new Date(replies[i + 1].createdAt).getTime(),
      );
    }

    const bodies = replies.map((r) => r.body);
    const idxA = bodies.indexOf("Reply A");
    const idxB = bodies.indexOf("Reply B");
    const idxC = bodies.indexOf("Reply C");
    expect(idxA).not.toBe(-1);
    expect(idxB).not.toBe(-1);
    expect(idxC).not.toBe(-1);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxC);
  });

  it("returns 403 for a non-SUPER_ADMIN caller", async () => {
    const ticket = await insertTicket();

    await request(app)
      .get(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(adminToken))
      .expect(403);
  });
});
