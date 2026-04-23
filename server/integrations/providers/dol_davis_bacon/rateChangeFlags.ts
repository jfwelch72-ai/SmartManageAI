/**
 * Task #1409 — storage helpers for the per-classification rate-change
 * flags surfaced by the project prevailing wage panel. The Davis-Bacon
 * stale-refresh sweep (`processStaleWageDecisions`) writes records here
 * after a successful refresh whose diff is non-empty, the project
 * prevailing wage summary endpoint reads them to badge classifications
 * whose rate just shifted, and the acknowledge endpoint stamps
 * `acknowledgedAt` to clear the flag.
 *
 * A subsequent refresh that produces no diff for the same (org, decision)
 * pair deletes every record (acknowledged or not) so the badge auto-clears
 * without requiring a PM acknowledgement.
 */

import { db } from "../../../db";
import { wageDecisionRateChanges } from "@shared/schema";
import type { WageDecisionRateChange } from "@shared/schema";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { WageRateDiffEntry } from "../../../services/davisBaconAdminNotifications";
import { logError } from "../../../utils/logger";

/**
 * Normalize a classification name for case-insensitive matching against
 * the prevailing-wage summary classifications. The diff entries from
 * `diffWageRates` carry the original DOL display name, but the panel
 * may map them to an existing org classification (different casing /
 * trailing whitespace), so the read path normalizes both sides.
 */
export function normalizeClassificationKey(s: string): string {
  return s.trim().toLowerCase();
}

function num(n: number | null | undefined): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  return n.toFixed(2);
}

/**
 * Replace the panel-flag records for `(organizationId, decisionNumber)`
 * with one row per change in `changes`. The unique constraint on
 * (organizationId, decision_number, classification) lets us upsert each
 * row in place; we additionally delete any existing record whose
 * classification is no longer in the latest diff so a row that flipped
 * back to its original value clears its flag automatically.
 */
export async function persistRateChangeRecords(
  organizationId: string,
  decisionNumber: string,
  changes: ReadonlyArray<WageRateDiffEntry>,
): Promise<void> {
  const decision = decisionNumber.trim();
  if (!decision) return;

  if (changes.length === 0) {
    await db
      .delete(wageDecisionRateChanges)
      .where(
        and(
          eq(wageDecisionRateChanges.organizationId, organizationId),
          eq(wageDecisionRateChanges.decisionNumber, decision),
        ),
      );
    return;
  }

  const seenKeys = new Set<string>();
  for (const c of changes) {
    const key = normalizeClassificationKey(c.classification);
    if (!key || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const oldBase = c.kind === "added" ? null : (c as any).oldBaseRate ?? null;
    const newBase = c.kind === "removed" ? null : (c as any).newBaseRate ?? null;
    const oldFringe = c.kind === "added" ? null : (c as any).oldFringeRate ?? null;
    const newFringe = c.kind === "removed" ? null : (c as any).newFringeRate ?? null;
    const oldTotal = c.kind === "added" ? null : (c as any).oldTotalRate ?? null;
    const newTotal = c.kind === "removed" ? null : (c as any).newTotalRate ?? null;

    await db
      .insert(wageDecisionRateChanges)
      .values({
        organizationId,
        decisionNumber: decision,
        classification: c.classification,
        changeKind: c.kind,
        oldBaseRate: num(oldBase) ?? undefined,
        newBaseRate: num(newBase) ?? undefined,
        oldFringeRate: num(oldFringe) ?? undefined,
        newFringeRate: num(newFringe) ?? undefined,
        oldTotalRate: num(oldTotal) ?? undefined,
        newTotalRate: num(newTotal) ?? undefined,
        detectedAt: new Date(),
        acknowledgedAt: null,
        acknowledgedByUserId: null,
      } as any)
      .onConflictDoUpdate({
        target: [
          wageDecisionRateChanges.organizationId,
          wageDecisionRateChanges.decisionNumber,
          wageDecisionRateChanges.classification,
        ],
        // Latest refresh wins: refresh detection timestamp, refresh the
        // diff payload, and re-arm the badge by clearing any previous
        // acknowledgement.
        set: {
          changeKind: c.kind,
          oldBaseRate: num(oldBase) ?? null,
          newBaseRate: num(newBase) ?? null,
          oldFringeRate: num(oldFringe) ?? null,
          newFringeRate: num(newFringe) ?? null,
          oldTotalRate: num(oldTotal) ?? null,
          newTotalRate: num(newTotal) ?? null,
          detectedAt: new Date(),
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          updatedAt: new Date(),
        },
      });
  }

  // Delete any rows whose classification is not in the latest diff —
  // those classifications are now back in sync and the badge should clear.
  if (seenKeys.size > 0) {
    const keysList = Array.from(seenKeys);
    const inList = sql.join(keysList.map((k) => sql`${k}`), sql`, `);
    await db
      .delete(wageDecisionRateChanges)
      .where(
        and(
          eq(wageDecisionRateChanges.organizationId, organizationId),
          eq(wageDecisionRateChanges.decisionNumber, decision),
          sql`lower(trim(${wageDecisionRateChanges.classification})) NOT IN (${inList})`,
        ),
      );
  }

  // Task #1449 — Email the project manager of every project in this org
  // whose `wageDecision` references this decision number. The badge alone
  // only fires once a PM happens to open the prevailing wage panel, so a
  // PM who doesn't visit the panel may submit a certified payroll at the
  // old rate before noticing. Fanning a notification out from this exact
  // write point closes that gap; the email lists each affected
  // classification with old → new base/fringe/total numbers and deep-links
  // to the project's payroll tab. We dynamic-import the notifier to keep
  // this storage helper free of the wider notification module dependency
  // chain (which transitively imports back into davis-bacon code) and
  // wrap in try/catch so a notification failure can't roll back the
  // already-persisted panel-flag rows.
  try {
    const { notifyProjectManagersOnPersistedRateChanges } = await import(
      "../../../services/davisBaconAdminNotifications"
    );
    await notifyProjectManagersOnPersistedRateChanges({
      organizationId,
      decisionNumber: decision,
      changes: changes,
    });
  } catch (err) {
    logError(
      "Davis-Bacon PM rate-change email fan-out failed",
      { organizationId, decisionNumber: decision },
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

/**
 * Load the unacknowledged rate-change flags for a given (org, decision)
 * pair. Returns a Map keyed by normalized classification name so the
 * project prevailing-wage summary endpoint can do a fast lookup per
 * row regardless of whether the panel mapped the DOL feed name to a
 * differently-cased existing classification.
 */
export async function loadUnacknowledgedRateChanges(
  organizationId: string,
  decisionNumber: string,
): Promise<Map<string, WageDecisionRateChange>> {
  const decision = decisionNumber.trim();
  const out = new Map<string, WageDecisionRateChange>();
  if (!decision) return out;
  const rows = await db
    .select()
    .from(wageDecisionRateChanges)
    .where(
      and(
        eq(wageDecisionRateChanges.organizationId, organizationId),
        eq(wageDecisionRateChanges.decisionNumber, decision),
        isNull(wageDecisionRateChanges.acknowledgedAt),
      ),
    );
  for (const r of rows) {
    out.set(normalizeClassificationKey(r.classification), r);
  }
  return out;
}

/**
 * Task #1451 — load the most recent *acknowledged* rate-change record per
 * classification for a given (org, decision) pair. Returns a Map keyed by
 * normalized classification name so the project prevailing-wage summary
 * endpoint can surface "Acknowledged by X on Y" audit metadata next to
 * each row whose previous flag was cleared via PM acknowledgement.
 *
 * Because (organizationId, decisionNumber, classification) is unique,
 * there is at most one record per classification. A subsequent stale-
 * refresh that re-detects a change for the same classification overwrites
 * `acknowledgedAt`/`acknowledgedByUserId` back to NULL via the upsert in
 * `persistRateChangeRecords`, so any row returned here is genuinely the
 * latest acknowledgement (no stale audit info after a re-arm). Auto-
 * cleared flags (no-diff refresh) are deleted entirely, so they will
 * not appear here either.
 */
export async function loadAcknowledgedRateChanges(
  organizationId: string,
  decisionNumber: string,
): Promise<Map<string, WageDecisionRateChange>> {
  const decision = decisionNumber.trim();
  const out = new Map<string, WageDecisionRateChange>();
  if (!decision) return out;
  const rows = await db
    .select()
    .from(wageDecisionRateChanges)
    .where(
      and(
        eq(wageDecisionRateChanges.organizationId, organizationId),
        eq(wageDecisionRateChanges.decisionNumber, decision),
        isNotNull(wageDecisionRateChanges.acknowledgedAt),
      ),
    );
  for (const r of rows) {
    out.set(normalizeClassificationKey(r.classification), r);
  }
  return out;
}

/**
 * Acknowledge every unacknowledged rate-change flag for `(organizationId,
 * decisionNumber)`, optionally restricted to a specific list of
 * classifications. Returns the number of rows updated.
 */
export async function acknowledgeRateChanges(args: {
  organizationId: string;
  decisionNumber: string;
  userId: string;
  classifications?: ReadonlyArray<string>;
}): Promise<number> {
  const decision = args.decisionNumber.trim();
  if (!decision) return 0;

  const conditions = [
    eq(wageDecisionRateChanges.organizationId, args.organizationId),
    eq(wageDecisionRateChanges.decisionNumber, decision),
    isNull(wageDecisionRateChanges.acknowledgedAt),
  ];
  if (args.classifications && args.classifications.length > 0) {
    const keys = args.classifications.map(normalizeClassificationKey).filter(Boolean);
    if (keys.length === 0) return 0;
    const inList = sql.join(keys.map((k) => sql`${k}`), sql`, `);
    conditions.push(
      sql`lower(trim(${wageDecisionRateChanges.classification})) IN (${inList})`,
    );
  }

  const result = await db
    .update(wageDecisionRateChanges)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedByUserId: args.userId,
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning({ id: wageDecisionRateChanges.id });

  return result.length;
}
