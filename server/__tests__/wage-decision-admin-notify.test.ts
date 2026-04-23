// Task #1344 — org-admin fan-out for Davis-Bacon wage decision problems:
//   - notifyOrgAdminsOfWageDecisionSyncFailure delivers an in-app
//     notification + email to every active org admin.
//   - processMissingWageDecisionReminders only fires for projects that
//     have been around > 24h with an uncached wage decision, throttles
//     repeat reminders to 1/project/week, and produces emails that deep
//     link to /integrations and /payroll.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq } from "drizzle-orm";

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

vi.mock("../utils/safeFetch", () => ({
  safeFetch: vi.fn(async () => ({
    ok: false,
    status: 503,
    text: async () => "upstream down",
    json: async () => ({}),
  })),
}));
import { clearTestEmailOutbox, getTestEmailOutbox } from "../services/emailTransport";
import {
  notifyOrgAdminsOfWageDecisionSyncFailure,
  processMissingWageDecisionReminders,
} from "../services/davisBaconAdminNotifications";

const PREFIX = "__wd_admin__";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

let orgId: string;
let priorEmailTransport: string | undefined;

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
  priorEmailTransport = process.env.EMAIL_TRANSPORT;
  process.env.EMAIL_TRANSPORT = "noop";
  await cleanup();
  const [org] = await db.insert(organizations).values({
    name: `${PREFIX}org`,
    slug: `${PREFIX}org-${Date.now()}`,
  }).returning();
  orgId = org.id;
});

afterAll(async () => {
  await cleanup();
  if (priorEmailTransport === undefined) {
    delete process.env.EMAIL_TRANSPORT;
  } else {
    process.env.EMAIL_TRANSPORT = priorEmailTransport;
  }
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
  clearTestEmailOutbox();
});

async function makeUser(role: "ADMIN" | "MANAGER", suffix: string, isActive = true) {
  const [u] = await db.insert(users).values({
    organizationId: orgId,
    firstName: "Test",
    lastName: suffix,
    email: `${PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    role,
    isActive,
    passwordHash: "x",
  }).returning();
  await db.insert(notificationChannelPrefs).values({
    userId: u.id,
    emailEnabled: true,
  });
  return u;
}

async function makeProject(suffix: string, opts: { wageDecision?: string; createdAt?: Date } = {}) {
  const [p] = await db.insert(projects).values({
    name: `${PREFIX}proj-${suffix}`,
    code: `${PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    clientName: "Acme",
    gcOrganizationId: orgId,
    wageDecision: opts.wageDecision ?? "CA20260001",
    ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  }).returning();
  if (opts.createdAt) {
    await db.update(projects).set({ createdAt: opts.createdAt }).where(eq(projects.id, p.id));
  }
  return p;
}

/**
 * Stand in for `queueWageDecisionSync` writing an
 * integration_sync_state row when the project's wage decision is first
 * queued. The sweep uses this row's `created_at` as the "first noticed
 * missing at" timestamp for the >24h gate.
 */
async function makeSyncState(decision: string, opts: { firstAttemptAt?: Date } = {}) {
  // Need a connection row first because integration_sync_state
  // FK-references it.
  const [conn] = await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: "dol_davis_bacon",
    status: "active",
    displayName: `DOL ${decision}`,
    metadata: { apiKey: "test-key" },
  }).returning();
  const [row] = await db.insert(integrationSyncState).values({
    organizationId: orgId,
    connectionId: conn.id,
    entityType: `wage_determination:${decision}`,
    lastError: "upstream down",
    retryCount: 1,
    ...(opts.firstAttemptAt ? { createdAt: opts.firstAttemptAt } : {}),
  }).returning();
  if (opts.firstAttemptAt) {
    await db
      .update(integrationSyncState)
      .set({ createdAt: opts.firstAttemptAt })
      .where(eq(integrationSyncState.id, row.id));
  }
  return row;
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  let last: T | null | undefined;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timed out");
}

describe("notifyOrgAdminsOfWageDecisionSyncFailure (Task #1344)", () => {
  it("fans an in-app notification + email out to every active org admin", async () => {
    const adminA = await makeUser("ADMIN", "a");
    const adminB = await makeUser("ADMIN", "b");
    await makeUser("MANAGER", "mgr"); // should not receive
    await makeUser("ADMIN", "inactive", false); // inactive — should not receive

    const out = await notifyOrgAdminsOfWageDecisionSyncFailure({
      organizationId: orgId,
      decisionNumber: "CA20269999",
      errorMessage: "SAM.gov API error 503: upstream down",
      source: "manual_sync",
    });
    expect(out.recipients).toBe(2);

    await waitFor(async () => {
      const got = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
      return got.length >= 2 ? got : null;
    });

    const got = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    const userIds = got.map((n) => n.userId).sort();
    expect(userIds).toEqual([adminA.id, adminB.id].sort());
    for (const n of got) {
      expect(n.type).toBe("DAVIS_BACON_AUTO_SYNC_FAILED");
      expect(n.message).toContain("CA20269999");
      expect(n.message).toContain("Manual sync attempt");
    }

    await waitFor(async () => (getTestEmailOutbox().length >= 2 ? true : null));
    const sentTo = getTestEmailOutbox().flatMap((m) => m.to ?? []).sort();
    expect(sentTo).toEqual([adminA.email, adminB.email].sort());
  });

  it("background sync failures fan out to other admins (excluding the connection owner)", async () => {
    const owner = await makeUser("ADMIN", "bgowner");
    const otherAdmin = await makeUser("ADMIN", "bgother");
    await db.insert(integrationConnections).values({
      organizationId: orgId,
      provider: "dol_davis_bacon",
      status: "active",
      displayName: "DOL",
      metadata: { apiKey: "test-key" },
      createdByUserId: owner.id,
    });

    const { queueWageDecisionSync } = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const out = await queueWageDecisionSync(orgId, "CA20269998", { awaitResult: false });
    expect(out.status).toBe("queued");

    await waitFor(async () => {
      const got = await db
        .select()
        .from(notifications)
        .where(
          sql`${notifications.organizationId} = ${orgId}
              AND ${notifications.userId} = ${otherAdmin.id}
              AND ${notifications.type} = 'DAVIS_BACON_AUTO_SYNC_FAILED'`,
        );
      return got.length >= 1 ? got : null;
    }, 4000);

    const ownerNotes = await db
      .select()
      .from(notifications)
      .where(
        sql`${notifications.organizationId} = ${orgId}
            AND ${notifications.userId} = ${owner.id}
            AND ${notifications.message} LIKE '%Automatic background sync%'`,
      );
    // Owner is excluded from the admin fanout (they get the existing
    // tailored notification via notifyDavisBaconAutoSyncFailure instead).
    expect(ownerNotes).toHaveLength(0);
  });

  it("supports excludeUserId so the connection owner doesn't get a duplicate", async () => {
    const owner = await makeUser("ADMIN", "owner2");
    const other = await makeUser("ADMIN", "other2");

    const out = await notifyOrgAdminsOfWageDecisionSyncFailure({
      organizationId: orgId,
      decisionNumber: "CA20260002",
      errorMessage: "boom",
      source: "background_sync",
      excludeUserId: owner.id,
    });
    expect(out.recipients).toBe(1);

    await waitFor(async () => {
      const got = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
      return got.length >= 1 ? got : null;
    });
    const got = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(got.map((n) => n.userId)).toEqual([other.id]);
  });
});

describe("processMissingWageDecisionReminders (Task #1344)", () => {
  it("does not fire when the wage decision was just (re)queued — the sync_state row is treated as 'first noticed missing at'", async () => {
    await makeUser("ADMIN", "young");
    // Old project with old updatedAt — but the wage decision was just
    // queued (sync_state.createdAt = now), simulating the user changing
    // the project's wage decision a moment ago. The sync_state row
    // takes precedence over projects.updatedAt and resets the 24h
    // clock, so no premature reminder fires.
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const project = await makeProject("young", { wageDecision: "CA20260111", createdAt: oldDate });
    await db.execute(sql`UPDATE projects SET updated_at = ${oldDate} WHERE id = ${project.id}`);
    await makeSyncState("CA20260111", { firstAttemptAt: new Date() });

    const out = await processMissingWageDecisionReminders();
    expect(out.candidateProjects).toBe(0);
    expect(out.remindersSent).toBe(0);
  });

  it("still fires for projects that were never queued for sync (e.g. no Davis-Bacon connection) when projects.updatedAt is >24h old", async () => {
    // Mirrors the candidate set surfaced by GET /api/payroll/missing-wage-decisions:
    // a project whose wage decision the cache doesn't know about should
    // still produce a reminder even if the queue never wrote a
    // sync_state row, as long as the missing-state has been around
    // longer than 24h. We use projects.updatedAt as the fallback
    // "first noticed missing at".
    const admin = await makeUser("ADMIN", "neverqueued");
    const oldDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const project = await makeProject("neverqueued", { wageDecision: "CA20260555", createdAt: oldDate });
    // Force updatedAt back too — defaultNow() on insert sets it to now.
    await db.execute(sql`UPDATE projects SET updated_at = ${oldDate} WHERE id = ${project.id}`);

    const out = await processMissingWageDecisionReminders();
    expect(out.candidateProjects).toBe(1);
    expect(out.remindersSent).toBe(1);

    await waitFor(async () => {
      const got = await db.select().from(notifications).where(eq(notifications.userId, admin.id));
      return got.length >= 1 ? got : null;
    });
  });

  it("fires for projects with an uncached wage decision missing for >24h, deep links to /integrations and /payroll, and respects the 1-per-project-per-week throttle", async () => {
    const admin = await makeUser("ADMIN", "deep");
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
    const project = await makeProject("missing", {
      wageDecision: "CA20260333",
      // Project itself is brand new — but the sync_state row is old, so
      // the missing condition has been unresolved for >24h.
      createdAt: new Date(),
    });
    await makeSyncState("CA20260333", { firstAttemptAt: yesterday });

    const out1 = await processMissingWageDecisionReminders();
    expect(out1.candidateProjects).toBe(1);
    expect(out1.remindersSent).toBe(1);
    expect(out1.recipientsNotified).toBe(1);

    await waitFor(async () => {
      const got = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
      return got.length >= 1 ? got : null;
    });
    const [note] = await db.select().from(notifications).where(eq(notifications.organizationId, orgId));
    expect(note.type).toBe("WAGE_DECISION_MISSING_REMINDER");
    expect(note.userId).toBe(admin.id);
    expect(note.relatedEntityId).toBe(project.id);

    await waitFor(async () => (getTestEmailOutbox().length >= 1 ? true : null));
    const email = getTestEmailOutbox()[0];
    expect(email.to).toEqual([admin.email]);
    expect((email.html ?? "")).toContain("/integrations");
    expect((email.html ?? "")).toContain("/payroll");
    expect((email.html ?? "")).toContain("CA20260333");

    // Second run within the throttle window: no new reminder fires.
    clearTestEmailOutbox();
    const out2 = await processMissingWageDecisionReminders();
    expect(out2.remindersSent).toBe(0);
    expect(out2.throttledProjects).toBe(1);

    // Manually rewind the existing reminder by 8 days so the throttle expires.
    await db.execute(sql`
      UPDATE notifications
      SET created_at = NOW() - INTERVAL '8 days'
      WHERE id = ${note.id}
    `);

    const out3 = await processMissingWageDecisionReminders();
    expect(out3.remindersSent).toBe(1);
    expect(out3.recipientsNotified).toBe(1);
  });

  it("skips orgs with no active admins", async () => {
    await makeUser("MANAGER", "lonely");
    await makeProject("lonely", {
      wageDecision: "CA20260444",
      createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
    });
    await makeSyncState("CA20260444", {
      firstAttemptAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
    });

    const out = await processMissingWageDecisionReminders();
    expect(out.remindersSent).toBe(0);
    expect(out.recipientsNotified).toBe(0);
  });
});
