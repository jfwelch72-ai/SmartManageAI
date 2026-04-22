/**
 * Storage-level coverage for `summarizeOrgAdminAlertFailureFallbackMutes`.
 *
 * Task #1101 — locks in each per-channel exclusion path the helper claims
 * to mirror from `listOrgAdminsForAlertFailureFallback`:
 *   - `crmBackfillSummaryChannel = "none"`
 *   - legacy `notification_channel_prefs.email_enabled = false`
 *   - `crmAlertFailureFallbackEnabled = false`
 *   - `alertFailureEmailMode` not allowing the realtime stream
 *   - `crmAlertFailureFallbackMutedChannels` containing the channel
 * It additionally cross-checks the resulting `effectiveRecipientCount`
 * against the actual fan-out returned by
 * `listOrgAdminsForAlertFailureFallback(orgId, channel)` so a future
 * refactor of either function can't silently drift the badge.
 *
 * Task #1100 — adds coverage for the org-wide `digest` rollup the helper
 * also returns so the admin transcript-backfill page can flag "the daily
 * digest fallback was silenced too" when nobody is opted into the digest
 * stream. The digest counters live alongside the per-channel realtime
 * counters and follow the same baseline filters but are independent of
 * the per-channel mute switch (the daily digest is per-org).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  users,
  notificationChannelPrefs,
} from "@shared/schema";
import {
  summarizeOrgAdminAlertFailureFallbackMutes,
  listOrgAdminsForAlertFailureFallback,
} from "../storage";

const TEST_PREFIX = "__alert_fallback_mute_summary_test__";

let orgId: string;

async function cleanupTestData() {
  await db
    .delete(notificationChannelPrefs)
    .where(
      sql`${notificationChannelPrefs.userId} IN (
        SELECT id FROM users WHERE email LIKE ${`${TEST_PREFIX}%`}
      )`,
    );
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
  legacyEmailEnabled?: boolean;
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
  if (typeof opts.legacyEmailEnabled === "boolean") {
    await db.insert(notificationChannelPrefs).values({
      userId: u.id,
      emailEnabled: opts.legacyEmailEnabled,
    });
  }
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
  await db
    .delete(notificationChannelPrefs)
    .where(
      sql`${notificationChannelPrefs.userId} IN (
        SELECT id FROM users WHERE email LIKE ${`${TEST_PREFIX}%`}
      )`,
    );
  await db.delete(users).where(sql`${users.email} LIKE ${`${TEST_PREFIX}%`}`);
});

afterAll(async () => {
  await cleanupTestData();
});

describe("summarizeOrgAdminAlertFailureFallbackMutes (Task #1101)", () => {
  it("returns zero counts when the org has no admins", async () => {
    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary).toEqual({
      slack: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
      email: { mutedAdminCount: 0, effectiveRecipientCount: 0 },
      digest: { eligibleRecipientCount: 0, streamMutedAdminCount: 0 },
    });
  });

  it("counts an unmuted admin as a recipient on every channel", async () => {
    await seedUser({ label: "default-admin" });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
  });

  it("buckets per-channel mutes into mutedAdminCount only on that channel", async () => {
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "slack-muted",
      fallbackMutedChannels: ["slack"],
    });
    await seedUser({
      label: "email-muted",
      fallbackMutedChannels: ["email"],
    });
    await seedUser({
      label: "both-muted",
      fallbackMutedChannels: ["slack", "email"],
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    // default + email-muted are still on slack; slack-muted + both-muted muted slack
    expect(summary.slack).toEqual({
      mutedAdminCount: 2,
      effectiveRecipientCount: 2,
    });
    // default + slack-muted are still on email; email-muted + both-muted muted email
    expect(summary.email).toEqual({
      mutedAdminCount: 2,
      effectiveRecipientCount: 2,
    });
  });

  it("excludes admins with crmBackfillSummaryChannel = 'none' from both buckets", async () => {
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "channel-none-muted",
      backfillChannel: "none",
      fallbackMutedChannels: ["slack", "email"],
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    // The channel=none admin must not appear in either bucket — they
    // didn't actively mute the per-channel switch in a way the badge
    // should advertise; they opted out at a higher level.
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
  });

  it("excludes admins whose legacy notification_channel_prefs.email_enabled is false", async () => {
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "legacy-opt-out",
      legacyEmailEnabled: false,
      fallbackMutedChannels: ["slack"],
    });
    // A row with email_enabled=true should NOT be excluded by this filter.
    await seedUser({
      label: "legacy-opt-in",
      legacyEmailEnabled: true,
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 2,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 2,
    });
  });

  it("excludes admins with crmAlertFailureFallbackEnabled=false from both buckets", async () => {
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "fully-disabled",
      fallbackEnabled: false,
      fallbackMutedChannels: ["slack", "email"],
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
  });

  it("excludes admins whose alertFailureEmailMode does not include the realtime stream", async () => {
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "digest-only",
      alertFailureEmailMode: "digest",
      fallbackMutedChannels: ["slack"],
    });
    await seedUser({
      label: "mode-none",
      alertFailureEmailMode: "none",
    });
    // Realtime-allowing modes should still be counted.
    await seedUser({
      label: "realtime-only",
      alertFailureEmailMode: "realtime",
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 2,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 2,
    });
  });

  it("excludes inactive users and non-admin roles", async () => {
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "inactive",
      isActive: false,
      fallbackMutedChannels: ["slack"],
    });
    await seedUser({
      label: "field-worker",
      role: "FIELD_WORKER",
      fallbackMutedChannels: ["email"],
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
  });

  it("excludes users in other organizations", async () => {
    const otherSlug = `${TEST_PREFIX}other-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: `${TEST_PREFIX}other-org`, slug: otherSlug })
      .returning();

    await seedUser({ label: "default-admin" });
    await db.insert(users).values({
      email: `${TEST_PREFIX}cross-tenant@test.invalid`,
      passwordHash: "x",
      firstName: "Other",
      lastName: "Admin",
      organizationId: otherOrg.id,
      role: "ADMIN",
      isActive: true,
      crmAlertFailureFallbackMutedChannels: ["slack", "email"],
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.slack).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
    expect(summary.email).toEqual({
      mutedAdminCount: 0,
      effectiveRecipientCount: 1,
    });
  });

  it("matches the fan-out returned by listOrgAdminsForAlertFailureFallback per channel", async () => {
    // A representative mix of every exclusion path the helper enforces
    // so we can assert `effectiveRecipientCount` exactly equals the
    // length of the actual recipient list the dispatcher would use.
    await seedUser({ label: "default-admin" });
    await seedUser({
      label: "slack-muted",
      fallbackMutedChannels: ["slack"],
    });
    await seedUser({
      label: "email-muted",
      fallbackMutedChannels: ["email"],
    });
    await seedUser({
      label: "both-muted",
      fallbackMutedChannels: ["slack", "email"],
    });
    await seedUser({ label: "fully-disabled", fallbackEnabled: false });
    await seedUser({ label: "channel-none", backfillChannel: "none" });
    await seedUser({
      label: "legacy-opt-out",
      legacyEmailEnabled: false,
    });
    await seedUser({
      label: "digest-only",
      alertFailureEmailMode: "digest",
    });
    await seedUser({
      label: "realtime",
      alertFailureEmailMode: "realtime",
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    // Pass `"realtime"` so we line up with the stream filter the summary
    // helper applies internally — the dispatcher uses the same stream arg
    // when computing the actual fan-out for the realtime alert email, so
    // these are the recipient counts the badge needs to mirror.
    const slackFanout = await listOrgAdminsForAlertFailureFallback(
      orgId,
      "slack",
      "realtime",
    );
    const emailFanout = await listOrgAdminsForAlertFailureFallback(
      orgId,
      "email",
      "realtime",
    );

    expect(summary.slack.effectiveRecipientCount).toBe(slackFanout.length);
    expect(summary.email.effectiveRecipientCount).toBe(emailFanout.length);

    // Cross-check the muted bucket: among admins eligible *before* the
    // per-channel mute (i.e. fan-out + their own slack/email mute), the
    // mutedAdminCount should be the difference.
    // default + email-muted + realtime are slack recipients (3),
    // slack-muted + both-muted muted slack (2).
    expect(summary.slack).toEqual({
      mutedAdminCount: 2,
      effectiveRecipientCount: 3,
    });
    // default + slack-muted + realtime are email recipients (3),
    // email-muted + both-muted muted email (2).
    expect(summary.email).toEqual({
      mutedAdminCount: 2,
      effectiveRecipientCount: 3,
    });
  });
});

describe("summarizeOrgAdminAlertFailureFallbackMutes — digest counters (Task #1100)", () => {
  it("counts only realtime/none modes as digest-stream-muted", async () => {
    await seedUser({ label: "both", alertFailureEmailMode: "both" });
    await seedUser({ label: "digest", alertFailureEmailMode: "digest" });
    await seedUser({ label: "realtime", alertFailureEmailMode: "realtime" });
    await seedUser({ label: "none", alertFailureEmailMode: "none" });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);

    // both + digest → eligible (2); realtime + none → stream-muted (2)
    expect(summary.digest.eligibleRecipientCount).toBe(2);
    expect(summary.digest.streamMutedAdminCount).toBe(2);
  });

  it("excludes admins already filtered by baseline rules from both digest counters", async () => {
    // Eligible admin to keep the org non-empty.
    await seedUser({ label: "keep", alertFailureEmailMode: "both" });
    // Excluded by baseline filters → must not contribute to either bucket.
    await seedUser({
      label: "channel-none",
      alertFailureEmailMode: "none",
      backfillChannel: "none",
    });
    await seedUser({
      label: "fallback-off",
      alertFailureEmailMode: "realtime",
      fallbackEnabled: false,
    });
    await seedUser({
      label: "legacy-off",
      alertFailureEmailMode: "digest",
      legacyEmailEnabled: false,
    });
    await seedUser({
      label: "field-worker",
      role: "FIELD_WORKER",
      alertFailureEmailMode: "none",
    });
    await seedUser({
      label: "inactive",
      isActive: false,
      alertFailureEmailMode: "realtime",
    });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);

    expect(summary.digest.eligibleRecipientCount).toBe(1);
    expect(summary.digest.streamMutedAdminCount).toBe(0);
  });

  it("ignores per-channel mute switch when computing digest counters", async () => {
    // Two admins on `digest`, one with the slack channel muted.
    await seedUser({ label: "d1", alertFailureEmailMode: "digest" });
    await seedUser({
      label: "d2",
      alertFailureEmailMode: "digest",
      fallbackMutedChannels: ["slack"],
    });
    // One admin opted out of the digest stream entirely.
    await seedUser({ label: "r1", alertFailureEmailMode: "realtime" });

    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);

    // Both digest admins still count toward eligibility regardless of the
    // per-channel mute, since the digest is per-org.
    expect(summary.digest.eligibleRecipientCount).toBe(2);
    expect(summary.digest.streamMutedAdminCount).toBe(1);
  });

  it("returns zeroed digest counters for an org with no eligible admins", async () => {
    const summary = await summarizeOrgAdminAlertFailureFallbackMutes(orgId);
    expect(summary.digest.eligibleRecipientCount).toBe(0);
    expect(summary.digest.streamMutedAdminCount).toBe(0);
  });
});
