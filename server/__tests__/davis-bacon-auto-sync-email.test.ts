// Task #1353 — Davis-Bacon auto-sync failure emails go through the standard
// notification delivery pipeline (and respect emailEnabled prefs).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq, and } from "drizzle-orm";

import { db } from "../db";
import {
  organizations,
  integrationConnections,
  integrationSyncState,
  notifications,
  notificationChannelPrefs,
  users,
} from "@shared/schema";
import { clearTestEmailOutbox, getTestEmailOutbox } from "../services/emailTransport";

const PREFIX = "__dbasync_email__";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  logDebug: vi.fn(),
}));

vi.mock("../utils/safeFetch", () => ({
  safeFetch: vi.fn(async () => ({
    ok: false,
    status: 503,
    text: async () => "upstream down",
    json: async () => ({}),
  })),
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
  await db.delete(integrationSyncState).where(eq(integrationSyncState.organizationId, orgId));
  await db.delete(notifications).where(eq(notifications.organizationId, orgId));
  await db.delete(integrationConnections).where(eq(integrationConnections.organizationId, orgId));
  await db.delete(notificationChannelPrefs).where(
    sql`${notificationChannelPrefs.userId} IN (SELECT id FROM users WHERE organization_id = ${orgId})`,
  );
  await db.delete(users).where(eq(users.organizationId, orgId));
  clearTestEmailOutbox();
});

async function makeOwner(suffix: string) {
  const [u] = await db.insert(users).values({
    organizationId: orgId,
    firstName: "Davis",
    lastName: suffix,
    email: `${PREFIX}${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.invalid`,
    role: "ADMIN",
    passwordHash: "x",
  }).returning();
  return u;
}

async function makeConnection(ownerId: string) {
  await db.insert(integrationConnections).values({
    organizationId: orgId,
    provider: "dol_davis_bacon",
    status: "active",
    displayName: "DOL",
    metadata: { apiKey: "test-key" },
    createdByUserId: ownerId,
  });
}

async function waitForNotification(ownerId: string) {
  for (let i = 0; i < 100; i++) {
    const note = (await db.select().from(notifications).where(and(
      eq(notifications.organizationId, orgId),
      eq(notifications.userId, ownerId),
    )))[0];
    if (note) return note;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

async function waitForEmail(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("notifyDavisBaconAutoSyncFailure email delivery (Task #1353)", () => {
  it("queues an email to the connection owner via the standard delivery flow when a background sync fails", async () => {
    const owner = await makeOwner("owner");
    await db.insert(notificationChannelPrefs).values({
      userId: owner.id,
      emailEnabled: true,
    });
    await makeConnection(owner.id);

    const { queueWageDecisionSync } = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    const out = await queueWageDecisionSync(orgId, "CA20260111", { awaitResult: false });
    expect(out.status).toBe("queued");

    const note = await waitForNotification(owner.id);
    expect(note).toBeTruthy();
    expect(note!.type).toBe("DAVIS_BACON_AUTO_SYNC_FAILED");

    await waitForEmail(() => getTestEmailOutbox().length > 0);
    const outbox = getTestEmailOutbox();
    expect(outbox.length).toBe(1);
    const sent = outbox[0];
    expect(sent.to).toEqual([owner.email]);
    expect(sent.subject).toContain("Davis-Bacon");
    expect(sent.subject?.toLowerCase()).toContain("failed");
    expect(`${sent.text ?? ""}${sent.html ?? ""}`).toContain("CA20260111");
    expect(sent.html ?? "").toContain("/integrations");
  });

  it("respects the owner's emailEnabled=false preference (in-app notification only, no email)", async () => {
    const owner = await makeOwner("muted");
    await db.insert(notificationChannelPrefs).values({
      userId: owner.id,
      emailEnabled: false,
    });
    await makeConnection(owner.id);

    const { queueWageDecisionSync } = await import(
      "../integrations/providers/dol_davis_bacon/sync"
    );
    await queueWageDecisionSync(orgId, "CA20260222", { awaitResult: false });

    const note = await waitForNotification(owner.id);
    expect(note).toBeTruthy();

    await new Promise((r) => setTimeout(r, 250));
    expect(getTestEmailOutbox().length).toBe(0);
  });
});
