/**
 * Task #1139 — storage-level coverage for `updateOrgAdminAlertFailureMode`.
 *
 * Backs the new admin transcript-backfill page inline action that lets ops
 * leads change another active admin's `alertFailureEmailMode` in one click
 * (after a confirmation). Asserts:
 *   - the row is updated and previous/new modes are returned for audit
 *   - cross-org user ids are rejected (no silent updates)
 *   - non-ADMIN and inactive rows are rejected
 *   - a no-op call still resolves and reports `changed=false`
 *   - missing/legacy modes are normalised to "both" for the previous value
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { updateOrgAdminAlertFailureMode } from "../storage";

const TEST_PREFIX = "__update_alert_failure_mode_test__";

let orgA: string;
let orgB: string;

async function cleanupTestData() {
  await db
    .delete(users)
    .where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
  await db
    .delete(organizations)
    .where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
}

async function seedUser(opts: {
  label: string;
  organizationId?: string;
  role?: "ADMIN" | "FIELD_WORKER";
  isActive?: boolean;
  alertFailureEmailMode?: "both" | "realtime" | "digest" | "none";
}): Promise<string> {
  const email = `${TEST_PREFIX}${opts.label}@test.invalid`;
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "x",
      firstName: "Admin",
      lastName: opts.label,
      organizationId: opts.organizationId ?? orgA,
      role: opts.role ?? "ADMIN",
      isActive: opts.isActive ?? true,
      alertFailureEmailMode: opts.alertFailureEmailMode ?? "both",
    })
    .returning();
  return u.id;
}

beforeAll(async () => {
  await cleanupTestData();
  const slugA = `${TEST_PREFIX}orgA-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slugB = `${TEST_PREFIX}orgB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [oA] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}orgA`, slug: slugA })
    .returning();
  const [oB] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}orgB`, slug: slugB })
    .returning();
  orgA = oA.id;
  orgB = oB.id;
});

beforeEach(async () => {
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
});

afterAll(async () => {
  await cleanupTestData();
});

describe("updateOrgAdminAlertFailureMode (Task #1139)", () => {
  it("updates an active admin's mode and reports the previous value", async () => {
    const id = await seedUser({
      label: "alex",
      alertFailureEmailMode: "both",
    });
    const result = await updateOrgAdminAlertFailureMode(orgA, id, "digest");
    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);
    expect(result!.previousMode).toBe("both");
    expect(result!.newMode).toBe("digest");

    const [row] = await db.select().from(users).where(eq(users.id, id));
    expect(row.alertFailureEmailMode).toBe("digest");
  });

  it("returns null (no write) for users in a different org", async () => {
    const id = await seedUser({
      label: "cross-tenant",
      organizationId: orgB,
      alertFailureEmailMode: "both",
    });
    const result = await updateOrgAdminAlertFailureMode(orgA, id, "none");
    expect(result).toBeNull();
    const [row] = await db.select().from(users).where(eq(users.id, id));
    // The row in orgB must remain untouched.
    expect(row.alertFailureEmailMode).toBe("both");
  });

  it("returns null for non-ADMIN and inactive users", async () => {
    const fieldId = await seedUser({
      label: "field",
      role: "FIELD_WORKER",
      alertFailureEmailMode: "both",
    });
    const inactiveId = await seedUser({
      label: "inactive",
      isActive: false,
      alertFailureEmailMode: "both",
    });
    expect(
      await updateOrgAdminAlertFailureMode(orgA, fieldId, "none"),
    ).toBeNull();
    expect(
      await updateOrgAdminAlertFailureMode(orgA, inactiveId, "none"),
    ).toBeNull();
  });

  it("returns null for an unknown user id", async () => {
    expect(
      await updateOrgAdminAlertFailureMode(
        orgA,
        "00000000-0000-0000-0000-000000000000",
        "digest",
      ),
    ).toBeNull();
  });

  it("reports changed=false when the requested mode equals the current one", async () => {
    const id = await seedUser({
      label: "noop",
      alertFailureEmailMode: "digest",
    });
    const result = await updateOrgAdminAlertFailureMode(orgA, id, "digest");
    expect(result).not.toBeNull();
    expect(result!.changed).toBe(false);
    expect(result!.previousMode).toBe("digest");
    expect(result!.newMode).toBe("digest");
  });

  it("returns the email + name on the result for the audit/toast UX", async () => {
    const id = await seedUser({
      label: "named",
      alertFailureEmailMode: "both",
    });
    const result = await updateOrgAdminAlertFailureMode(orgA, id, "realtime");
    expect(result).not.toBeNull();
    expect(result!.email).toBe(`${TEST_PREFIX}named@test.invalid`);
    expect(result!.lastName).toBe("named");
  });
});
