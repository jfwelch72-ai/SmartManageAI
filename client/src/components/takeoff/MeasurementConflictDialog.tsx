import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TakeoffMeasurement } from "@shared/schema";

// Task #2652 — Side-by-side conflict resolution dialog. The legacy
// dialog (added in Task #2629) just dumped the two raw JSON blobs and
// gave the user a binary "keep theirs / overwrite" choice. This
// component:
//   * Shows only the human-meaningful fields the user might actually
//     have changed (label, category, group, cost code, unit cost,
//     line style/width, points, metadata).
//   * For every field that differs, shows the teammate's saved value
//     next to the user's pending value with a per-field radio (their
//     value / your value) so the user can hand-merge.
//   * Surfaces the teammate's display name (looked up server-side
//     from the most recent UPDATE row in `audit_log` for the
//     measurement) so the user knows who they're merging with.
//   * Keeps the original "Keep theirs" (dismiss) and "Keep mine"
//     (overwrite) shortcuts so the common cases stay one click.

export interface MeasurementConflict {
  measurementId: string;
  pendingEdit: Record<string, unknown>;
  serverRow: TakeoffMeasurement | null;
  currentVersion: number | null;
  lastEditor: { id: string; firstName: string | null; lastName: string | null; editedAt: string } | null;
}

interface Props {
  conflict: MeasurementConflict;
  onDismiss: () => void;
  onApply: (mergedEdit: Record<string, unknown>) => void;
}

type Choice = "theirs" | "mine";

// Friendly labels for the fields users commonly edit through the
// properties panel. Any key NOT in this map is still rendered — it
// just falls back to the raw column name. Built dynamically rather
// than as a whitelist so a future PATCH-able column (e.g. `note`,
// `color`, `depthFeet`, `pitchRatio`, `assemblyId`) automatically
// appears in the diff instead of being silently dropped from the
// merge payload.
const FIELD_LABELS: Record<string, string> = {
  label: "Label",
  categoryId: "Category",
  groupId: "Group",
  costCodeId: "Cost code",
  unitCost: "Unit cost",
  lineStyle: "Line style",
  lineWidth: "Line width",
  points: "Points",
  metadata: "Metadata",
  note: "Note",
  color: "Color",
  depthFeet: "Depth (ft)",
  pitchRatio: "Pitch",
  type: "Type",
  assemblyId: "Assembly",
  assemblyComponentId: "Assembly component",
  lineItemRef: "Line item",
  locationId: "Location",
  locationTag: "Location tag",
  subcontractorId: "Subcontractor",
  supplierId: "Supplier",
  scopeTag: "Scope",
  changeOrderId: "Change order",
  visible: "Visible",
  count: "Count",
  arcData: "Arc data",
  deductions: "Deductions",
  installationStatus: "Installation status",
  installedQuantity: "Installed quantity",
};

// Mutation-control keys passed through `pendingEdit` that aren't
// real measurement columns and must NOT be surfaced as diff rows.
// `id` / `previous` / `skipHistory` are stripped by the hook before
// `pendingEdit` lands here, but `expectedVersion` / `forceOverwrite`
// are PATCH-body keys the mutation also adds, so we filter defensively.
const CONTROL_KEYS = new Set([
  "id",
  "skipHistory",
  "previous",
  "expectedVersion",
  "forceOverwrite",
]);

function humanizeKey(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  // Fall back to a Title Case from camelCase / snake_case so an
  // unmapped column (e.g. a future addition) reads as "My New Field"
  // instead of "myNewField".
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") {
    // Truncate long JSON-ish strings so the dialog stays compact.
    return value.length > 120 ? `${value.slice(0, 120)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const s = JSON.stringify(value);
    return s.length > 120 ? `${s.slice(0, 120)}…` : s;
  } catch {
    return String(value);
  }
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" && typeof b === "number") return a === b;
  // Treat coercible numerics (e.g. "12.5" vs 12.5) as equal so the
  // dialog doesn't flag spurious diffs from JSON parse round-trips.
  if ((typeof a === "string" || typeof a === "number") && (typeof b === "string" || typeof b === "number")) {
    return String(a) === String(b);
  }
  return false;
}

export function MeasurementConflictDialog({ conflict, onDismiss, onApply }: Props) {
  const teammateName = useMemo(() => {
    const e = conflict.lastEditor;
    if (!e) return "Another teammate";
    const name = [e.firstName, e.lastName].filter(Boolean).join(" ").trim();
    return name.length > 0 ? name : "Another teammate";
  }, [conflict.lastEditor]);

  const editedAtLabel = useMemo(() => {
    const e = conflict.lastEditor;
    if (!e?.editedAt) return null;
    try {
      return new Date(e.editedAt).toLocaleString();
    } catch {
      return null;
    }
  }, [conflict.lastEditor]);

  const fieldRows = useMemo(() => {
    const server = (conflict.serverRow ?? {}) as Record<string, unknown>;
    const pending = (conflict.pendingEdit ?? {}) as Record<string, unknown>;
    // Build rows dynamically from EVERY key the user actually
    // included in the pending edit (minus mutation control keys).
    // This way fields outside the friendly-label map (e.g. a future
    // PATCH-able column) still appear in the diff and still land in
    // the merged payload — earlier versions whitelisted a fixed
    // FIELD_DEFS list and silently dropped everything else, which
    // could cause "keep mine" to lose a `note` / `color` / `type`
    // edit on its way back to the server.
    return Object.keys(pending)
      .filter((key) => !CONTROL_KEYS.has(key))
      .map((key) => ({
        key,
        label: humanizeKey(key),
        theirs: server[key],
        mine: pending[key],
        differs: !valuesEqual(server[key], pending[key]),
      }));
  }, [conflict.pendingEdit, conflict.serverRow]);

  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    // Default each diffed field to "mine" so a user clicking Apply
    // without touching anything reproduces the legacy "overwrite"
    // behavior — but only for fields they actually edited.
    const out: Record<string, Choice> = {};
    for (const row of fieldRows) {
      if (row.differs) out[row.key] = "mine";
    }
    return out;
  });

  const setChoice = (key: string, c: Choice) =>
    setChoices((prev) => ({ ...prev, [key]: c }));

  const handleApply = () => {
    // Build the merged PATCH body: for each diffed field include the
    // chosen value (server value or user's pending value); for
    // fields the user edited but that did NOT differ we still echo
    // the user's value (no-op on the server). Non-edited fields stay
    // out of the body so the server keeps its current row values.
    const merged: Record<string, unknown> = {};
    for (const row of fieldRows) {
      if (!row.differs) {
        merged[row.key] = row.mine;
        continue;
      }
      const choice = choices[row.key] ?? "mine";
      merged[row.key] = choice === "theirs" ? row.theirs : row.mine;
    }
    onApply(merged);
  };

  const diffCount = fieldRows.filter((r) => r.differs).length;
  const allMine = diffCount > 0 && fieldRows.every((r) => !r.differs || choices[r.key] === "mine");
  const allTheirs = diffCount > 0 && fieldRows.every((r) => !r.differs || choices[r.key] === "theirs");

  return (
    <Dialog open onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="max-w-2xl" data-testid="dialog-measurement-conflict">
        <DialogHeader>
          <DialogTitle>Edit conflict</DialogTitle>
          <DialogDescription>
            <span data-testid="text-conflict-editor-name">{teammateName}</span>
            {" saved a change to this measurement before yours could go through."}
            {editedAtLabel && (
              <span className="text-muted-foreground"> ({editedAtLabel})</span>
            )}
            {" Pick which value to keep for each field, or use the shortcuts below."}
          </DialogDescription>
        </DialogHeader>

        {diffCount === 0 ? (
          <div
            className="text-sm text-muted-foreground py-4"
            data-testid="text-conflict-no-diff"
          >
            Your edit no longer conflicts with the saved version. You can apply
            it as-is or dismiss to keep the saved value.
          </div>
        ) : (
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
            {fieldRows.map((row) => (
              <div
                key={row.key}
                className="rounded border border-border p-3"
                data-testid={`row-conflict-field-${row.key}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-semibold">{row.label}</div>
                  {row.differs ? (
                    <Badge variant="destructive" className="text-[10px]">
                      Differs
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      Same
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label
                    className={`flex items-start gap-2 rounded p-2 text-xs cursor-pointer border ${
                      !row.differs
                        ? "border-border bg-muted/30"
                        : (choices[row.key] ?? "mine") === "theirs"
                          ? "border-primary bg-primary/5"
                          : "border-border"
                    }`}
                    data-testid={`label-conflict-theirs-${row.key}`}
                  >
                    <input
                      type="radio"
                      name={`conflict-${row.key}`}
                      checked={(choices[row.key] ?? "mine") === "theirs"}
                      disabled={!row.differs}
                      onChange={() => setChoice(row.key, "theirs")}
                      data-testid={`radio-conflict-theirs-${row.key}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Their value</div>
                      <div
                        className="font-mono break-all text-muted-foreground"
                        data-testid={`text-conflict-theirs-${row.key}`}
                      >
                        {formatValue(row.theirs)}
                      </div>
                    </div>
                  </label>
                  <label
                    className={`flex items-start gap-2 rounded p-2 text-xs cursor-pointer border ${
                      !row.differs
                        ? "border-border bg-muted/30"
                        : (choices[row.key] ?? "mine") === "mine"
                          ? "border-primary bg-primary/5"
                          : "border-border"
                    }`}
                    data-testid={`label-conflict-mine-${row.key}`}
                  >
                    <input
                      type="radio"
                      name={`conflict-${row.key}`}
                      checked={(choices[row.key] ?? "mine") === "mine"}
                      disabled={!row.differs}
                      onChange={() => setChoice(row.key, "mine")}
                      data-testid={`radio-conflict-mine-${row.key}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">Your value</div>
                      <div
                        className="font-mono break-all text-muted-foreground"
                        data-testid={`text-conflict-mine-${row.key}`}
                      >
                        {formatValue(row.mine)}
                      </div>
                    </div>
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
          <div className="flex gap-2 mr-auto">
            <Button
              variant="ghost"
              size="sm"
              disabled={diffCount === 0 || allTheirs}
              onClick={() => {
                const next: Record<string, Choice> = { ...choices };
                for (const r of fieldRows) if (r.differs) next[r.key] = "theirs";
                setChoices(next);
              }}
              data-testid="button-conflict-select-all-theirs"
            >
              Select all theirs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={diffCount === 0 || allMine}
              onClick={() => {
                const next: Record<string, Choice> = { ...choices };
                for (const r of fieldRows) if (r.differs) next[r.key] = "mine";
                setChoices(next);
              }}
              data-testid="button-conflict-select-all-mine"
            >
              Select all mine
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={onDismiss}
            data-testid="button-conflict-keep-theirs"
          >
            Keep theirs
          </Button>
          <Button
            onClick={handleApply}
            data-testid="button-conflict-apply"
          >
            Apply merge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
