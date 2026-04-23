/**
 * Task #1449 — verify the per-PM email fan-out triggered when
 * `persistRateChangeRecords` writes a non-empty diff for a wage decision
 * referenced by one or more projects in the org.
 *
 * Acceptance check from the task brief:
 *   "persisting a non-empty diff for a decision used by two projects in
 *    two different orgs only notifies the right PMs."
 *
 * The test seeds two organizations (orgA, orgB), each with its own active
 * PM and a project whose `wageDecision` is the same shared decision
 * number. Calling `persistRateChangeRecords` for orgA only must produce
 * exactly one WAGE_DECISION_RATES_CHANGED_FOR_PM notification — for
 * orgA's PM, against orgA's project — and zero notifications for orgB's
 * PM. The notification body must list each affected classification with
 * old → new base/fringe/total numbers (the panel-flag rows always carry
 * the full triple, including dashes for added/removed classifications).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { sql, eq, and, inArray } from "drizzle-orm";

vi.mock("../services/notificationDelivery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/notificationDelivery")>();
  return {
    ...actual,
    deliverNotification: vi.fn(async () => undefined),
    deliverNotifications: vi.fn(async () => undefined),
    // Keep the real composeEmailContent so the email-composition test below
    // exercises the actual WAGE_DECISION_RATES_CHANGED_FOR_PM template.
    composeEmailContent: actual.composeEmailContent,
  };
});

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import { db } from "../db";
import {
  organizations,
  notifications,
  projects,
  users,
} from "@shared/schema";
import { persistRateChangeRecords } from "../integrations/providers/dol_davis_bacon/rateChangeFlags";
import { ensureWageDecisionRateChanges } from "../utils/ensureWageDecisionRateChanges";
import { ensureNotificationEnumValues } from "../utils/ensureNotificationEnumValues";
import type { WageRateDiffEntry } from "../services/davisBaconAdminNotifications";

const PREFIX = "__pmrate__";
const DECISION = "CA20260449";

let orgAId: string;
let orgBId: string;
let pmAId: string;
let pmBId: string;
let projAId: string;
let projBId: string;

async function cleanup(): Promise<void> {
  const orgRows = (await db.execute(
    sql`SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"}`,
  )) as unknown as { rows?: { id: string }[] };
  const ids = orgRows.rows?.map((r) => r.id) ?? [];
  if (ids.length === 0) return;
  await db.execute(
    sql`DELETE FROM "wage_decision_rate_changes" WHERE decision_number = ${DECISION}`,
  );
  await db.delete(notifications).where(inArray(notifications.organizationId, ids));
  await db.delete(projects).where(inArray(projects.gcOrganizationId, ids));
  await db.delete(users).where(inArray(users.organizationId, ids));
  await db.delete(organizations).where(inArray(organizations.id, ids));
}

beforeAll(async () => {
  await ensureNotificationEnumValues();
  await ensureWageDecisionRateChanges();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await cleanup();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const [orgA] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}orgA`, slug: `${PREFIX}a-${suffix}` })
    .returning();
  const [orgB] = await db
    .insert(organizations)
    .values({ name: `${PREFIX}orgB`, slug: `${PREFIX}b-${suffix}` })
    .returning();
  orgAId = orgA.id;
  orgBId = orgB.id;

  const [pmA] = await db
    .insert(users)
    .values({
      organizationId: orgAId,
      firstName: "Pat",
      lastName: "A",
      email: `${PREFIX}pmA-${suffix}@example.invalid`,
      role: "MANAGER",
      isActive: true,
      passwordHash: "x",
    })
    .returning();
  const [pmB] = await db
    .insert(users)
    .values({
      organizationId: orgBId,
      firstName: "Pat",
      lastName: "B",
      email: `${PREFIX}pmB-${suffix}@example.invalid`,
      role: "MANAGER",
      isActive: true,
      passwordHash: "x",
    })
    .returning();
  pmAId = pmA.id;
  pmBId = pmB.id;

  const [pA] = await db
    .insert(projects)
    .values({
      name: `${PREFIX}projA-${suffix}`,
      code: `${PREFIX}pA-${suffix}`,
      clientName: "Acme A",
      gcOrganizationId: orgAId,
      wageDecision: DECISION,
      projectManagerId: pmAId,
    })
    .returning();
  const [pB] = await db
    .insert(projects)
    .values({
      name: `${PREFIX}projB-${suffix}`,
      code: `${PREFIX}pB-${suffix}`,
      clientName: "Acme B",
      gcOrganizationId: orgBId,
      wageDecision: DECISION,
      projectManagerId: pmBId,
    })
    .returning();
  projAId = pA.id;
  projBId = pB.id;
});

function changed(name: string, oldBase: number, newBase: number): WageRateDiffEntry {
  return {
    kind: "changed",
    classification: name,
    oldBaseRate: oldBase,
    newBaseRate: newBase,
    oldFringeRate: 10,
    newFringeRate: 11,
    oldTotalRate: oldBase + 10,
    newTotalRate: newBase + 11,
  } as WageRateDiffEntry;
}

async function pmRateChangeNotificationsFor(orgId: string) {
  return db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.organizationId, orgId),
        eq(notifications.type, "WAGE_DECISION_RATES_CHANGED_FOR_PM"),
      ),
    );
}

describe("persistRateChangeRecords PM email fan-out (Task #1449)", () => {
  it("only notifies PMs in the org whose flags were just persisted", async () => {
    // Persist a non-empty diff for orgA only. orgB's PM must not be touched
    // even though orgB's project also references the same decision number.
    await persistRateChangeRecords(orgAId, DECISION, [
      changed("Carpenter", 50, 60),
      changed("Electrician", 70, 75),
    ]);

    const orgARows = await pmRateChangeNotificationsFor(orgAId);
    const orgBRows = await pmRateChangeNotificationsFor(orgBId);

    // orgA's PM gets exactly one notification, scoped to orgA's project.
    expect(orgARows).toHaveLength(1);
    expect(orgARows[0].userId).toBe(pmAId);
    expect(orgARows[0].relatedEntityId).toBe(projAId);
    expect(orgARows[0].relatedEntityType).toBe("PROJECT");
    expect(orgARows[0].title).toContain(DECISION);

    const msg = String(orgARows[0].message);
    // Lists every affected classification with old → new base/fringe/total
    // (the acceptance criteria). Both classifications and all three rate
    // legs must show up in the message body.
    expect(msg).toContain("Carpenter");
    expect(msg).toContain("Electrician");
    expect(msg).toMatch(/base \$50\.00 → \$60\.00/);
    expect(msg).toMatch(/fringe \$10\.00 → \$11\.00/);
    expect(msg).toMatch(/total \$60\.00 → \$71\.00/);

    // orgB's PM is untouched — cross-tenant isolation.
    expect(orgBRows).toHaveLength(0);
  });

  it("does not notify when no project in the org references the decision", async () => {
    // Drop orgA's project so no project in orgA references DECISION.
    await db.delete(projects).where(eq(projects.id, projAId));

    await persistRateChangeRecords(orgAId, DECISION, [
      changed("Carpenter", 50, 60),
    ]);

    const orgARows = await pmRateChangeNotificationsFor(orgAId);
    expect(orgARows).toHaveLength(0);
  });

  it("composes a payroll-tab deep link for the email action URL", async () => {
    const { composeEmailContent } = await import("../services/notificationDelivery");
    const prevBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://app.example.com";
    try {
      const out = composeEmailContent({
        id: "n1",
        userId: pmAId,
        type: "WAGE_DECISION_RATES_CHANGED_FOR_PM",
        title: `Davis-Bacon rates changed for ${DECISION}`,
        message:
          `The latest Davis-Bacon refresh changed 1 classification rate(s) ` +
          `on wage decision ${DECISION}.\n\n` +
          `• Updated — Carpenter: base $50.00 → $60.00, fringe $10.00 → $11.00, total $60.00 → $71.00`,
        relatedEntityId: projAId,
        relatedEntityType: "PROJECT",
      });
      const expectedUrl = `https://app.example.com/projects/${projAId}?tab=payroll`;
      expect(out.actionUrl).toBe(expectedUrl);
      expect(out.actionText).toBe("Open Project Payroll Tab");
      expect(out.html).toContain(expectedUrl);
      // Body still carries the per-classification breakdown including total.
      expect(out.body).toMatch(/total \$60\.00 → \$71\.00/);
    } finally {
      if (prevBaseUrl === undefined) {
        delete process.env.APP_BASE_URL;
      } else {
        process.env.APP_BASE_URL = prevBaseUrl;
      }
    }
  });

  it("skips projects with no PM and only notifies the assigned PM", async () => {
    // Clear the PM on orgA's project — no recipient → no notification.
    await db.update(projects).set({ projectManagerId: null }).where(eq(projects.id, projAId));

    await persistRateChangeRecords(orgAId, DECISION, [
      changed("Carpenter", 50, 60),
    ]);

    const orgARows = await pmRateChangeNotificationsFor(orgAId);
    expect(orgARows).toHaveLength(0);
  });
});
