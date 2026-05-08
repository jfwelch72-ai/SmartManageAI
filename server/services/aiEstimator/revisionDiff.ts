// Task #2625 — Auto-takeoff revision diff engine.
//
// Pure functions that align two `MapReduceMeasurement[]` snapshots and
// return added / removed / changed entries grouped by discipline and
// sheet, with sheet-version awareness so the UI can flag rows whose
// citation set changed between plan-set revisions.

import type { MapReduceMeasurement } from "./mapReduceDraft";

export type DiffStatus = "ADDED" | "REMOVED" | "CHANGED" | "UNCHANGED";

export interface DiffEntry {
  /** Stable identity key (type|unit|costCode|normalizedLabel). */
  key: string;
  status: DiffStatus;
  label: string;
  type: string;
  unit: string;
  costCode: string | null;
  fromValue: number | null;
  toValue: number | null;
  delta: number | null;
  /** Pct change (toValue/fromValue - 1) * 100; null when fromValue is 0. */
  deltaPct: number | null;
  fromCitations: string[];
  toCitations: string[];
  contributingDisciplines: string[];
  /** When true, citations of this entry overlap a sheet that was added or removed across revisions. */
  affectedBySheetChange: boolean;
  fromIndex: number | null;
  toIndex: number | null;
  /** Set when this entry was paired with a fuzzy (label-similarity) match rather than an exact key match. */
  fuzzy?: boolean;
}

export interface SheetVersionDelta {
  addedSheetIds: string[];
  removedSheetIds: string[];
  addedSheetCitations: string[];
  removedSheetCitations: string[];
  /** Plan documents present in `to` but not in `from` (and vice versa). */
  addedPlanDocumentIds: string[];
  removedPlanDocumentIds: string[];
}

export interface RevisionDiffResult {
  entries: DiffEntry[];
  byDiscipline: Record<string, DiffEntry[]>;
  bySheet: Record<string, DiffEntry[]>;
  summary: {
    added: number;
    removed: number;
    changed: number;
    unchanged: number;
  };
  sheetVersion: SheetVersionDelta;
}

export interface PlanSetSnapshot {
  planDocuments?: Array<{ id: string; fileName?: string; updatedAt?: string }>;
  sheets?: Array<{
    id: string;
    planId?: string | null;
    sheetIndex?: number;
    sheetNumber?: string | null;
    sheetName?: string | null;
    discipline?: string | null;
    revisionLabel?: string | null;
  }>;
  hash?: string;
}

const QUANTITY_EQUALITY_EPS = 1e-6;
const FUZZY_LABEL_THRESHOLD = 0.65;

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeCostCode(c: string | null | undefined): string {
  return (c ?? "").trim().toUpperCase();
}

export function makeIdentityKey(m: {
  label: string;
  type: string;
  unit: string;
  costCode?: string | null;
}): string {
  return [
    (m.type || "").toUpperCase(),
    (m.unit || "").toUpperCase(),
    normalizeCostCode(m.costCode ?? null),
    normalizeLabel(m.label || ""),
  ].join("|");
}

/**
 * Stable signature combining identity (type|unit|cost|label) with the
 * sorted set of sheet citations + contributing disciplines. Two
 * instances of the same line item that came from different sheets are
 * considered DIFFERENT scopes for diff purposes (a slab in A-101 is a
 * different physical thing than a slab in A-201). Falling back to the
 * identity-only key after this lets the second pass align rows whose
 * citations changed across revisions but whose scope is otherwise the
 * same.
 */
export function makeScopeSignature(m: {
  label: string;
  type: string;
  unit: string;
  costCode?: string | null;
  sheetCitations?: string[];
  contributingDisciplines?: string[];
}): string {
  const cites = [...(m.sheetCitations ?? [])]
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
  const disc = [...(m.contributingDisciplines ?? [])]
    .map((d) => d.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");
  return `${makeIdentityKey(m)}::sheets=${cites}::disc=${disc}`;
}

/** Token-set Dice coefficient over normalized labels. */
function labelSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeLabel(a).split(/[^a-z0-9]+/).filter(Boolean));
  const tb = new Set(normalizeLabel(b).split(/[^a-z0-9]+/).filter(Boolean));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return (2 * inter) / (ta.size + tb.size);
}

/**
 * Compute the symmetric difference of plan-set snapshots between two
 * revisions. Used both to surface a "plan set changed" banner in the UI
 * and to flag individual diff entries whose citations overlap a
 * sheet that was added/removed across the two revisions.
 */
export function computeSheetVersionDelta(
  from: PlanSetSnapshot | null | undefined,
  to: PlanSetSnapshot | null | undefined,
): SheetVersionDelta {
  const fromSheets = new Map<string, NonNullable<PlanSetSnapshot["sheets"]>[number]>();
  const toSheets = new Map<string, NonNullable<PlanSetSnapshot["sheets"]>[number]>();
  for (const s of from?.sheets ?? []) fromSheets.set(s.id, s);
  for (const s of to?.sheets ?? []) toSheets.set(s.id, s);

  const addedSheetIds: string[] = [];
  const removedSheetIds: string[] = [];
  const addedSheetCitations: string[] = [];
  const removedSheetCitations: string[] = [];
  for (const [id, s] of toSheets) {
    if (!fromSheets.has(id)) {
      addedSheetIds.push(id);
      const cite = s.sheetNumber || s.sheetName;
      if (cite) addedSheetCitations.push(cite);
    }
  }
  for (const [id, s] of fromSheets) {
    if (!toSheets.has(id)) {
      removedSheetIds.push(id);
      const cite = s.sheetNumber || s.sheetName;
      if (cite) removedSheetCitations.push(cite);
    }
  }

  const fromDocs = new Set((from?.planDocuments ?? []).map((d) => d.id));
  const toDocs = new Set((to?.planDocuments ?? []).map((d) => d.id));
  const addedPlanDocumentIds: string[] = [];
  const removedPlanDocumentIds: string[] = [];
  for (const id of toDocs) if (!fromDocs.has(id)) addedPlanDocumentIds.push(id);
  for (const id of fromDocs) if (!toDocs.has(id)) removedPlanDocumentIds.push(id);

  return {
    addedSheetIds,
    removedSheetIds,
    addedSheetCitations,
    removedSheetCitations,
    addedPlanDocumentIds,
    removedPlanDocumentIds,
  };
}

function citationsOverlap(citations: string[], changedCites: string[]): boolean {
  if (changedCites.length === 0 || citations.length === 0) return false;
  const norm = new Set(changedCites.map((c) => c.trim().toLowerCase()));
  for (const c of citations) {
    if (norm.has(c.trim().toLowerCase())) return true;
  }
  return false;
}

/**
 * Diff two takeoff revisions. The algorithm:
 *   1. Index `from` rows by identity key and try exact matches first.
 *   2. For unmatched `to` rows, attempt a fuzzy pass within the same
 *      (type, unit, costCode) bucket using token-set similarity over
 *      normalized labels. Above `FUZZY_LABEL_THRESHOLD` we treat them
 *      as the same line item with an updated label.
 *   3. Anything still unmatched is ADDED (in `to`) or REMOVED (in `from`).
 *   4. Matched pairs are CHANGED when value/unit differ outside epsilon,
 *      otherwise UNCHANGED.
 */
export function diffRevisions(
  from: { measurements: MapReduceMeasurement[]; planSetVersion?: PlanSetSnapshot | null },
  to: { measurements: MapReduceMeasurement[]; planSetVersion?: PlanSetSnapshot | null },
): RevisionDiffResult {
  const sheetVersion = computeSheetVersionDelta(from.planSetVersion ?? null, to.planSetVersion ?? null);
  const changedCitations = [
    ...sheetVersion.addedSheetCitations,
    ...sheetVersion.removedSheetCitations,
  ];

  // Index by scope signature first (identity + sorted sheet citations +
  // disciplines) and FALL BACK to identity-only key. This preserves
  // duplicates (same label + unit + cost on multiple sheets is a real
  // pattern in plan sets) and treats two emissions on different sheets
  // as distinct scopes during the strict-match phase. Items left over
  // after Phase 1 fall through to a label-similarity fuzzy pass.
  type Slot = { item: MapReduceMeasurement; index: number; identityKey: string };
  const fromBuckets = new Map<string, Slot[]>();
  const toBuckets = new Map<string, Slot[]>();
  const fromIdentityBuckets = new Map<string, Slot[]>();
  const toIdentityBuckets = new Map<string, Slot[]>();
  const usedFromIndices = new Set<number>();
  const usedToIndices = new Set<number>();

  from.measurements.forEach((m, i) => {
    const slot: Slot = { item: m, index: i, identityKey: makeIdentityKey(m) };
    (fromBuckets.get(makeScopeSignature(m)) ?? fromBuckets.set(makeScopeSignature(m), []).get(makeScopeSignature(m))!).push(slot);
    (fromIdentityBuckets.get(slot.identityKey) ?? fromIdentityBuckets.set(slot.identityKey, []).get(slot.identityKey)!).push(slot);
  });
  to.measurements.forEach((m, i) => {
    const slot: Slot = { item: m, index: i, identityKey: makeIdentityKey(m) };
    (toBuckets.get(makeScopeSignature(m)) ?? toBuckets.set(makeScopeSignature(m), []).get(makeScopeSignature(m))!).push(slot);
    (toIdentityBuckets.get(slot.identityKey) ?? toIdentityBuckets.set(slot.identityKey, []).get(slot.identityKey)!).push(slot);
  });

  const entries: DiffEntry[] = [];

  // Phase 1a — strict scope-signature match (identity + same sheet set).
  for (const [sig, toSlots] of toBuckets) {
    const fromSlots = fromBuckets.get(sig);
    if (!fromSlots || fromSlots.length === 0) continue;
    const pairs = Math.min(toSlots.length, fromSlots.length);
    for (let i = 0; i < pairs; i++) {
      const t = toSlots[i]!;
      const f = fromSlots[i]!;
      if (usedFromIndices.has(f.index) || usedToIndices.has(t.index)) continue;
      usedFromIndices.add(f.index);
      usedToIndices.add(t.index);
      entries.push(buildEntry(t.identityKey, f.item, t.item, f.index, t.index, false, changedCitations));
    }
  }

  // Phase 1b — identity-only fallback (citations changed but identity same).
  for (const [k, toSlots] of toIdentityBuckets) {
    const remainingTo = toSlots.filter((s) => !usedToIndices.has(s.index));
    if (remainingTo.length === 0) continue;
    const fromSlots = (fromIdentityBuckets.get(k) ?? []).filter((s) => !usedFromIndices.has(s.index));
    if (fromSlots.length === 0) continue;
    const pairs = Math.min(remainingTo.length, fromSlots.length);
    for (let i = 0; i < pairs; i++) {
      const t = remainingTo[i]!;
      const f = fromSlots[i]!;
      usedFromIndices.add(f.index);
      usedToIndices.add(t.index);
      entries.push(buildEntry(t.identityKey, f.item, t.item, f.index, t.index, false, changedCitations));
    }
  }

  // Phase 2 — fuzzy match (unmatched-to vs unmatched-from within same type|unit|cost bucket).
  const unmatchedFrom: Array<{ key: string; item: MapReduceMeasurement; index: number }> = [];
  from.measurements.forEach((m, i) => {
    if (!usedFromIndices.has(i)) unmatchedFrom.push({ key: makeIdentityKey(m), item: m, index: i });
  });
  const unmatchedTo: Array<{ key: string; item: MapReduceMeasurement; index: number }> = [];
  to.measurements.forEach((m, i) => {
    if (!usedToIndices.has(i)) unmatchedTo.push({ key: makeIdentityKey(m), item: m, index: i });
  });

  for (const t of unmatchedTo) {
    let bestIdx = -1;
    let bestScore = FUZZY_LABEL_THRESHOLD;
    for (let i = 0; i < unmatchedFrom.length; i++) {
      const f = unmatchedFrom[i]!;
      if ((f.item.type || "").toUpperCase() !== (t.item.type || "").toUpperCase()) continue;
      if ((f.item.unit || "").toUpperCase() !== (t.item.unit || "").toUpperCase()) continue;
      if (normalizeCostCode(f.item.costCode) !== normalizeCostCode(t.item.costCode)) continue;
      const s = labelSimilarity(f.item.label, t.item.label);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) {
      const f = unmatchedFrom.splice(bestIdx, 1)[0]!;
      usedFromIndices.add(f.index);
      usedToIndices.add(t.index);
      entries.push(buildEntry(t.key, f.item, t.item, f.index, t.index, true, changedCitations));
    }
  }

  // Phase 3 — leftovers are pure adds / removes.
  for (const t of unmatchedTo) {
    if (usedToIndices.has(t.index)) continue;
    entries.push({
      key: t.key,
      status: "ADDED",
      label: t.item.label,
      type: t.item.type,
      unit: t.item.unit,
      costCode: t.item.costCode ?? null,
      fromValue: null,
      toValue: t.item.value,
      delta: t.item.value,
      deltaPct: null,
      fromCitations: [],
      toCitations: t.item.sheetCitations ?? [],
      contributingDisciplines: t.item.contributingDisciplines ?? [],
      affectedBySheetChange: citationsOverlap(t.item.sheetCitations ?? [], changedCitations),
      fromIndex: null,
      toIndex: t.index,
    });
  }
  for (const f of unmatchedFrom) {
    if (usedFromIndices.has(f.index)) continue;
    entries.push({
      key: f.key,
      status: "REMOVED",
      label: f.item.label,
      type: f.item.type,
      unit: f.item.unit,
      costCode: f.item.costCode ?? null,
      fromValue: f.item.value,
      toValue: null,
      delta: -f.item.value,
      deltaPct: null,
      fromCitations: f.item.sheetCitations ?? [],
      toCitations: [],
      contributingDisciplines: f.item.contributingDisciplines ?? [],
      affectedBySheetChange: citationsOverlap(f.item.sheetCitations ?? [], changedCitations),
      fromIndex: f.index,
      toIndex: null,
    });
  }

  // Group helpers.
  const byDiscipline: Record<string, DiffEntry[]> = {};
  const bySheet: Record<string, DiffEntry[]> = {};
  let added = 0, removed = 0, changed = 0, unchanged = 0;
  for (const e of entries) {
    if (e.status === "ADDED") added += 1;
    else if (e.status === "REMOVED") removed += 1;
    else if (e.status === "CHANGED") changed += 1;
    else unchanged += 1;
    const disciplines = e.contributingDisciplines.length > 0 ? e.contributingDisciplines : ["O"];
    for (const d of disciplines) {
      (byDiscipline[d] ||= []).push(e);
    }
    const cites = new Set([...e.fromCitations, ...e.toCitations]);
    if (cites.size === 0) {
      (bySheet["(unknown)"] ||= []).push(e);
    } else {
      for (const c of cites) (bySheet[c] ||= []).push(e);
    }
  }

  return {
    entries,
    byDiscipline,
    bySheet,
    summary: { added, removed, changed, unchanged },
    sheetVersion,
  };
}

function buildEntry(
  key: string,
  fromItem: MapReduceMeasurement,
  toItem: MapReduceMeasurement,
  fromIndex: number,
  toIndex: number,
  fuzzy: boolean,
  changedCitations: string[],
): DiffEntry {
  const same = Math.abs(toItem.value - fromItem.value) <= QUANTITY_EQUALITY_EPS;
  const fromCit = fromItem.sheetCitations ?? [];
  const toCit = toItem.sheetCitations ?? [];
  const allCit = [...fromCit, ...toCit];
  const contributing = Array.from(
    new Set([...(fromItem.contributingDisciplines ?? []), ...(toItem.contributingDisciplines ?? [])]),
  );
  return {
    key,
    status: same ? "UNCHANGED" : "CHANGED",
    label: toItem.label || fromItem.label,
    type: toItem.type,
    unit: toItem.unit,
    costCode: toItem.costCode ?? fromItem.costCode ?? null,
    fromValue: fromItem.value,
    toValue: toItem.value,
    delta: toItem.value - fromItem.value,
    deltaPct: fromItem.value !== 0 ? ((toItem.value - fromItem.value) / fromItem.value) * 100 : null,
    fromCitations: fromCit,
    toCitations: toCit,
    contributingDisciplines: contributing,
    affectedBySheetChange: citationsOverlap(allCit, changedCitations),
    fromIndex,
    toIndex,
    fuzzy: fuzzy || undefined,
  };
}
