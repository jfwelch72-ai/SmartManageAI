/**
 * Task #1095 — focused storage-level coverage for the per-stream
 * `alertFailureEmailMode` filter on `listOrgAdminsForAlertFailureFallback`.
 *
 * Task #1080 already exercises the Task #1066 mute knobs and only
 * smoke-tests the Task #1076 stream filter. This suite seeds admins
 * with each of the four `alertFailureEmailMode` values ("both",
 * "realtime", "digest", "none") and asserts inclusion/exclusion when
 * the lookup is called with `stream: "realtime"`, `stream: "digest"`,
 * and the legacy no-stream form, so future refactors can't silently
 * regress per-stream opt-in.
 *
 * It also confirms that the stream filter and the Task #1066 mute knobs
 * compose orthogonally — a digest-only admin who muted slack is still
 * excluded from a realtime+slack call by the stream filter (not by the
 * mute), and a realtime-only admin who muted email is still excluded
 * from a digest+email call by the stream filter.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { listOrgAdminsForAlertFailureFallback } from "../crm/transcriptBackfillStorage";

const TEST_PREFIX = "__alert_fallback_stream_test__";

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
  alertFailureEmailMode: "both" | "realtime" | "digest" | "none";
  fallbackMutedChannels?: string[];
};

async function seedAdmin(opts: SeedOpts): Promise<string> {
  const email = `${TEST_PREFIX}${opts.label}@test.invalid`;
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "x",
      firstName: "Admin",
      lastName: opts.label,
      organizationId: orgId,
      role: "ADMIN",
      isActive: true,
      crmAlertFailureFallbackEnabled: true,
      crmAlertFailureFallbackMutedChannels: opts.fallbackMutedChannels ?? [],
      crmBackfillSummaryChannel: "email",
      alertFailureEmailMode: opts.alertFailureEmailMode,
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

describe("listOrgAdminsForAlertFailureFallback — Task #1076 per-stream filter (Task #1095)", () => {
  it("includes 'both' and 'realtime' admins on a realtime call; excludes 'digest' and 'none'", async () => {
    const bothId = await seedAdmin({ label: "stream-both", alertFailureEmailMode: "both" });
    const realtimeId = await seedAdmin({ label: "stream-realtime", alertFailureEmailMode: "realtime" });
    const digestId = await seedAdmin({ label: "stream-digest", alertFailureEmailMode: "digest" });
    const noneId = await seedAdmin({ label: "stream-none", alertFailureEmailMode: "none" });

    const rows = await listOrgAdminsForAlertFailureFallback(orgId, "email", "realtime");
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(bothId);
    expect(ids).toContain(realtimeId);
    expect(ids).not.toContain(digestId);
    expect(ids).not.toContain(noneId);
  });

  it("includes 'both' and 'digest' admins on a digest call; excludes 'realtime' and 'none'", async () => {
    const bothId = await seedAdmin({ label: "stream-both", alertFailureEmailMode: "both" });
    const realtimeId = await seedAdmin({ label: "stream-realtime", alertFailureEmailMode: "realtime" });
    const digestId = await seedAdmin({ label: "stream-digest", alertFailureEmailMode: "digest" });
    const noneId = await seedAdmin({ label: "stream-none", alertFailureEmailMode: "none" });

    const rows = await listOrgAdminsForAlertFailureFallback(orgId, "email", "digest");
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(bothId);
    expect(ids).toContain(digestId);
    expect(ids).not.toContain(realtimeId);
    expect(ids).not.toContain(noneId);
  });

  it("excludes 'none' admins from both stream calls regardless of channel", async () => {
    const noneId = await seedAdmin({ label: "stream-none", alertFailureEmailMode: "none" });

    const realtimeSlack = await listOrgAdminsForAlertFailureFallback(orgId, "slack", "realtime");
    const realtimeEmail = await listOrgAdminsForAlertFailureFallback(orgId, "email", "realtime");
    const digestSlack = await listOrgAdminsForAlertFailureFallback(orgId, "slack", "digest");
    const digestEmail = await listOrgAdminsForAlertFailureFallback(orgId, "email", "digest");

    for (const rows of [realtimeSlack, realtimeEmail, digestSlack, digestEmail]) {
      expect(rows.map((r) => r.id)).not.toContain(noneId);
    }
  });

  it("ignores the stream filter when no stream is supplied (all modes pass, including 'none')", async () => {
    // The legacy no-stream signature pre-dates Task #1076; per the storage
    // implementation the stream filter is a no-op when undefined, so even
    // `alertFailureEmailMode = "none"` admins are returned. Existing call
    // sites that haven't adopted the stream argument keep behaving as before.
    const bothId = await seedAdmin({ label: "stream-both", alertFailureEmailMode: "both" });
    const realtimeId = await seedAdmin({ label: "stream-realtime", alertFailureEmailMode: "realtime" });
    const digestId = await seedAdmin({ label: "stream-digest", alertFailureEmailMode: "digest" });
    const noneId = await seedAdmin({ label: "stream-none", alertFailureEmailMode: "none" });

    const rows = await listOrgAdminsForAlertFailureFallback(orgId, "email");
    const ids = rows.map((r) => r.id);

    expect(ids).toContain(bothId);
    expect(ids).toContain(realtimeId);
    expect(ids).toContain(digestId);
    expect(ids).toContain(noneId);
  });

  it("composes the stream filter with the Task #1066 mute knobs orthogonally", async () => {
    // A digest-only admin who muted slack should be excluded from a
    // realtime+slack call by the *stream* filter — not the mute. To prove
    // it's the stream filter doing the work, we also assert the same admin
    // is excluded from a realtime+EMAIL call (where the slack mute is
    // irrelevant). Symmetrically, a realtime-only admin who muted email
    // is excluded from a digest+email call by the stream filter, and also
    // from a digest+slack call where the email mute would not apply.
    const digestSlackMutedId = await seedAdmin({
      label: "digest-slack-muted",
      alertFailureEmailMode: "digest",
      fallbackMutedChannels: ["slack"],
    });
    const realtimeEmailMutedId = await seedAdmin({
      label: "realtime-email-muted",
      alertFailureEmailMode: "realtime",
      fallbackMutedChannels: ["email"],
    });

    const realtimeSlack = await listOrgAdminsForAlertFailureFallback(orgId, "slack", "realtime");
    const realtimeEmail = await listOrgAdminsForAlertFailureFallback(orgId, "email", "realtime");
    expect(realtimeSlack.map((r) => r.id)).not.toContain(digestSlackMutedId);
    expect(realtimeEmail.map((r) => r.id)).not.toContain(digestSlackMutedId);
    // The realtime-only admin still passes the stream filter on realtime
    // calls — only the email mute trims them from realtime+email.
    expect(realtimeSlack.map((r) => r.id)).toContain(realtimeEmailMutedId);
    expect(realtimeEmail.map((r) => r.id)).not.toContain(realtimeEmailMutedId);

    const digestSlack = await listOrgAdminsForAlertFailureFallback(orgId, "slack", "digest");
    const digestEmail = await listOrgAdminsForAlertFailureFallback(orgId, "email", "digest");
    expect(digestEmail.map((r) => r.id)).not.toContain(realtimeEmailMutedId);
    expect(digestSlack.map((r) => r.id)).not.toContain(realtimeEmailMutedId);
    // The digest-only admin still passes the stream filter on digest calls —
    // only the slack mute trims them from digest+slack.
    expect(digestSlack.map((r) => r.id)).not.toContain(digestSlackMutedId);
    expect(digestEmail.map((r) => r.id)).toContain(digestSlackMutedId);
  });
});
