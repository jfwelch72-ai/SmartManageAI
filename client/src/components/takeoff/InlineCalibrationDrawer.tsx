import { useEffect, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Ruler, MousePointer, Plus, X, ExternalLink } from "lucide-react";
import {
  parseTypedDimension,
  type DefaultUnits,
} from "@/lib/takeoffTypedInput";
import { cn } from "@/lib/utils";

/**
 * Task #2140 — Inline calibration drawer (Section 5 of
 * `docs/takeoff-interaction-map.md`).
 *
 * `T` opens this side-anchored panel so the user can pick two
 * reference points on the canvas (the canvas stays interactive
 * because the drawer is rendered via Radix Dialog with `modal={false}`
 * and **no overlay** — pointer events on the canvas pass through
 * untouched) and type the real-world distance using the Section 4
 * grammar. The drawer also exposes:
 *   • multi-region capture (kept for parity with the existing flow
 *     in `TakeoffSidebar`),
 *   • a feature-flagged "Apply to entire Sheet Set" checkbox that's
 *     intentionally disabled until the Sheet Sets task ships,
 *   • a "Use Standard Scale" link that hands off to the existing
 *     `PlanScaleModal` (preserves muscle memory for users who don't
 *     want to draw a calibration line at all).
 *
 * Why bypass the shared `<SheetContent>`: the standard shadcn sheet
 * always renders a full-screen `SheetOverlay` that intercepts every
 * pointer event below z-index 10000. That breaks the core
 * "click-while-drawer-is-open" workflow the calibration flow needs.
 * We render the panel directly via Radix primitives instead.
 */

export interface InlineCalibrationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current calibration mode driven by the canvas click handler in
   *  `use-takeoff-interactions.ts`. */
  calibrationMode: "idle" | "first-point" | "second-point";
  setCalibrationMode: (m: "idle" | "first-point" | "second-point") => void;
  calibrationPoints: { x: number; y: number }[];
  setCalibrationPoints: (pts: { x: number; y: number }[]) => void;
  calibrationDistance: string;
  setCalibrationDistance: (v: string) => void;
  units: DefaultUnits;
  setUnits: (u: DefaultUnits) => void;
  currentScalePxPerFoot: number | null;
  /** Save handler — calls into the existing `handleSaveCalibration`
   *  which PATCHes the sheet's calibration endpoint. Receives the
   *  parsed numeric distance (always in feet) directly so the parent
   *  doesn't have to read it back from React state — that would race
   *  the upstream `setCalibrationDistance` call below. */
  onSaveCalibration: (distanceFt?: number) => void | Promise<void>;
  /** Open the existing PlanScaleModal so the user can pick a known
   *  ratio (e.g. 1/4" = 1'-0") instead of drawing a calibration. */
  onUseStandardScale: () => void;
  /** Multi-region calib state piped through so existing usage
   *  (TakeoffSidebar) stays in sync. */
  multiCalibMode: boolean;
  setMultiCalibMode: (v: boolean) => void;
  multiCalibPoints: Array<{
    points: [{ x: number; y: number }, { x: number; y: number }];
    distance: number;
    /** Optional human-readable name for the region (e.g.
     *  "Foundation detail", "Roof inset"). Saved into the region
     *  payload when present so callers downstream can label scaled
     *  sub-areas distinctly. */
    label?: string;
  }>;
  setMultiCalibPoints: (
    v: Array<{
      points: [{ x: number; y: number }, { x: number; y: number }];
      distance: number;
      label?: string;
    }>,
  ) => void;
  /** Task #2141 — Active Sheet Set context. When non-null, the
   *  "Apply to entire Sheet Set" checkbox enables and clicking Save
   *  routes the calibrated scale through `onApplyToSheetSet` (which
   *  calls the apply-scale endpoint and toasts an Undo affordance)
   *  instead of the normal per-sheet save path. */
  activeSheetSet?: { id: string; name: string; memberCount: number } | null;
  onApplyToSheetSet?: (input: {
    setId: string;
    scalePxPerFoot: number;
  }) => void | Promise<void>;
  /** Task #2141 — Pre-checks "Apply to entire Sheet Set" when the
   *  drawer was opened from a per-set scale chip in the Sheet Sets
   *  panel. The user can still uncheck before saving. */
  defaultApplyToSheetSet?: boolean;
}

const APPLY_TO_SHEET_SET_TOOLTIP_DISABLED =
  "Activate a Sheet Set in the Sheet Sets panel to apply this calibration to every member sheet at once.";
const APPLY_TO_SHEET_SET_TOOLTIP_ENABLED =
  "Saves the calibrated scale to every sheet in the active Sheet Set in one go. Undo is offered in the toast.";

const M_TO_FT = 3.28083989501312;

function pixelDistance(
  a: { x: number; y: number },
  b: { x: number; y: number },
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function InlineCalibrationDrawer(props: InlineCalibrationDrawerProps) {
  const {
    open,
    onOpenChange,
    calibrationMode,
    setCalibrationMode,
    calibrationPoints,
    setCalibrationPoints,
    calibrationDistance,
    setCalibrationDistance,
    units,
    setUnits,
    currentScalePxPerFoot,
    onSaveCalibration,
    onUseStandardScale,
    multiCalibMode,
    multiCalibPoints,
    setMultiCalibPoints,
    activeSheetSet,
    onApplyToSheetSet,
    defaultApplyToSheetSet,
  } = props;
  // `setMultiCalibMode` is part of the props contract for parity
  // with the existing TakeoffSidebar wiring, but the drawer itself
  // never toggles the mode internally — the sidebar is the source
  // of truth. We accept it via `props` and don't destructure it.

  // Local input state for live typed-grammar parsing — mirrored to
  // the upstream `calibrationDistance` only when the user commits
  // (Enter / Save) so a half-typed `12'` doesn't fail validation
  // mid-keystroke.
  const [draftDistance, setDraftDistance] = useState(calibrationDistance);
  const [draftRegionLabel, setDraftRegionLabel] = useState("");
  // Task #2141 — "Apply to entire Sheet Set". The checkbox enables
  // when an active Sheet Set is propagated through `activeSheetSet`
  // and the parent provides a `onApplyToSheetSet` callback. The
  // legacy hard-coded `sheetSetFlagOn = false` is gone; the feature
  // gate is now "is there an active set?".
  const [applyToSheetSet, setApplyToSheetSet] = useState(
    !!defaultApplyToSheetSet,
  );
  const sheetSetFlagOn = !!activeSheetSet && !!onApplyToSheetSet;
  // Re-sync when the parent flips the default on (e.g. user clicked
  // a per-set scale chip while the drawer was already open).
  useEffect(() => {
    if (defaultApplyToSheetSet && sheetSetFlagOn) {
      setApplyToSheetSet(true);
    }
  }, [defaultApplyToSheetSet, sheetSetFlagOn]);
  // Auto-uncheck when the active set goes away (e.g. user
  // deactivates the set in the panel mid-flow) so we never silently
  // submit an obsolete propagation request.
  useEffect(() => {
    if (!sheetSetFlagOn && applyToSheetSet) setApplyToSheetSet(false);
  }, [sheetSetFlagOn, applyToSheetSet]);

  useEffect(() => {
    setDraftDistance(calibrationDistance);
  }, [calibrationDistance]);

  // Whenever the drawer opens with no captured points, kick off the
  // first-point capture immediately so the user can just click on
  // the canvas without an extra "Start" step.
  useEffect(() => {
    if (!open) return;
    if (calibrationMode === "idle" && calibrationPoints.length === 0) {
      setCalibrationMode("first-point");
    }
  }, [open, calibrationMode, calibrationPoints.length, setCalibrationMode]);

  const parsed = parseTypedDimension(draftDistance, units);
  const draftLengthFt = parsed.ok
    ? parsed.value.kind === "length"
      ? parsed.value.lengthFt
      : parsed.value.kind === "length-angle"
        ? parsed.value.lengthFt
        : null
    : null;
  const distanceValid = draftLengthFt !== null && draftLengthFt > 0;

  const previewScale = (() => {
    if (
      calibrationPoints.length !== 2 ||
      draftLengthFt === null ||
      draftLengthFt <= 0
    )
      return null;
    const px = pixelDistance(calibrationPoints[0], calibrationPoints[1]);
    if (px <= 0) return null;
    return px / draftLengthFt;
  })();

  const handleSave = async () => {
    if (!parsed.ok || draftLengthFt === null) return;
    // Mirror the typed value into the upstream display state so
    // legacy widgets that still read `calibrationDistance` show the
    // committed number — but DON'T rely on that React state being
    // visible by the time `onSaveCalibration` runs (it races the
    // useCallback closure on the parent). Pass the parsed feet value
    // through as the source of truth.
    const display =
      units === "m"
        ? (draftLengthFt / M_TO_FT).toString()
        : draftLengthFt.toString();
    setCalibrationDistance(display);
    // Task #2141 — Save the per-sheet calibration first (so the
    // currently-open sheet's own scalePxPerFoot still reflects the
    // exact two-point pickup geometry), then fan the resolved scale
    // out to the rest of the active Sheet Set if the user opted in.
    await onSaveCalibration(draftLengthFt);
    if (
      applyToSheetSet &&
      sheetSetFlagOn &&
      activeSheetSet &&
      onApplyToSheetSet &&
      calibrationPoints.length === 2
    ) {
      const px = pixelDistance(calibrationPoints[0], calibrationPoints[1]);
      if (px > 0) {
        await onApplyToSheetSet({
          setId: activeSheetSet.id,
          scalePxPerFoot: px / draftLengthFt,
        });
      }
    }
  };

  const handleResetPoints = () => {
    setCalibrationPoints([]);
    setCalibrationMode("first-point");
  };

  const handleAddRegion = () => {
    if (calibrationPoints.length !== 2 || draftLengthFt === null) return;
    const trimmedLabel = draftRegionLabel.trim();
    const region: {
      points: [{ x: number; y: number }, { x: number; y: number }];
      distance: number;
      label?: string;
    } = {
      points: [calibrationPoints[0], calibrationPoints[1]] as [
        { x: number; y: number },
        { x: number; y: number },
      ],
      distance: draftLengthFt,
    };
    if (trimmedLabel.length > 0) region.label = trimmedLabel;
    setMultiCalibPoints([...multiCalibPoints, region]);
    setCalibrationPoints([]);
    setCalibrationMode("first-point");
    setDraftDistance("");
    setDraftRegionLabel("");
  };

  const stepText = (() => {
    if (calibrationPoints.length === 0) return "Click the first reference point on the sheet.";
    if (calibrationPoints.length === 1) return "Click the second reference point.";
    return "Type the real-world distance, then Save.";
  })();

  return (
    // `modal={false}` is the key here: it disables Radix's focus
    // trap, body pointer-events lockdown, and scroll lock. We also
    // skip rendering an overlay entirely so canvas clicks pass
    // straight through to Konva. The user can still pick reference
    // points while the drawer is open.
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          data-testid="inline-calibration-drawer"
          className={cn(
            "fixed inset-y-0 right-0 z-[10000] h-full w-[380px] sm:max-w-[420px]",
            "bg-background border-l shadow-lg p-6 flex flex-col gap-4",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "data-[state=closed]:duration-300 data-[state=open]:duration-500",
            "transition ease-in-out",
          )}
          // Critical for the "click canvas while drawer open" flow:
          // do NOT close on outside interaction, and do NOT swallow
          // those events from the canvas. Without these handlers the
          // first canvas click after opening the drawer would be
          // routed through Radix's outside-click logic.
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          // Prevent the default focus-on-open behavior so the canvas
          // keeps focus and stays clickable.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Ruler className="w-4 h-4" /> Calibrate scale
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm text-muted-foreground">
              Pick two reference points on the sheet, then type the real
              distance using the Bluebeam-style grammar
              (<code className="text-[10px]">12</code>,{" "}
              <code className="text-[10px]">12'6"</code>,{" "}
              <code className="text-[10px]">12&lt;30</code>).
            </DialogPrimitive.Description>
          </div>

          <div
            className="flex items-center gap-2 px-3 py-2 rounded border bg-muted/40 text-xs"
            data-testid="inline-calibration-step"
          >
            <MousePointer className="w-3.5 h-3.5" />
            <span className="flex-1">{stepText}</span>
            <Badge variant="outline" className="text-[10px]">
              {calibrationPoints.length}/2
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="inline-calibration-units" className="text-xs">
              Units
            </Label>
            <select
              id="inline-calibration-units"
              data-testid="select-inline-calibration-units"
              value={units}
              onChange={(e) => setUnits(e.target.value as DefaultUnits)}
              className="text-xs border rounded px-2 py-1 bg-background"
            >
              <option value="ft">ft / in</option>
              <option value="m">m / cm / mm</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="inline-calibration-distance" className="text-xs">
              Real-world distance
            </Label>
            <Input
              id="inline-calibration-distance"
              data-testid="input-inline-calibration-distance"
              value={draftDistance}
              onChange={(e) => setDraftDistance(e.target.value)}
              onKeyDown={(e) => {
                // Enter inside the drawer = Save (unless the user has
                // typed garbage that fails the parser).
                if (e.key === "Enter" && distanceValid) {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              placeholder={units === "m" ? "e.g. 3.5 or 3m" : `e.g. 12 or 12'6"`}
              className={cn(
                "h-9 text-sm font-mono",
                draftDistance && !parsed.ok && "border-destructive",
              )}
            />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              {!parsed.ok && draftDistance ? (
                <span
                  className="text-destructive"
                  data-testid="text-inline-calibration-error"
                >
                  {parsed.error}
                </span>
              ) : (
                <span data-testid="text-inline-calibration-parsed">
                  {distanceValid && draftLengthFt !== null
                    ? `= ${draftLengthFt.toFixed(3)} ft`
                    : "\u00a0"}
                </span>
              )}
              {previewScale !== null && (
                <span data-testid="text-inline-calibration-preview-scale">
                  {previewScale.toFixed(2)} px/ft
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label
              htmlFor="inline-calibration-region-label"
              className="text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              Region label (optional)
            </Label>
            <Input
              id="inline-calibration-region-label"
              data-testid="input-inline-calibration-region-label"
              value={draftRegionLabel}
              onChange={(e) => setDraftRegionLabel(e.target.value)}
              placeholder="e.g. Foundation detail"
              className="h-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetPoints}
              data-testid="button-inline-calibration-reset"
            >
              <X className="w-3.5 h-3.5 mr-1" /> Reset points
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddRegion}
              disabled={!distanceValid || calibrationPoints.length !== 2}
              data-testid="button-inline-calibration-add-region"
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Add region
            </Button>
          </div>

          {(multiCalibMode || multiCalibPoints.length > 0) && (
            <div
              className="rounded border p-2 text-xs flex flex-col gap-1"
              data-testid="inline-calibration-regions"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">Regions captured</span>
                <Badge variant="secondary" className="text-[10px]">
                  {multiCalibPoints.length}
                </Badge>
              </div>
              {multiCalibPoints.length === 0 && (
                <span className="text-muted-foreground text-[10px]">
                  No regions yet — capture two points then "Add region".
                </span>
              )}
              {multiCalibPoints.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-[10px]"
                  data-testid={`inline-calibration-region-${i}`}
                >
                  <span data-testid={`text-inline-calibration-region-label-${i}`}>
                    {r.label && r.label.length > 0
                      ? r.label
                      : `Region ${i + 1}`}
                  </span>
                  <span className="font-mono">{r.distance.toFixed(2)} ft</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-2">
            <Checkbox
              id="inline-calibration-sheet-set"
              data-testid="checkbox-apply-sheet-set"
              checked={applyToSheetSet}
              disabled={!sheetSetFlagOn}
              onCheckedChange={(v) => setApplyToSheetSet(v === true)}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Label
                  htmlFor="inline-calibration-sheet-set"
                  className={cn(
                    "text-xs cursor-help select-none",
                    !sheetSetFlagOn && "text-muted-foreground",
                  )}
                >
                  Apply to entire Sheet Set
                  {sheetSetFlagOn && activeSheetSet ? (
                    <Badge variant="outline" className="ml-2 text-[9px]">
                      {activeSheetSet.name} · {activeSheetSet.memberCount}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="ml-2 text-[9px]">
                      No active set
                    </Badge>
                  )}
                </Label>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                {sheetSetFlagOn
                  ? APPLY_TO_SHEET_SET_TOOLTIP_ENABLED
                  : APPLY_TO_SHEET_SET_TOOLTIP_DISABLED}
              </TooltipContent>
            </Tooltip>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span
              className="text-muted-foreground"
              data-testid="text-inline-calibration-current-scale"
            >
              {currentScalePxPerFoot
                ? `Current scale: ${currentScalePxPerFoot.toFixed(2)} px/ft`
                : "Not calibrated"}
            </span>
            <button
              type="button"
              className="text-primary hover:underline flex items-center gap-1"
              onClick={onUseStandardScale}
              data-testid="button-inline-calibration-use-standard"
            >
              Use Standard Scale <ExternalLink className="w-3 h-3" />
            </button>
          </div>

          <div className="mt-auto flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              data-testid="button-inline-calibration-cancel"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!distanceValid || calibrationPoints.length !== 2}
              data-testid="button-inline-calibration-save"
            >
              Save calibration
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
