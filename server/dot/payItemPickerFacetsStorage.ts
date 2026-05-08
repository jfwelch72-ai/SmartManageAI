// DOT pay-item picker facets storage — extracted from server/storage.ts
// during the Task #2672 retirement of the legacy storage monolith.
// Behavior parity; SQL and signatures unchanged.

import { db } from "../db";
import {
  dotPayItemPickerFacets,
  type DotPayItemPickerFacets,
} from "@shared/schema";
import { and, eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Task #1743 — DOT pay-item picker facet memory (per user × per spec book).
// Read/write helpers for the device-syncing replacement of the legacy
// `dot-pay-item-picker:facets:<uid>:<specBookId>` localStorage key.
// ---------------------------------------------------------------------------

export async function getDotPayItemPickerFacets(
  userId: string,
  specBookId: string,
): Promise<DotPayItemPickerFacets | null> {
  const [row] = await db
    .select()
    .from(dotPayItemPickerFacets)
    .where(and(
      eq(dotPayItemPickerFacets.userId, userId),
      eq(dotPayItemPickerFacets.specBookId, specBookId),
    ))
    .limit(1);
  return row ?? null;
}

export async function upsertDotPayItemPickerFacets(
  userId: string,
  specBookId: string,
  categories: string[],
  specSections: string[],
): Promise<DotPayItemPickerFacets | null> {
  // When both lists are empty we treat the row as "no preference" and delete
  // it so the table stays small and the next read returns null (matching the
  // "no localStorage entry yet" baseline the picker already handles). Return
  // null in that case to signal "no row" rather than fabricating a synthetic
  // one, so callers can't accidentally reuse a placeholder id.
  if (categories.length === 0 && specSections.length === 0) {
    await db
      .delete(dotPayItemPickerFacets)
      .where(and(
        eq(dotPayItemPickerFacets.userId, userId),
        eq(dotPayItemPickerFacets.specBookId, specBookId),
      ));
    return null;
  }
  const [row] = await db
    .insert(dotPayItemPickerFacets)
    .values({
      userId,
      specBookId,
      categories,
      specSections,
    })
    .onConflictDoUpdate({
      target: [dotPayItemPickerFacets.userId, dotPayItemPickerFacets.specBookId],
      set: {
        categories,
        specSections,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}
