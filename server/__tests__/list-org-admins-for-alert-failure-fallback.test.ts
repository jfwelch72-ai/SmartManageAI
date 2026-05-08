/**
 * Task #1080 — storage-level coverage for `listOrgAdminsForAlertFailureFallback`.
 *
 * The dispatcher tests mock the storage layer, so the actual SQL filter
 * around the Task #1066 user prefs (`crmAlertFailureFallbackEnabled`,
 * `crmAlertFailureFallbackMutedChannels`) and the failing-channel argument
 * was previously only verified by hand. This suite seeds users with the
 * various combinations of the new prefs and asserts the lookup returns or
 * skips the right rows for both the per-channel calls ("slack" / "email")
 * and the legacy no-channel call.
 *
 * Note: the function under test also enforces unrelated filters
 * (org/role/active, `crmBackfillSummaryChannel = "none"`, the legacy
 * `notification_channel_prefs.email_enabled = false`, and the Task #1076
 * `alertFailureEmailMode` stream filter). Those are exercised lightly here
 * to confirm they still compose correctly with the new mute knobs.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { listOrgAdminsForAlertFailureFallback } from "../crm/transcriptBackfillStorage";

const TEST_PREFIX = "__alert_fallback_filter_test__";

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
  fallbackEnabled?: boolean;
  fallbackMutedChannels?: string[];
  backfillChannel?: "email" | "none";
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
      crmAlertFailureFallbackEnabled: opts.fallbackEnabled ?? true,
      crmAlertFailureFallbackMutedChannels: opts.fallbackMutedChannels ?? [],
      crmBackfillSummaryChannel: opts.backfillChannel ?? "email",
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
  // Wipe seeded users between scenarios so each test composes its own
  // population without cross-contamination from prior cases.
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
});

afterAll(async () => {
  await cleanupTestData();
});

describe("listOrgAdminsForAlertFailureFallback — Task #1066 mute filter (Task #1080)", () => {
  it("returns admins with the fallback enabled and no mutes for every call shape", async () => {
    const id = await seedUser({ label: "default-admin" });

    const slack = await listOrgAdminsForAlertFailureFallback(orgId, "slack");
    const email = await listOrgAdminsForAlertFailureFallback(orgId, "email");
    const legacy = await listOrgAdminsForAlertFailureFallback(orgId);

    for (const rows of [slack, email, legacy]) {
      expect(rows.map((r) => r.id)).toContain(id);
    }
  });

  it("skips admins with crmAlertFailureFallbackEnabled=false on every channel and the legacy call", async () => {
    const id = await seedUser({ label: "all-muted", fallbackEnabled: false });

    const slack = await listOrgAdminsForAlertFailureFallback(orgId, "slack");
    const email = await listOrgAdminsForAlertFailureFallback(orgId, "email");
    const legacy = await listOrgAdminsForAlertFailureFallback(orgId);

    for (const rows of [slack, email, legacy]) {
      expect(rows.map((r) => r.id)).not.toContain(id);
    }
  });

  it("skips an admin only on the channel listed in crmAlertFailureFallbackMutedChannels", async () => {
    const slackMutedId = await seedUser({
      label: "slack-muted",
      fallbackMutedChannels: ["slack"],
    });
    const emailMutedId = await seedUser({
      label: "email-muted",
      fallbackMutedChannels: ["email"],
    });
    const bothMutedId = await seedUser({
      label: "both-muted",
      fallbackMutedChannels: ["slack", "email"],
    });

    const slackRows = await listOrgAdminsForAlertFailureFallback(orgId, "slack");
    const slackIds = slackRows.map((r) => r.id);
    expect(slackIds).not.toContain(slackMutedId);
    expect(slackIds).toContain(emailMutedId);
    expect(slackIds).not.toContain(bothMutedId);

    const emailRows = await listOrgAdminsForAlertFailureFallback(orgId, "email");
    const emailIds = emailRows.map((r) => r.id);
    expect(emailIds).toContain(slackMutedId);
    expect(emailIds).not.toContain(emailMutedId);
    expect(emailIds).not.toContain(bothMutedId);
  });

  it("ignores crmAlertFailureFallbackMutedChannels entirely on the legacy no-channel call", async () => {
    // The legacy call signature pre-dates the mute list; per the storage
    // implementation, only the fallbackEnabled flag is honored when no
    // channel is supplied so the existing call sites keep behaving as before.
    const slackMutedId = await seedUser({
      label: "legacy-slack-muted",
      fallbackMutedChannels: ["slack"],
    });
    const bothMutedId = await seedUser({
      label: "legacy-both-muted",
      fallbackMutedChannels: ["slack", "email"],
    });

    const legacy = await listOrgAdminsForAlertFailureFallback(orgId);
    const ids = legacy.map((r) => r.id);
    expect(ids).toContain(slackMutedId);
    expect(ids).toContain(bothMutedId);
  });

  it("composes the mute filter with the existing org/role/active and channel='none' filters", async () => {
    const adminId = await seedUser({ label: "good-admin" });
    const inactiveId = await seedUser({ label: "inactive", isActive: false });
    const workerId = await seedUser({ label: "worker", role: "FIELD_WORKER" });
    const noneChannelId = await seedUser({
      label: "channel-none",
      backfillChannel: "none",
    });
    const slackMutedId = await seedUser({
      label: "compose-slack-muted",
      fallbackMutedChannels: ["slack"],
    });

    const slackRows = await listOrgAdminsForAlertFailureFallback(orgId, "slack");
    const slackIds = slackRows.map((r) => r.id);
    expect(slackIds).toContain(adminId);
    expect(slackIds).not.toContain(inactiveId);
    expect(slackIds).not.toContain(workerId);
    expect(slackIds).not.toContain(noneChannelId);
    expect(slackIds).not.toContain(slackMutedId);
  });

  it("ignores an unrelated muted channel value (only the failing channel arg matters)", async () => {
    // Defensive: if a future channel string is added to the mute list but
    // the dispatcher hasn't started passing it as the failing channel yet,
    // existing slack/email lookups must not start dropping the admin.
    const id = await seedUser({
      label: "unknown-mute",
      fallbackMutedChannels: ["webhook"],
    });

    const slackRows = await listOrgAdminsForAlertFailureFallback(orgId, "slack");
    const emailRows = await listOrgAdminsForAlertFailureFallback(orgId, "email");
    expect(slackRows.map((r) => r.id)).toContain(id);
    expect(emailRows.map((r) => r.id)).toContain(id);
  });
});
