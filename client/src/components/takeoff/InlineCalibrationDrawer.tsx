import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { MapPin } from "lucide-react";
import { CalibrationZonesPanel } from "./CalibrationZonesPanel";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Ruler, MousePointer, Plus, X, ExternalLink, AlertTriangle, History, Lock, RefreshCcw } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  parseTypedDimension,
  type DefaultUnits,
} from "@/lib/takeoffTypedInput";
import { BULK_SCALE_PROPAGATION_CONFIRM_MIN_MEMBERS } from "@shared/schema";
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

// Task #2780 — "Save as Zone" inline button rendered inside the calibration drawer.
// Expands the calibration line into a thin perpendicular rectangle zone polygon,
// prompts for a name, and POSTs to /api/takeoff/sheets/:sheetId/calibration-zones.
function SaveZoneButton({
  sheetId,
  pxPerFoot,
  calibrationPoints,
}: {
  sheetId?: string;
  pxPerFoot: number;
  calibrationPoints: [{ x: number; y: number }, { x: number; y: number }];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [zoneName, setZoneName] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (!sheetId) throw new Error("No sheet");
      const [p1, p2] = calibrationPoints;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const halfW = Math.max(len * 0.2, 20);
      const nx = (-dy / len) * halfW;
      const ny = (dx / len) * halfW;
      const polygon = [
        { x: p1.x + nx, y: p1.y + ny },
        { x: p2.x + nx, y: p2.y + ny },
        { x: p2.x - nx, y: p2.y - ny },
        { x: p1.x - nx, y: p1.y - ny },
      ];
      return apiRequest("POST", `/api/takeoff/sheets/${sheetId}/calibration-zones`, {
        name: zoneName.trim() || "Calibration Zone",
        polygonPoints: polygon,
        pxPerFoot,
      });
    },
    onSuccess: () => {
      toast({ title: "Zone saved", description: `Calibration zone "${zoneName || "Calibration Zone"}" saved.` });
      qc.invalidateQueries({ queryKey: [`/api/takeoff/sheets/${sheetId}/calibration-zones`] });
      setOpen(false);
      setZoneName("");
    },
    onError: () => {
      toast({ title: "Failed to save zone", variant: "destructive" });
    },
  });

  if (!sheetId) return null;

  return open ? (
    <div className="flex items-center gap-1">
      <input
        type="text"
        value={zoneName}
        onChange={e => setZoneName(e.target.value)}
        placeholder="Zone name…"
        className="h-7 rounded border border-input bg-background px-2 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-ring"
        onKeyDown={e => { if (e.key === "Enter") mutation.mutate(); if (e.key === "Escape") setOpen(false); }}
        autoFocus
        data-testid="input-save-zone-name"
      />
      <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => mutation.mutate()} disabled={mutation.isPending} data-testid="button-save-zone-confirm">
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-1" onClick={() => setOpen(false)} data-testid="button-save-zone-cancel">
        <X className="w-3 h-3" />
      </Button>
    </div>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      onClick={() => setOpen(true)}
      data-testid="button-save-as-zone"
    >
      <MapPin className="w-3 h-3 mr-1" /> Save as Zone
    </Button>
  );
}

export interface InlineCalibrationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Task #2780 — Optional sheet ID used by the "Save as Zone" affordance. */
  sheetId?: string;
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
   *  the upstream `setCalibrationDistance` call below.
   *
   *  Task #2326 — When the sheet already has measurements AND a
   *  prior scale exists, the second arg carries the user's
   *  lock-vs-rescale choice (see `existingMeasurementCount` below
   *  for the gate). The parent forwards it to the calibration PATCH
   *  so the server knows whether to recompute or to snapshot the
   *  OLD scale onto each row. */
  onSaveCalibration: (
    distanceFt?: number,
    options?: {
      existingMeasurementHandling?: "rescale" | "lock";
      /** Task #2351 — Optional free-text note the estimator typed
       *  alongside this calibration (e.g. "Verified against
       *  architect's dimension on A2.1"). Whitespace-only values
       *  are normalised to omitted by the drawer; the parent only
       *  sees a populated string when there's content worth
       *  persisting. The PATCH endpoint stores it on the audit
       *  row's newValue JSON so the Scale History panel can render
       *  it inline with the calibration entry. */
      note?: string;
    },
  ) => void | Promise<void>;
  /** Open the existing PlanScaleModal so the user can pick a known
   *  ratio (e.g. 1/4" = 1'-0") instead of drawing a calibration. */
  onUseStandardScale: () => void;
  /** Task #2325 — Open the Scale History side panel. When omitted the
   *  affordance is hidden (e.g. unit tests that don't mount the panel). */
  onShowScaleHistory?: () => void;
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
  /** Task #2228 — Bulk-scale propagation confirmation. When the
   *  Apply-to-Sheet-Set checkbox is on AND the active set has more
   *  than `BULK_SCALE_PROPAGATION_CONFIRM_MIN_MEMBERS` members, hitting
   *  Save first opens an AlertDialog spelling out how many sheets are
   *  about to be re-scaled and the from→to scale values. The user
   *  can opt out of seeing the dialog again with the embedded
   *  "Don't ask me again" toggle, which is persisted via
   *  `onSkipBulkScalePropagationConfirmChange` (PATCHes user
   *  settings). When `skipBulkScalePropagationConfirm` is true, the
   *  Save button skips the dialog and propagates immediately — the
   *  toast Undo affordance is still the safety net. */
  skipBulkScalePropagationConfirm?: boolean;
  onSkipBulkScalePropagationConfirmChange?: (skip: boolean) => void | Promise<void>;
  /** Task #2320 — current AI-detected scale for this sheet, if the
   *  detector has produced one. The drawer compares this against the
   *  user's typed-distance preview and surfaces an inline warning
   *  when they disagree by more than 5%, with one-click "Use detected"
   *  to swap the typed distance for the detector's value. Optional;
   *  when null/undefined the warning never renders. */
  aiDetectedScale?: { label: string; pxPerFoot: number } | null;
  /** Task #2326 — Number of measurements that already exist on the
   *  current sheet. When this is > 0 AND `currentScalePxPerFoot` is
   *  set (i.e. this is a *re-*calibration, not a first-time one),
   *  the drawer renders the lock-vs-rescale choice. First-time
   *  calibration (no prior scale OR no measurements yet) skips the
   *  prompt — there's nothing to lock. Optional so existing callers
   *  that don't yet thread the count keep the original behaviour. */
  existingMeasurementCount?: number;
  /** Task #2781 — ID of the zone currently selected on the canvas.
   *  Forwarded to CalibrationZonesPanel so the row highlights. */
  selectedCalibrationZoneId?: string | null;
  /** Task #2781 — Called when a zone is selected (canvas click or panel row click). */
  onSelectCalibrationZone?: (id: string | null) => void;
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
    onShowScaleHistory,
    multiCalibMode,
    multiCalibPoints,
    setMultiCalibPoints,
    activeSheetSet,
    onApplyToSheetSet,
    defaultApplyToSheetSet,
    skipBulkScalePropagationConfirm,
    onSkipBulkScalePropagationConfirmChange,
    aiDetectedScale,
    existingMeasurementCount,
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
  // Task #2351 — Optional free-text note the estimator can type
  // alongside the calibration ("Verified against architect's
  // dimension on A2.1"). Persisted server-side onto the audit
  // row's newValue JSON and surfaced inline by the Scale History
  // panel. Local-only until Save commits — a half-typed note
  // shouldn't leak into a drawer that gets dismissed without
  // saving. Hard cap matches the server-side validation in
  // `PATCH /api/takeoff/sheets/:id/calibration` so the UI can't
  // submit something the route would reject.
  const [draftNote, setDraftNote] = useState("");
  const NOTE_MAX_LENGTH = 500;
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

  // Task #2228 — Bulk-scale propagation confirmation. Only intercept
  // Save when ALL the safety conditions hold: the user opted into
  // applying to the Sheet Set, an active set is wired up, the set
  // is large enough that a wrong propagation would be expensive, and
  // the user hasn't already opted out via "Don't ask me again".
  // Single-member or unchecked saves keep the original one-click
  // path so the common workflow stays fast.
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkConfirmDontAsk, setBulkConfirmDontAsk] = useState(false);
  const [aiDeltaOverridden, setAiDeltaOverridden] = useState(false);

  // Task #2326 — Lock-vs-rescale choice. The radio only renders
  // when this is a real *re-*calibration (a prior scale exists AND
  // there are existing measurements that would otherwise silently
  // shift). We default to "rescale" so a user who never engages
  // with the radio gets the historical behaviour. The local state
  // resets each time the drawer opens so a previous "lock" pick
  // can't accidentally leak into the next calibration session.
  const isRecalibration =
    currentScalePxPerFoot != null &&
    currentScalePxPerFoot > 0 &&
    (existingMeasurementCount ?? 0) > 0;
  const [existingMeasurementHandling, setExistingMeasurementHandling] = useState<
    "rescale" | "lock"
  >("rescale");
  useEffect(() => {
    if (open) {
      setExistingMeasurementHandling("rescale");
    }
  }, [open]);

  // Task #2351 — Reset the optional note each time the drawer
  // (re)opens so a previous session's "Verified against …" can't
  // accidentally piggy-back onto an unrelated calibration.
  useEffect(() => {
    if (open) {
      setDraftNote("");
    }
  }, [open]);

  useEffect(() => {
    setAiDeltaOverridden(false);
  }, [aiDetectedScale?.pxPerFoot, aiDetectedScale?.label, calibrationDistance]);

  // Note: `sheetSetFlagOn` already implies `!!onApplyToSheetSet`, so
  // TypeScript's control-flow analysis treats a subsequent
  // `onApplyToSheetSet &&` as redundant (TS2774). The runtime gate
  // here only needs `sheetSetFlagOn` + `activeSheetSet` to be safe.
  const requiresBulkScaleConfirmation = !!(
    applyToSheetSet &&
    sheetSetFlagOn &&
    activeSheetSet &&
    calibrationPoints.length === 2 &&
    activeSheetSet.memberCount > BULK_SCALE_PROPAGATION_CONFIRM_MIN_MEMBERS &&
    !skipBulkScalePropagationConfirm
  );

  const performSave = async () => {
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
    //
    // Task #2326 — Forward the lock-vs-rescale choice only when the
    // recalibration prompt actually rendered. First-time
    // calibrations (no prior scale OR no measurements) skip the
    // option so the server stays on its backwards-compatible
    // default. Apply-to-Sheet-Set still goes through the unmodified
    // `onApplyToSheetSet` path: per-sheet locking is the safer
    // default because the bulk path would need its own lock prompt
    // per affected sheet to be honest about scope.
    // Task #2351 — Only forward a note when the user actually typed
    // one. Whitespace-only values are normalised away so the audit
    // log doesn't end up with empty-string noise next to every
    // calibration. Cap the length defensively to mirror the
    // server-side validation in the calibration PATCH route.
    const trimmedNote = draftNote.trim().slice(0, NOTE_MAX_LENGTH);
    const saveOptions: {
      existingMeasurementHandling?: "rescale" | "lock";
      note?: string;
    } = {};
    if (isRecalibration) saveOptions.existingMeasurementHandling = existingMeasurementHandling;
    if (trimmedNote.length > 0) saveOptions.note = trimmedNote;
    await onSaveCalibration(
      draftLengthFt,
      Object.keys(saveOptions).length > 0 ? saveOptions : undefined,
    );
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

  const handleSave = async () => {
    if (!parsed.ok || draftLengthFt === null) return;
    if (requiresBulkScaleConfirmation) {
      // Reset the "don't ask again" toggle each time we open so a
      // previous Cancel can't leave it pre-checked on the next open.
      setBulkConfirmDontAsk(false);
      setBulkConfirmOpen(true);
      return;
    }
    await performSave();
  };

  const handleConfirmBulkScale = async () => {
    // Persist the remembered choice BEFORE we close the dialog so
    // the PATCH fires off whether or not the parent re-renders the
    // drawer in response to the save.
    if (bulkConfirmDontAsk && onSkipBulkScalePropagationConfirmChange) {
      try {
        await onSkipBulkScalePropagationConfirmChange(true);
      } catch (err) {
        // Persisting the user setting is a nice-to-have; the
        // actual save must still go through even if the PATCH
        // fails. The settings flow surfaces its own error toast.
        console.warn(
          "[InlineCalibrationDrawer] Failed to persist skipBulkScalePropagationConfirm:",
          err,
        );
      }
    }
    setBulkConfirmOpen(false);
    await performSave();
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

          {/*
            Task #2320 — Typed-vs-AI-detected delta warning. Surfaces
            inline when the user's typed distance produces a scale
            that disagrees with the AI detector by more than 5%.
            "Use detected" rewrites the typed distance so the
            preview matches the detector exactly (we work back from
            pxPerFoot using the captured pixel distance), letting
            the existing Save flow run unmodified. Hidden as soon as
            the deltas align — there's no lingering banner once the
            user reconciles.
          */}
          {aiDetectedScale &&
            !aiDeltaOverridden &&
            previewScale !== null &&
            aiDetectedScale.pxPerFoot > 0 &&
            calibrationPoints.length === 2 &&
            Math.abs(previewScale - aiDetectedScale.pxPerFoot) /
              aiDetectedScale.pxPerFoot >
              0.05 && (
              <div
                className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs flex flex-col gap-1.5 text-amber-800 dark:text-amber-200"
                data-testid="inline-calibration-ai-delta-warning"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <span data-testid="text-inline-calibration-ai-delta-message">
                    Your typed distance produces{" "}
                    <strong>{previewScale.toFixed(2)} px/ft</strong>, but the
                    AI detector found{" "}
                    <strong data-testid="text-inline-calibration-ai-scale-label">
                      {aiDetectedScale.label}
                    </strong>{" "}
                    (
                    <span className="font-mono">
                      {aiDetectedScale.pxPerFoot.toFixed(2)} px/ft
                    </span>
                    ) — a{" "}
                    <span data-testid="text-inline-calibration-ai-delta-percent">
                      {(
                        (Math.abs(previewScale - aiDetectedScale.pxPerFoot) /
                          aiDetectedScale.pxPerFoot) *
                        100
                      ).toFixed(1)}
                      %
                    </span>{" "}
                    difference.
                  </span>
                </div>
                <div className="flex items-center gap-2 ml-5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      // Compute the typed distance that would make
                      // the preview match the detector exactly.
                      // Pixel distance is fixed by the captured
                      // points; rewriting the typed feet value lets
                      // every downstream code path (Save, Add region,
                      // bulk propagate) consume the same parsed
                      // grammar without a special "use detected" save
                      // path.
                      const px = pixelDistance(
                        calibrationPoints[0],
                        calibrationPoints[1],
                      );
                      if (px <= 0) return;
                      const ftFromAi = px / aiDetectedScale.pxPerFoot;
                      const display =
                        units === "m"
                          ? (ftFromAi / M_TO_FT).toFixed(3)
                          : ftFromAi.toFixed(3);
                      setDraftDistance(display);
                    }}
                    data-testid="button-inline-calibration-use-detected"
                  >
                    Use detected
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px] text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
                    onClick={() => setAiDeltaOverridden(true)}
                    data-testid="button-inline-calibration-override-ai"
                  >
                    Override
                  </Button>
                </div>
              </div>
            )}

          {/*
            Task #2326 — Re-calibration prompt. Only shown when the
            sheet already has a scale AND existing measurements; a
            fresh sheet has nothing to lock so we don't pester the
            user. The radio defaults to "rescale" (legacy behaviour).
            Picking "lock" snapshots the OLD px/ft onto every
            unlocked measurement server-side and flips
            `scaleLockedToRevision` on the sheet — measurements
            keep their previously-computed length / area regardless
            of where the new calibration lands.
          */}
          {isRecalibration && (
            <div
              className="rounded border bg-muted/30 px-3 py-2 flex flex-col gap-2"
              data-testid="inline-calibration-existing-handling"
            >
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Existing measurements ({existingMeasurementCount})
              </Label>
              <RadioGroup
                value={existingMeasurementHandling}
                onValueChange={(v) =>
                  setExistingMeasurementHandling(
                    v === "lock" ? "lock" : "rescale",
                  )
                }
                className="flex flex-col gap-1.5"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value="rescale"
                    id="inline-calibration-handling-rescale"
                    data-testid="radio-existing-handling-rescale"
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="inline-calibration-handling-rescale"
                    className="text-xs font-normal cursor-pointer leading-snug flex items-start gap-1.5"
                  >
                    <RefreshCcw className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>
                      Re-scale existing measurements to the new
                      calibration
                    </span>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value="lock"
                    id="inline-calibration-handling-lock"
                    data-testid="radio-existing-handling-lock"
                    className="mt-0.5"
                  />
                  <Label
                    htmlFor="inline-calibration-handling-lock"
                    className="text-xs font-normal cursor-pointer leading-snug flex items-start gap-1.5"
                  >
                    <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                    <span>
                      Lock existing measurements at the current scale
                      (their lengths and areas won't change)
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

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

          {/*
            Task #2351 — Optional calibration note. Free-text the
            estimator can attach to the audit row so QA / bid handoff
            can see *why* the scale was set the way it was
            ("Verified against architect's dimension on A2.1",
            "Used the printed bar scale", etc.). The Scale History
            panel renders the note inline with the entry. Empty /
            whitespace-only values are normalised away so the audit
            row stays clean when there's nothing worth saving.
          */}
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="inline-calibration-note"
              className="text-[10px] uppercase tracking-wide text-muted-foreground"
            >
              Note (optional)
            </Label>
            <Textarea
              id="inline-calibration-note"
              data-testid="input-inline-calibration-note"
              value={draftNote}
              onChange={(e) => setDraftNote(e.target.value.slice(0, NOTE_MAX_LENGTH))}
              placeholder={`e.g. Verified against architect's dimension on A2.1`}
              maxLength={NOTE_MAX_LENGTH}
              className="min-h-[60px] text-xs"
            />
            <div className="flex items-center justify-end text-[10px] text-muted-foreground">
              <span data-testid="text-inline-calibration-note-count">
                {draftNote.length}/{NOTE_MAX_LENGTH}
              </span>
            </div>
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
            <div className="flex items-center gap-3">
              {onShowScaleHistory && (
                <button
                  type="button"
                  className="text-primary hover:underline flex items-center gap-1"
                  onClick={onShowScaleHistory}
                  data-testid="button-inline-calibration-show-scale-history"
                >
                  <History className="w-3 h-3" /> Scale history
                </button>
              )}
              <button
                type="button"
                className="text-primary hover:underline flex items-center gap-1"
                onClick={onUseStandardScale}
                data-testid="button-inline-calibration-use-standard"
              >
                Use Standard Scale <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>

          {props.sheetId && (
            <CalibrationZonesPanel
              sheetId={props.sheetId}
              className="border-t border-border -mx-4 mt-2"
              selectedZoneId={props.selectedCalibrationZoneId}
              onSelectZone={props.onSelectCalibrationZone}
            />
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {previewScale !== null && calibrationPoints.length === 2 && (
                <SaveZoneButton
                  sheetId={props.sheetId}
                  pxPerFoot={previewScale}
                  calibrationPoints={calibrationPoints as [{ x: number; y: number }, { x: number; y: number }]}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>

      {/*
        Task #2228 — Bulk-scale propagation confirmation dialog.
        Rendered alongside (not nested inside) the drawer's
        DialogPrimitive.Content so the AlertDialog's modal overlay
        sits above everything, not just inside the drawer panel.
        We deliberately keep the drawer open underneath: if the user
        cancels, they're back at the same Save state without losing
        their picked points or typed distance.
      */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent
          data-testid="dialog-bulk-scale-confirm"
          className="sm:max-w-md"
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {activeSheetSet
                ? `Apply this scale to ${activeSheetSet.memberCount} sheets?`
                : "Apply this scale to every sheet?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every measurement on every sheet in{" "}
              <strong data-testid="text-bulk-scale-set-name">
                {activeSheetSet?.name ?? "this Sheet Set"}
              </strong>{" "}
              will shift to match the new calibration. This cannot be
              fully reversed without the Undo toast — once that
              dismisses, individual sheets must be re-calibrated by
              hand.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="rounded border bg-muted/40 p-3 text-xs space-y-1.5">
            <div
              className="flex items-center justify-between"
              data-testid="text-bulk-scale-from"
            >
              <span className="text-muted-foreground">Current scale</span>
              <span className="font-mono">
                {currentScalePxPerFoot
                  ? `${currentScalePxPerFoot.toFixed(2)} px/ft`
                  : "Not calibrated"}
              </span>
            </div>
            <div
              className="flex items-center justify-between"
              data-testid="text-bulk-scale-to"
            >
              <span className="text-muted-foreground">New scale</span>
              <span className="font-mono">
                {previewScale !== null
                  ? `${previewScale.toFixed(2)} px/ft`
                  : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Sheets affected</span>
              <span
                className="font-mono"
                data-testid="text-bulk-scale-member-count"
              >
                {activeSheetSet?.memberCount ?? 0}
              </span>
            </div>
          </div>

          {onSkipBulkScalePropagationConfirmChange && (
            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="bulk-scale-confirm-dont-ask"
                data-testid="checkbox-bulk-scale-dont-ask"
                checked={bulkConfirmDontAsk}
                onCheckedChange={(v) => setBulkConfirmDontAsk(v === true)}
              />
              <Label
                htmlFor="bulk-scale-confirm-dont-ask"
                className="text-xs cursor-pointer select-none"
              >
                Don't ask me again
              </Label>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-bulk-scale-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkScale}
              data-testid="button-bulk-scale-confirm"
            >
              {activeSheetSet
                ? `Apply to ${activeSheetSet.memberCount} sheets`
                : "Apply"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogPrimitive.Root>
  );
}
