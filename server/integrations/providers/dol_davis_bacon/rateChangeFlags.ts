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
import { and, eq, isNull, sql } from "drizzle-orm";
import type { WageRateDiffEntry } from "../../../services/davisBaconAdminNotifications";

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
