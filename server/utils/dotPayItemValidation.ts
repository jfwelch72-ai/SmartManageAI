import { db } from "../db";
import { dotPayItems } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface DotPayItemFields {
  dotPayItemId?: string | null;
  dotSpecBookId?: string | null;
  payItemNumber?: string | null;
  specSection?: string | null;
}

export type DotValidationResult =
  | { ok: true; canonical: DotPayItemFields }
  | { ok: false; error: string };

/**
 * Validates and canonicalizes DOT pay-item linkage on a record.
 *
 * Rules:
 *  - If `dotPayItemId` is absent, the other DOT fields must also be absent.
 *  - If `dotPayItemId` is present, the row must exist in `dot_pay_items`.
 *  - Any provided `payItemNumber`, `dotSpecBookId`, or `specSection` must
 *    match the canonical record; mismatches are rejected.
 *  - On success, the returned `canonical` object overwrites all four fields
 *    with the canonical values from `dot_pay_items` (specSection falls back
 *    to the caller's value if the spec book has none).
 *
 * Mutates `data` in place when successful so callers using the same record
 * downstream pick up the canonical values automatically.
 */
export async function validateDotPayItemLink(
  data: DotPayItemFields,
): Promise<DotValidationResult> {
  const id = data?.dotPayItemId ?? null;

  if (!id) {
    if (data?.payItemNumber || data?.specSection || data?.dotSpecBookId) {
      return {
        ok: false,
        error:
          "payItemNumber/specSection/dotSpecBookId require dotPayItemId for canonical resolution",
      };
    }
    return { ok: true, canonical: { dotPayItemId: null, dotSpecBookId: null, payItemNumber: null, specSection: null } };
  }

  const [row] = await db
    .select({
      id: dotPayItems.id,
      itemNumber: dotPayItems.itemNumber,
      specBookId: dotPayItems.specBookId,
      specSection: dotPayItems.specSection,
    })
    .from(dotPayItems)
    .where(eq(dotPayItems.id, id))
    .limit(1);

  if (!row) {
    return { ok: false, error: `Unknown DOT pay item: ${id}` };
  }

  if (data.payItemNumber && data.payItemNumber !== row.itemNumber) {
    return {
      ok: false,
      error: `payItemNumber "${data.payItemNumber}" does not match DOT pay item record (expected "${row.itemNumber}")`,
    };
  }
  if (data.dotSpecBookId && data.dotSpecBookId !== row.specBookId) {
    return {
      ok: false,
      error: `dotSpecBookId does not match the spec book of the selected pay item`,
    };
  }
  if (data.specSection && row.specSection && data.specSection !== row.specSection) {
    return {
      ok: false,
      error: `specSection "${data.specSection}" does not match DOT pay item record (expected "${row.specSection}")`,
    };
  }

  const canonical: DotPayItemFields = {
    dotPayItemId: row.id,
    dotSpecBookId: row.specBookId,
    payItemNumber: row.itemNumber,
    specSection: row.specSection ?? data.specSection ?? null,
  };

  // Mutate caller's record so downstream consumers see canonical values.
  data.dotPayItemId = canonical.dotPayItemId ?? null;
  data.dotSpecBookId = canonical.dotSpecBookId ?? null;
  data.payItemNumber = canonical.payItemNumber ?? null;
  data.specSection = canonical.specSection ?? null;

  return { ok: true, canonical };
}
