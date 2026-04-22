/**
 * Task #1101 — storage-level coverage for
 * `summarizeOrgAdminAlertFailureFallbackMutes`.
 *
 * The UI side of the per-channel mute summary (Task #1079) is already
 * exercised in `admin-transcript-backfill-fallback-suppressed.test.tsx`
 * and the route wiring lives in `crmCallsRoutes.ts`, but the storage
 * helper itself only had implicit coverage. This suite locks in each
 * exclusion path the helper claims to mirror from
 * `listOrgAdminsForAlertFailureFallback`:
 *   - `crmBackfillSummaryChannel = "none"`
 *   - legacy `notification_channel_prefs.email_enabled = false`
 *   - `crmAlertFailureFallbackEnabled = false`
 *   - `alertFailureEmailMode` not allowing the realtime stream
 *   - `crmAlertFailureFallbackMutedChannels` containing the channel
 *
 * We additionally cross-check the resulting `effectiveRecipientCount`
 * against the actual fan-out returned by
 * `listOrgAdminsForAlertFailureFallback(orgId, channel)` so a future
 * refactor of either function can't silently drift the badge.
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
    expect(summary).toEqual({
      slack: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
      email: { mutedAdminCount: 0, effectiveRecipientCount: 1 },
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
