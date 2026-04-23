// Task #1400 — Notify project managers when the daily Davis-Bacon
// stale-refresh sweep replaces a cached wage determination with one
// whose classification rates differ from the prior payload.
//
// Verifies that:
//  - When the refreshed payload matches the cached rates (no-op
//    refresh), no WAGE_DECISION_RATES_CHANGED notification is sent.
//  - When the refreshed payload changes a classification's rate, a
//    WAGE_DECISION_RATES_CHANGED notification is fanned out per
//    affected project to its project manager and the org admins.
//  - The pure diffWageRates helper returns null on equivalent payloads
//    and a structured diff otherwise (covers added/removed/changed).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  notifications,
  notificationChannelPrefs,
  projects,
  users,
} from "@shared/schema";

vi.mock("../services/notificationDelivery", () => ({
  deliverNotification: vi.fn(async () => undefined),
  deliverNotifications: vi.fn(async () => undefined),
  composeEmailContent: vi.fn(),
}));

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let nextRates: { classification: string; baseRate: number; fringeRate: number }[] = [];

vi.mock("../utils/safeFetch", () => ({
  safeFetch: vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => ({
      wageDetermination: {
        state: "CA",
        county: "Alameda",
        constructionType: "Heavy",
        effectiveDate: "2026-01-01",
        rates: nextRates,
      },
    }),
  })),
}));

const PREFIX = "__dbrate__";

let orgId: string;
let connectionId: string;
let pmId: string;
let adminId: string;

async function cleanup() {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  for (const id of ids) {
    await db.delete(notifications).where(eq(notifications.organizationId, id));
    await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, id));
    await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, id));
    await db.delete(notificationChannelPrefs).where(
      sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${id})`,
    );
    await db.delete(projects).where(eq(projects.gcOrganizationId, id));
    await db.delete(users).where(eq(users.organizationId, id));
    await db.delete(organizations).where(eq(organizations.id, id));
  }
}

beforeAll(async () => {
  await cleanup();
  const [org] = await db.insert(organizations).values({
    name: `${PREFIX}org`,
    slug: `${PREFIX}org-${Date.now()}`,
  }).returning();
  orgId = org.id;
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.delete(notifications).where(eq(notifications.organizationId, orgId));
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, orgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
  );
  await db.delete(projects).where(eq(projects.gcOrganizationId, orgId));
  await db.delete(users).where(eq(users.organizationId, orgId));

  const [pm] = await db.insert(users).values({
    organizationId: orgId,
    firstName: "Pat",
    lastName: "Manager",
    email: `${PREFIX}pm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    role: "MANAGER",
    isActive: true,
    passwordHash: "x",
  }).returning();
  pmId = pm.id;
  const [admin] = await db.insert(users).values({
    organizationId: orgId,
    firstName: "Adam",
    lastName: "Admin",
    email: `${PREFIX}admin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    role: "ADMIN",
    isActive: true,
    passwordHash: "x",
  }).returning();
  adminId = admin.id;

  const [conn] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: "dol_davis_bacon",
    status: "active",
    displayName: "DOL",
    metadata: { apiKey: "test-key" },
  }).returning();
  connectionId = conn.id;
});

async function seedStaleRow(decisionNumber: string, rates: { classification: string; baseRate: number; fringeRate: number; totalRate: number }[]) {
  await db.insert(integrationSyncState).values({
    organizationId: orgId,
    connectionId,
    entityType: `wage_determination:${decisionNumber}`,
    metadata: { decisionNumber, rates } as any,
    lastSyncAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    lastAttemptAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    lastError: null,
    retryCount: 0,
    nextRetryAt: null,
  });
}

async function makeProject(decisionNumber: string, withPm: boolean) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [p] = await db.insert(projects).values({
    name: `${PREFIX}proj-${suffix}`,
    code: `${PREFIX}p-${suffix}`,
    clientName: "Acme",
    gcOrganizationId: orgId,
    wageDecision: decisionNumber,
    projectManagerId: withPm ? pmId : null,
  }).returning();
  return p;
}

async function rateChangeNotificationsFor(orgIdValue: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, orgIdValue),
        eq(notifications.type, "WAGE_DECISION_RATES_CHANGED"),
      ),
    );
}

describe("processStaleWageDecisions rate-change notifications (Task #1400)", () => {
  it("does NOT notify when the refreshed payload matches the cached rates", async () => {
    const decision = "CA20260300";
    await makeProject(decision, true);
    await seedStaleRow(decision, [
      { classification: "Carpenter", baseRate: 60, fringeRate: 14, totalRate: 74 },
    ]);
    // Same rates returned by SAM.gov on refresh.
    nextRates = [{ classification: "Carpenter", baseRate: 60, fringeRate: 14 }];

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });
    expect(out.succeeded).toBe(1);

    const noteRows = await rateChangeNotificationsFor(orgId);
    expect(noteRows).toHaveLength(0);
  });

  it("notifies the project manager and org admins when rates differ", async () => {
    const decision = "CA20260301";
    const proj = await makeProject(decision, true);
    await seedStaleRow(decision, [
      { classification: "Carpenter", baseRate: 50, fringeRate: 10, totalRate: 60 },
      { classification: "Laborer", baseRate: 40, fringeRate: 8, totalRate: 48 },
    ]);
    // Carpenter base rate jumped, Laborer untouched, Electrician added.
    nextRates = [
      { classification: "Carpenter", baseRate: 60, fringeRate: 10 },
      { classification: "Laborer", baseRate: 40, fringeRate: 8 },
      { classification: "Electrician", baseRate: 70, fringeRate: 12 },
    ];

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    const out = await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });
    expect(out.succeeded).toBe(1);

    const noteRows = await rateChangeNotificationsFor(orgId);
    // One project, two recipients (PM + admin) → 2 notifications.
    expect(noteRows).toHaveLength(2);
    const recipients = new Set(noteRows.map((n) => n.userId));
    expect(recipients.has(pmId)).toBe(true);
    expect(recipients.has(adminId)).toBe(true);
    for (const n of noteRows) {
      expect(n.title).toContain(decision);
      expect(n.relatedEntityId).toBe(proj.id);
      expect(n.relatedEntityType).toBe("PROJECT");
      // Summary mentions the changed classification.
      expect(String(n.message)).toMatch(/Carpenter/);
    }
  });

  it("does not deliver duplicate notifications when the PM is also an admin", async () => {
    const decision = "CA20260302";
    // Promote the PM seed to ADMIN so it appears in both audiences.
    await db.update(users).set({ role: "ADMIN" }).where(eq(users.id, pmId));
    const proj = await makeProject(decision, true);
    await seedStaleRow(decision, [
      { classification: "Carpenter", baseRate: 50, fringeRate: 10, totalRate: 60 },
    ]);
    nextRates = [{ classification: "Carpenter", baseRate: 75, fringeRate: 10 }];

    const { processStaleWageDecisions } = await import("../integrations/providers/dol_davis_bacon/sync");
    await processStaleWageDecisions(new Date(), { staleAfterDays: 30 });

    const noteRows = await rateChangeNotificationsFor(orgId);
    // PM (now also ADMIN) + the other admin = 2 unique recipients → 2 notifications.
    expect(noteRows).toHaveLength(2);
    const recipients = new Set(noteRows.map((n) => n.userId));
    expect(recipients.size).toBe(2);
    for (const n of noteRows) {
      expect(n.relatedEntityId).toBe(proj.id);
    }
  });
});

describe("notifyProjectManagersOfWageRateChange digest (Task #1407)", () => {
  it("collapses multiple projects per user into a single digest notification", async () => {
    const decision = "CA20260307";
    // Three projects all under the same wage decision, all with the
    // same PM, in an org where one admin user is present.
    const projA = await makeProject(decision, true);
    const projB = await makeProject(decision, true);
    const projC = await makeProject(decision, true);

    const { notifyProjectManagersOfWageRateChange } = await import(
      "../services/davisBaconAdminNotifications"
    );
    await notifyProjectManagersOfWageRateChange({
      organizationId: orgId,
      decisionNumber: decision,
      diff: {
        changes: [
          {
            classification: "Carpenter",
            kind: "changed",
            oldBaseRate: 50,
            newBaseRate: 60,
            oldFringeRate: 10,
            newFringeRate: 10,
            oldTotalRate: 60,
            newTotalRate: 70,
          },
        ],
      },
    });

    const noteRows = await rateChangeNotificationsFor(orgId);
    // 3 projects × 2 recipients (PM + admin) would have been 6
    // notifications under the old fan-out. Digest collapses to one
    // notification per recipient = 2.
    expect(noteRows).toHaveLength(2);
    const recipients = new Set(noteRows.map((n) => n.userId));
    expect(recipients.has(pmId)).toBe(true);
    expect(recipients.has(adminId)).toBe(true);
    for (const n of noteRows) {
      // Multi-project digest: title mentions the project count, and
      // relatedEntityId is null so the email falls back to /payroll.
      expect(n.title).toContain(decision);
      expect(n.title).toContain("3 projects");
      expect(n.relatedEntityId).toBeNull();
      const msg = String(n.message);
      // Each affected project is listed in the digest body.
      for (const p of [projA, projB, projC]) {
        expect(msg).toContain(p.name || p.code || "");
      }
    }
  });

  it("preserves single-project notification format unchanged", async () => {
    const decision = "CA20260308";
    const proj = await makeProject(decision, true);

    const { notifyProjectManagersOfWageRateChange } = await import(
      "../services/davisBaconAdminNotifications"
    );
    await notifyProjectManagersOfWageRateChange({
      organizationId: orgId,
      decisionNumber: decision,
      diff: {
        changes: [
          {
            classification: "Carpenter",
            kind: "changed",
            oldBaseRate: 50,
            newBaseRate: 60,
            oldFringeRate: 10,
            newFringeRate: 10,
            oldTotalRate: 60,
            newTotalRate: 70,
          },
        ],
      },
    });

    const noteRows = await rateChangeNotificationsFor(orgId);
    expect(noteRows).toHaveLength(2);
    for (const n of noteRows) {
      // Single-project format: no "N projects" in title, links to project.
      expect(n.title).toBe(`Davis-Bacon rates changed for ${decision}`);
      expect(n.relatedEntityId).toBe(proj.id);
      expect(n.relatedEntityType).toBe("PROJECT");
    }
  });
});

describe("diffWageRates helper (Task #1400)", () => {
  it("returns null when both payloads are equivalent", async () => {
    const { diffWageRates } = await import("../services/davisBaconAdminNotifications");
    const out = diffWageRates(
      [{ classification: "Carpenter", baseRate: 50, fringeRate: 10, totalRate: 60 }],
      [{ classification: "carpenter ", baseRate: 50.001, fringeRate: 10, totalRate: 60.001 }],
    );
    expect(out).toBeNull();
  });

  it("detects added, removed, and changed classifications", async () => {
    const { diffWageRates } = await import("../services/davisBaconAdminNotifications");
    const out = diffWageRates(
      [
        { classification: "Carpenter", baseRate: 50, fringeRate: 10, totalRate: 60 },
        { classification: "Mason", baseRate: 45, fringeRate: 9, totalRate: 54 },
      ],
      [
        { classification: "Carpenter", baseRate: 60, fringeRate: 10, totalRate: 70 },
        { classification: "Electrician", baseRate: 70, fringeRate: 12, totalRate: 82 },
      ],
    );
    expect(out).not.toBeNull();
    const kinds = out!.changes.reduce<Record<string, number>>((acc, c) => {
      acc[c.kind] = (acc[c.kind] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds.changed).toBe(1);
    expect(kinds.added).toBe(1);
    expect(kinds.removed).toBe(1);
  });
});
