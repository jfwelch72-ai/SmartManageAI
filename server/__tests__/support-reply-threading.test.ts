// Task #2975 — Email threading header tests for the admin reply route.
//
// These tests prove that In-Reply-To / References headers are correctly
// constructed and forwarded all the way through the email transport layer.
// They deliberately do NOT mock ../email so the real sendEmail path runs;
// instead EMAIL_TRANSPORT=noop is set before any module is imported, which
// routes outbound mail into the in-memory outbox exposed by emailTransport.ts.
//
// Three scenarios:
//   1. Ticket opened by email (emailMessageId on the ticket, no inbound replies):
//      In-Reply-To = ticket.emailMessageId, References = ticket.emailMessageId
//
//   2. Full conversation chain (ticket emailMessageId + inbound reply rows):
//      In-Reply-To = most recent inbound reply Message-ID
//      References  = all inbound Message-IDs in chronological order
//
//   3. In-app ticket (no emailMessageId anywhere):
//      Neither In-Reply-To nor References is present in the captured email

// Set the noop transport flag BEFORE any module that reads it is imported.
process.env.EMAIL_TRANSPORT = "noop";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import { inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { users, organizations, supportTickets, supportTicketReplies } from "@shared/schema";
import { generateToken, authMiddleware } from "../auth";
import {
  getTestEmailOutbox,
  clearTestEmailOutbox,
  type CapturedEmail,
} from "../services/emailTransport";

const PREFIX = `__threading_${Date.now()}_`;
const SUBMITTER_EMAIL = `${PREFIX}submitter@test.local`;

let app: Express;
let superAdminToken: string;

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

async function insertTicket(overrides: Partial<typeof supportTickets.$inferInsert> = {}) {
  const [ticket] = await db
    .insert(supportTickets)
    .values({
      submitterEmail: SUBMITTER_EMAIL,
      submitterName: "Test Submitter",
      subject: "Threading test subject",
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

  const userRows = (await db.execute(
    sql`SELECT id FROM users WHERE email LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const userIds = userRows.rows?.map((r) => r.id) ?? [];
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds)).catch(() => {});
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

  const sa = await seedSuperAdmin();
  superAdminToken = sa.token;
}, 60_000);

afterAll(async () => {
  await cleanup();
  delete process.env.EMAIL_TRANSPORT;
}, 30_000);

function authCookie(token: string) {
  return `auth_token=${token}`;
}

/**
 * Wait for the noop outbox to receive at least one email for the given
 * submitter address, then return it. Polls to accommodate the best-effort
 * async send fired after the HTTP response is returned.
 */
async function waitForCapturedEmail(
  to: string,
  timeoutMs = 2_000,
): Promise<CapturedEmail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const captured = getTestEmailOutbox().find((e) => e.to.includes(to));
    if (captured) return captured;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`No captured email to ${to} within ${timeoutMs}ms`);
}

// ============================================================================

describe("POST /api/support/tickets/:id/replies — email threading headers (noop transport)", () => {
  it("sets In-Reply-To and References to the ticket emailMessageId when the ticket was opened by email", async () => {
    clearTestEmailOutbox();

    const TICKET_MSG_ID = "<ticket-open-thread-001@mail.example.com>";
    const ticket = await insertTicket({ emailMessageId: TICKET_MSG_ID });

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Threading test reply — ticket only" })
      .expect(201);

    const captured = await waitForCapturedEmail(SUBMITTER_EMAIL);

    expect(captured.headers).toBeDefined();
    expect(captured.headers!["In-Reply-To"]).toBe(TICKET_MSG_ID);
    expect(captured.headers!["References"]).toBe(TICKET_MSG_ID);
  });

  it("sets In-Reply-To to the most recent inbound reply and References to the full chain", async () => {
    clearTestEmailOutbox();

    const TICKET_MSG_ID = "<ticket-open-thread-002@mail.example.com>";
    const REPLY1_MSG_ID = "<reply-inbound-thread-001@mail.example.com>";
    const REPLY2_MSG_ID = "<reply-inbound-thread-002@mail.example.com>";

    const ticket = await insertTicket({ emailMessageId: TICKET_MSG_ID });

    // Seed two inbound customer replies (from email; each carries a Message-ID).
    await db.insert(supportTicketReplies).values([
      {
        ticketId: ticket.id,
        authorName: "Test Submitter",
        body: "Customer follow-up 1",
        emailMessageId: REPLY1_MSG_ID,
      } as typeof supportTicketReplies.$inferInsert,
      {
        ticketId: ticket.id,
        authorName: "Test Submitter",
        body: "Customer follow-up 2",
        emailMessageId: REPLY2_MSG_ID,
      } as typeof supportTicketReplies.$inferInsert,
    ]);

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Threading test reply — full chain" })
      .expect(201);

    const captured = await waitForCapturedEmail(SUBMITTER_EMAIL);

    expect(captured.headers).toBeDefined();

    // In-Reply-To must be the most recent inbound Message-ID.
    expect(captured.headers!["In-Reply-To"]).toBe(REPLY2_MSG_ID);

    // References must list all inbound Message-IDs in chronological order.
    const refs = captured.headers!["References"].split(" ");
    expect(refs).toEqual([TICKET_MSG_ID, REPLY1_MSG_ID, REPLY2_MSG_ID]);
  });

  it("omits threading headers when the ticket was created via the in-app form (no emailMessageId)", async () => {
    clearTestEmailOutbox();

    // No emailMessageId → in-app ticket
    const ticket = await insertTicket({ emailMessageId: undefined });

    await request(app)
      .post(`/api/support/tickets/${ticket.id}/replies`)
      .set("Cookie", authCookie(superAdminToken))
      .send({ body: "Threading test reply — in-app ticket" })
      .expect(201);

    const captured = await waitForCapturedEmail(SUBMITTER_EMAIL);

    // headers must be absent or contain neither threading key
    if (captured.headers) {
      expect(captured.headers["In-Reply-To"]).toBeUndefined();
      expect(captured.headers["References"]).toBeUndefined();
    } else {
      expect(captured.headers).toBeUndefined();
    }
  });
});
