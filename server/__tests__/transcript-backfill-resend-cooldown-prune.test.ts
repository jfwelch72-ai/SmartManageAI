/**
 * Task #1137 — pin the periodic housekeeping helper for the persisted
 * resend cooldown ledger added in Task #1098. Each successful "Resend"
 * click upserts a row in
 * `crm_transcript_backfill_alert_resend_cooldowns`; rows are normally
 * cleared only when an immediate follow-up rolls back the reservation,
 * so without this helper the table grows one row per resent alert
 * delivery forever.
 *
 * This is a live-DB unit test: we insert one stale row + one fresh row
 * for an isolated synthetic org, run the prune, and assert that only
 * the stale row was removed. The fresh row protects an active
 * reservation from being released out from under a concurrent caller.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../db";
import { crmTranscriptBackfillAlertResendCooldowns } from "@shared/schema";
import { pruneBackfillAlertResendCooldownsBefore } from "../storage";
import { ensureCrmTranscriptBackfillAlertResendCooldownsTable } from "../utils/ensureCrmTranscriptBackfillAlertResendCooldownsTable";

const SUFFIX = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ORG_ID = `__test_resend_prune_${SUFFIX}__`;
const STALE_JOB_ID = `stale-${SUFFIX}`;
const FRESH_JOB_ID = `fresh-${SUFFIX}`;
const OTHER_ORG_ID = `__test_resend_prune_other_${SUFFIX}__`;
const OTHER_JOB_ID = `other-${SUFFIX}`;

const NOW = new Date("2026-04-22T12:00:00.000Z");
const STALE_AT = new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
const FRESH_AT = new Date(NOW.getTime() - 5 * 60 * 1000); // 5 min ago — well within any sane cutoff
const OTHER_STALE_AT = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000);
const CUTOFF = new Date(NOW.getTime() - 24 * 60 * 60 * 1000); // 1 day ago

beforeAll(async () => {
  await ensureCrmTranscriptBackfillAlertResendCooldownsTable();
  await db.insert(crmTranscriptBackfillAlertResendCooldowns).values([
    {
      orgId: ORG_ID,
      jobId: STALE_JOB_ID,
      channel: "email",
      lastResendAt: STALE_AT,
    },
    {
      orgId: ORG_ID,
      jobId: FRESH_JOB_ID,
      channel: "email",
      lastResendAt: FRESH_AT,
    },
    {
      orgId: OTHER_ORG_ID,
      jobId: OTHER_JOB_ID,
      channel: "slack",
      lastResendAt: OTHER_STALE_AT,
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(crmTranscriptBackfillAlertResendCooldowns)
    .where(
      inArray(crmTranscriptBackfillAlertResendCooldowns.orgId, [
        ORG_ID,
        OTHER_ORG_ID,
      ]),
    );
});

describe("pruneBackfillAlertResendCooldownsBefore (Task #1137)", () => {
  it("deletes rows older than the cutoff and leaves fresh rows intact", async () => {
    await pruneBackfillAlertResendCooldownsBefore(CUTOFF);

    const remaining = await db
      .select({
        orgId: crmTranscriptBackfillAlertResendCooldowns.orgId,
        jobId: crmTranscriptBackfillAlertResendCooldowns.jobId,
        channel: crmTranscriptBackfillAlertResendCooldowns.channel,
      })
      .from(crmTranscriptBackfillAlertResendCooldowns)
      .where(
        inArray(crmTranscriptBackfillAlertResendCooldowns.orgId, [
          ORG_ID,
          OTHER_ORG_ID,
        ]),
      );

    // The two stale rows (one per org) are gone; the fresh row remains.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toEqual({
      orgId: ORG_ID,
      jobId: FRESH_JOB_ID,
      channel: "email",
    });
  });

  it("is a no-op when nothing is older than the cutoff", async () => {
    // Re-run with an even older cutoff: the only surviving row is the
    // fresh one (5 min old), so nothing matches.
    const veryOldCutoff = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    await pruneBackfillAlertResendCooldownsBefore(veryOldCutoff);

    const [survivor] = await db
      .select()
      .from(crmTranscriptBackfillAlertResendCooldowns)
      .where(
        and(
          eq(crmTranscriptBackfillAlertResendCooldowns.orgId, ORG_ID),
          eq(crmTranscriptBackfillAlertResendCooldowns.jobId, FRESH_JOB_ID),
          eq(crmTranscriptBackfillAlertResendCooldowns.channel, "email"),
        ),
      );

    expect(survivor).toBeDefined();
    expect(survivor?.lastResendAt.toISOString()).toBe(FRESH_AT.toISOString());
  });
});
