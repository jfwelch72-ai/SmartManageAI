/**
 * Task #907 — Integration tests for the unified CRM activity timeline
 * (`GET /api/crm/activity`).
 *
 * The endpoint merges five different sources (calls, emails, opportunity
 * activities, quotes, and stage changes derived from audit_log) into a
 * single time-sorted feed and de-duplicates the CALL/EMAIL mirror rows
 * that crmOpportunityActivities still carries for legacy listings. This
 * suite exercises that merge + dedup logic against the real database
 * (the same harness used by other server-integration tests) so a schema
 * change or a regression in the route can be caught early.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "http";
import type { Express } from "express";
import request from "supertest";
import { db } from "../db";
import {
  crmOrganisations,
  crmContacts,
  crmOpportunities,
  crmOpportunityActivities,
  crmCalls,
  crmEmailThreads,
  crmEmailMessages,
  crmQuotes,
  organizations,
  users,
} from "@shared/schema";
import { auditLog } from "@shared/schema";
import { eq } from "drizzle-orm";
import { generateToken } from "../auth";

let app: Express;
let server: Server;
let adminCookie: string;
let fieldWorkerCookie: string;
let userId: string;
let orgId: string;
let crmOrgId: string;
let contactId: string;
let opportunityId: string;
let otherOpportunityId: string;
let fieldWorkerUserId: string;

const suffix = Date.now();

beforeAll(async () => {
  const express = await import("express");
  const cookieParser = await import("cookie-parser");
  const { registerRoutes } = await import("../routes");

  app = express.default();
  app.use(express.default.json());
  app.use(cookieParser.default());
  server = await registerRoutes(app);

  // Build a fresh org + admin/field-worker user pair and mint JWTs directly.
  // (We bypass /api/dev/test-login because requireDevSeed is gated to
  // NODE_ENV=development and vitest runs with NODE_ENV=test.)
  const [org] = await db
    .insert(organizations)
    .values({
      name: `Timeline Test Org ${suffix}`,
      slug: `timeline-test-org-${suffix}`,
    })
    .returning();
  orgId = org.id;

  const [adminUser] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Timeline",
      lastName: "Admin",
      email: `timeline-admin-${suffix}@test.local`,
      role: "ADMIN",
    })
    .returning();
  userId = adminUser.id;

  const [fwUser] = await db
    .insert(users)
    .values({
      organizationId: orgId,
      firstName: "Timeline",
      lastName: "Field",
      email: `timeline-field-${suffix}@test.local`,
      role: "FIELD_WORKER",
    })
    .returning();
  fieldWorkerUserId = fwUser.id;

  adminCookie = `auth_token=${generateToken(adminUser.id, adminUser.tokenVersion)}`;
  fieldWorkerCookie = `auth_token=${generateToken(fwUser.id, fwUser.tokenVersion)}`;

  // Seed CRM org / contact / opportunity ----------------------------------
  const [cOrg] = await db
    .insert(crmOrganisations)
    .values({
      organizationId: orgId,
      name: `Timeline Test Co ${suffix}`,
      type: "CONTRACTOR",
      createdById: userId,
    })
    .returning();
  crmOrgId = cOrg.id;

  const [contact] = await db
    .insert(crmContacts)
    .values({
      organizationId: orgId,
      organisationId: crmOrgId,
      firstName: "Timeline",
      lastName: `Tester ${suffix}`,
      email: `timeline+${suffix}@test.local`,
      role: "PM",
      createdById: userId,
    })
    .returning();
  contactId = contact.id;

  const [opp] = await db
    .insert(crmOpportunities)
    .values({
      organizationId: orgId,
      name: `Timeline Deal ${suffix}`,
      stage: "QUALIFIED",
      crmOrganisationId: crmOrgId,
      contactId: contactId,
      createdById: userId,
    })
    .returning();
  opportunityId = opp.id;

  const [opp2] = await db
    .insert(crmOpportunities)
    .values({
      organizationId: orgId,
      name: `Timeline Deal Other ${suffix}`,
      stage: "LEAD",
      crmOrganisationId: crmOrgId,
      createdById: userId,
    })
    .returning();
  otherOpportunityId = opp2.id;

  const now = new Date();
  const at = (msAgo: number) => new Date(now.getTime() - msAgo);

  // ---- Calls (one on opp, one on contact-only, one on the other opp) ----
  await db.insert(crmCalls).values([
    {
      organizationId: orgId,
      opportunityId,
      contactId,
      crmOrganisationId: crmOrgId,
      direction: "OUTBOUND",
      outcome: "CONNECTED",
      durationSeconds: 300,
      startedAt: at(60_000),
      notes: `call-on-opp-${suffix}`,
      createdById: userId,
    },
    {
      organizationId: orgId,
      contactId,
      direction: "INBOUND",
      outcome: "VOICEMAIL",
      durationSeconds: 30,
      startedAt: at(120_000),
      notes: `call-contact-only-${suffix}`,
      createdById: userId,
    },
    {
      organizationId: orgId,
      opportunityId: otherOpportunityId,
      direction: "OUTBOUND",
      durationSeconds: 0,
      startedAt: at(30_000),
      notes: `call-other-opp-${suffix}`,
      createdById: userId,
    },
  ]);

  // ---- Mirror CALL row in crm_opportunity_activities (must be deduped) ----
  await db.insert(crmOpportunityActivities).values({
    opportunityId,
    activityType: "CALL",
    description: `MIRROR-CALL-${suffix}`,
    completedAt: at(60_000),
    createdById: userId,
  });

  // ---- Real activity rows (NOTE + MEETING + SITE_VISIT) ----
  await db.insert(crmOpportunityActivities).values([
    {
      opportunityId,
      activityType: "NOTE",
      description: `note-${suffix}`,
      createdById: userId,
    },
    {
      opportunityId,
      activityType: "MEETING",
      description: `meeting-${suffix}`,
      scheduledAt: at(45_000),
      createdById: userId,
    },
    {
      opportunityId,
      activityType: "SITE_VISIT",
      description: `site-visit-${suffix}`,
      scheduledAt: at(90_000),
      createdById: userId,
    },
  ]);

  // ---- Email thread + messages (one on opp, one on contact-only). ----
  // crm_opportunity_activities also gets a mirrored EMAIL row that must be
  // deduped from the timeline.
  const [thread] = await db
    .insert(crmEmailThreads)
    .values({
      organizationId: orgId,
      contactId,
      opportunityId,
      organisationId: crmOrgId,
      subject: `Thread ${suffix}`,
      provider: "GMAIL",
      messageCount: 2,
      lastMessageAt: at(40_000),
    })
    .returning();

  await db.insert(crmEmailMessages).values([
    {
      organizationId: orgId,
      threadId: thread.id,
      contactId,
      opportunityId,
      externalMessageId: `ext-${suffix}-1`,
      direction: "INBOUND",
      fromAddress: "lead@external.com",
      toAddresses: "rep@example.com",
      subject: `Email-on-opp ${suffix}`,
      snippet: "snippet body",
      sentAt: at(50_000),
      provider: "GMAIL",
    },
    {
      organizationId: orgId,
      threadId: thread.id,
      contactId,
      // No opportunityId: should appear when scoped by contactId, not by opportunityId
      externalMessageId: `ext-${suffix}-2`,
      direction: "OUTBOUND",
      fromAddress: "rep@example.com",
      toAddresses: "lead@external.com",
      subject: `Email-contact-only ${suffix}`,
      snippet: "reply body",
      sentAt: at(55_000),
      provider: "GMAIL",
    },
  ]);

  await db.insert(crmOpportunityActivities).values({
    opportunityId,
    activityType: "EMAIL",
    description: `MIRROR-EMAIL-${suffix}`,
    completedAt: at(50_000),
    createdById: userId,
  });

  // ---- Quote ----
  await db.insert(crmQuotes).values({
    organizationId: orgId,
    opportunityId,
    crmOrganisationId: crmOrgId,
    contactId,
    quoteNumber: `Q-${suffix}`,
    title: `Quote ${suffix}`,
    status: "SENT",
    sentAt: at(20_000),
    totalAmount: "12500.00",
    createdById: userId,
  });

  // ---- Stage change in audit_log ----
  await db.insert(auditLog).values({
    userId,
    entityType: "crm_opportunities",
    entityId: opportunityId,
    action: "UPDATE",
    oldValue: JSON.stringify({ stage: "LEAD" }),
    newValue: JSON.stringify({ stage: "QUALIFIED" }),
    createdAt: at(10_000),
  });
}, 60_000);

afterAll(async () => {
  // Best-effort cleanup so successive runs stay deterministic.
  try {
    await db.delete(auditLog).where(eq(auditLog.entityId, opportunityId)).catch(() => {});
    await db.delete(crmCalls).where(eq(crmCalls.organizationId, orgId)).catch(() => {});
    await db.delete(crmEmailMessages).where(eq(crmEmailMessages.organizationId, orgId)).catch(() => {});
    await db.delete(crmEmailThreads).where(eq(crmEmailThreads.organizationId, orgId)).catch(() => {});
    await db.delete(crmQuotes).where(eq(crmQuotes.organizationId, orgId)).catch(() => {});
    await db
      .delete(crmOpportunityActivities)
      .where(eq(crmOpportunityActivities.opportunityId, opportunityId))
      .catch(() => {});
    await db
      .delete(crmOpportunityActivities)
      .where(eq(crmOpportunityActivities.opportunityId, otherOpportunityId))
      .catch(() => {});
    await db.delete(crmOpportunities).where(eq(crmOpportunities.id, opportunityId)).catch(() => {});
    await db.delete(crmOpportunities).where(eq(crmOpportunities.id, otherOpportunityId)).catch(() => {});
    await db.delete(crmContacts).where(eq(crmContacts.id, contactId)).catch(() => {});
    await db.delete(crmOrganisations).where(eq(crmOrganisations.id, crmOrgId)).catch(() => {});
    await db.delete(users).where(eq(users.id, userId)).catch(() => {});
    await db.delete(users).where(eq(users.id, fieldWorkerUserId)).catch(() => {});
    await db.delete(organizations).where(eq(organizations.id, orgId)).catch(() => {});
  } catch {
    /* non-fatal */
  }
  if (server?.listening) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30_000);

interface ActivityRow {
  id: string;
  type: string;
  occurredAt: string;
  title: string;
  description: string | null;
  actorName: string | null;
  meta: Record<string, unknown>;
}

async function fetchActivity(query: string, cookie = adminCookie) {
  return request(app).get(`/api/crm/activity?${query}`).set("Cookie", cookie);
}

describe("GET /api/crm/activity — unified timeline", () => {
  it("requires opportunityId, contactId, or crmOrganisationId", async () => {
    const res = await fetchActivity("");
    expect(res.status).toBe(400);
    expect(String(res.body.error || "")).toMatch(/opportunityId|contactId|crmOrganisationId/);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get(`/api/crm/activity?opportunityId=${opportunityId}`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for users outside the pipeline roles (FIELD_WORKER)", async () => {
    const res = await fetchActivity(`opportunityId=${opportunityId}`, fieldWorkerCookie);
    expect(res.status).toBe(403);
  });

  it("merges every supported source for an opportunity scope", async () => {
    const res = await fetchActivity(`opportunityId=${opportunityId}`);
    expect(res.status).toBe(200);
    const items = res.body as ActivityRow[];
    expect(Array.isArray(items)).toBe(true);

    const types = items.map((i) => i.type);
    expect(types).toContain("CALL"); // direct call rows
    expect(types).toContain("EMAIL"); // direct email rows
    expect(types).toContain("NOTE"); // mirrored from activities
    expect(types).toContain("MEETING");
    expect(types).toContain("SITE_VISIT");
    expect(types).toContain("QUOTE");
    expect(types).toContain("STATUS"); // stage change derived from audit_log

    // Sorted strictly newest → oldest.
    for (let i = 1; i < items.length; i++) {
      expect(items[i - 1].occurredAt >= items[i].occurredAt).toBe(true);
    }
  });

  it("dedupes mirrored CALL activity rows so calls are reported once", async () => {
    const res = await fetchActivity(`opportunityId=${opportunityId}`);
    expect(res.status).toBe(200);
    const items = res.body as ActivityRow[];

    const calls = items.filter((i) => i.type === "CALL");
    // Only the one direct crmCalls row tied to this opportunity should appear.
    expect(calls).toHaveLength(1);
    // The mirror row's description text must NEVER bleed into the timeline.
    expect(items.some((i) => (i.description || "").includes(`MIRROR-CALL-${suffix}`))).toBe(false);
    // The direct row's notes do show up.
    expect(items.some((i) => (i.description || "").includes(`call-on-opp-${suffix}`))).toBe(true);
  });

  it("dedupes mirrored EMAIL activity rows so emails come only from crm_email_messages", async () => {
    const res = await fetchActivity(`opportunityId=${opportunityId}`);
    expect(res.status).toBe(200);
    const items = res.body as ActivityRow[];

    const emails = items.filter((i) => i.type === "EMAIL");
    expect(emails).toHaveLength(1);
    expect(emails[0].id.startsWith("email:")).toBe(true);
    expect(items.some((i) => (i.description || "").includes(`MIRROR-EMAIL-${suffix}`))).toBe(false);
  });

  it("scopes by contactId — includes calls/emails for that contact across opportunities, excludes opp-only activities", async () => {
    const res = await fetchActivity(`contactId=${contactId}`);
    expect(res.status).toBe(200);
    const items = res.body as ActivityRow[];

    // Both calls tied to the contact (one with opportunity, one without) come back.
    const calls = items.filter((i) => i.type === "CALL");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => (i.description || "").includes(`call-contact-only-${suffix}`))).toBe(true);

    // Both emails tied to the contact come back.
    const emails = items.filter((i) => i.type === "EMAIL");
    expect(emails).toHaveLength(2);

    // Quote / stage / activities are opportunity-scoped only and should NOT appear here.
    expect(items.find((i) => i.type === "QUOTE")).toBeUndefined();
    expect(items.find((i) => i.type === "STATUS")).toBeUndefined();
    expect(items.find((i) => i.type === "NOTE")).toBeUndefined();
  });

  it("scopes by crmOrganisationId — returns only the calls tied to that CRM org", async () => {
    const res = await fetchActivity(`crmOrganisationId=${crmOrgId}`);
    expect(res.status).toBe(200);
    const items = res.body as ActivityRow[];

    // The route only filters calls (and quotes — but the quotes branch also
    // requires opportunityId to fire, so quotes are NOT expected here).
    const calls = items.filter((i) => i.type === "CALL");
    expect(calls).toHaveLength(1); // the one call we tagged with this CRM org
    expect((calls[0].description || "").includes(`call-on-opp-${suffix}`)).toBe(true);
  });

  it("respects the `since` filter — older items are dropped from the merged feed", async () => {
    // since=now should drop everything we seeded (all events were created with
    // a slightly-past startedAt / sentAt / createdAt).
    const since = new Date(Date.now() + 5_000).toISOString();
    const res = await fetchActivity(
      `opportunityId=${opportunityId}&since=${encodeURIComponent(since)}`,
    );
    expect(res.status).toBe(200);
    const items = res.body as ActivityRow[];
    expect(items.find((i) => (i.description || "").includes(`call-on-opp-${suffix}`))).toBeUndefined();
    expect(items.find((i) => i.type === "QUOTE")).toBeUndefined();
    expect(items.find((i) => i.type === "STATUS")).toBeUndefined();
  });
});
