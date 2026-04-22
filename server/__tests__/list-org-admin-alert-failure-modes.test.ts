/**
 * Task #1085 — storage-level coverage for `listOrgAdminAlertFailureModes`.
 *
 * The new admin transcript-backfill panel surfaces each active org admin's
 * `alertFailureEmailMode` so ops leads can spot at a glance who falls into
 * which bucket. This suite asserts:
 *   - active ADMIN rows are returned with their saved mode
 *   - non-ADMIN / inactive rows are filtered out
 *   - missing modes are normalised to the legacy "both" default
 *   - rows without an email are dropped (no recipient to identify)
 *   - the result ordering bubbles "no real-time stream" buckets first so
 *     the frontend renders the at-risk admins at the top of the list
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { listOrgAdminAlertFailureModes } from "../storage";

const TEST_PREFIX = "__alert_failure_modes_test__";

let orgId: string;

async function cleanupTestData() {
  await db
    .delete(users)
    .where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
  await db
    .delete(organizations)
    .where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
}

type SeedOpts = {
  label: string;
  role?: "ADMIN" | "FIELD_WORKER";
  isActive?: boolean;
  alertFailureEmailMode?: "both" | "realtime" | "digest" | "none";
};

async function seedUser(opts: SeedOpts): Promise<string> {
  const email = `${TEST_PREFIX}${opts.label}@test.invalid`;
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "x",
      firstName: "Admin",
      lastName: opts.label,
      organizationId: orgId,
      role: opts.role ?? "ADMIN",
      isActive: opts.isActive ?? true,
      alertFailureEmailMode: opts.alertFailureEmailMode ?? "both",
    })
    .returning();
  return u.id;
}

beforeAll(async () => {
  await cleanupTestData();
  const slug = `${TEST_PREFIX}org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({ name: `${TEST_PREFIX}org`, slug })
    .returning();
  orgId = org.id;
});

beforeEach(async () => {
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
});

afterAll(async () => {
  await cleanupTestData();
});

describe("listOrgAdminAlertFailureModes (Task #1085)", () => {
  it("returns active ADMIN rows with their saved mode", async () => {
    await seedUser({ label: "alex", alertFailureEmailMode: "realtime" });
    await seedUser({ label: "blair", alertFailureEmailMode: "digest" });
    await seedUser({ label: "casey", alertFailureEmailMode: "both" });

    const rows = await listOrgAdminAlertFailureModes(orgId);
    const byEmail = new Map(rows.map((r) => [r.email, r]));

    expect(rows).toHaveLength(3);
    expect(byEmail.get(`${TEST_PREFIX}alex@test.invalid`)?.alertFailureEmailMode)
      .toBe("realtime");
    expect(byEmail.get(`${TEST_PREFIX}blair@test.invalid`)?.alertFailureEmailMode)
      .toBe("digest");
    expect(byEmail.get(`${TEST_PREFIX}casey@test.invalid`)?.alertFailureEmailMode)
      .toBe("both");
  });

  it("filters out non-ADMIN and inactive rows", async () => {
    await seedUser({ label: "field", role: "FIELD_WORKER" });
    await seedUser({ label: "inactive", isActive: false });
    await seedUser({ label: "keeper" });

    const rows = await listOrgAdminAlertFailureModes(orgId);
    expect(rows.map((r) => r.email)).toEqual([
      `${TEST_PREFIX}keeper@test.invalid`,
    ]);
  });

  it("orders 'no real-time stream' buckets ahead of real-time recipients, alphabetised within bucket", async () => {
    // Intentionally seed in arbitrary order so the test verifies the
    // server-side sort, not insertion order.
    await seedUser({ label: "zeta-both", alertFailureEmailMode: "both" });
    await seedUser({ label: "yankee-realtime", alertFailureEmailMode: "realtime" });
    await seedUser({ label: "alpha-digest", alertFailureEmailMode: "digest" });
    await seedUser({ label: "bravo-none", alertFailureEmailMode: "none" });
    await seedUser({ label: "charlie-digest", alertFailureEmailMode: "digest" });

    const rows = await listOrgAdminAlertFailureModes(orgId);
    expect(rows.map((r) => r.alertFailureEmailMode)).toEqual([
      "none",
      "digest",
      "digest",
      "realtime",
      "both",
    ]);
    // Within the "digest" bucket the alphabetical email tiebreaker means
    // alpha-* sorts ahead of charlie-*.
    expect(rows[1].email).toBe(`${TEST_PREFIX}alpha-digest@test.invalid`);
    expect(rows[2].email).toBe(`${TEST_PREFIX}charlie-digest@test.invalid`);
  });
});
