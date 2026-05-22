// ---------------------------------------------------------------------------
// Cross-class selection resolver (Task #1884)
//
// Extracted from TakeoffWorkspace.tsx so that file exports only React
// components/hooks and qualifies for Vite Fast Refresh (in-place hot-swap
// instead of full module teardown).  The logic is pure and has its own
// unit-test suite at:
//   client/src/components/__tests__/TakeoffWorkspace.cross-class-selection.test.ts
// ---------------------------------------------------------------------------

export type CrossClassSelectionInputs = {
  selectedMeasurementId: string | null;
  selectedMeasurementIdsSize: number;
  selectedMarkupIdsSize: number;
  prevSelectedMeasurementId: string | null;
  prevSelectedMeasurementIdsSize: number;
  prevSelectedMarkupIdsSize: number;
};

export type CrossClassSelectionDecision =
  | "noop"
  | "clear-markups"
  | "clear-measurements";

export function resolveCrossClassSelection(
  inputs: CrossClassSelectionInputs,
): CrossClassSelectionDecision {
  const {
    selectedMeasurementId,
    selectedMeasurementIdsSize,
    selectedMarkupIdsSize,
    prevSelectedMeasurementId,
    prevSelectedMeasurementIdsSize,
    prevSelectedMarkupIdsSize,
  } = inputs;

  // "Grew" = the user expanded this class's selection on this render
  // (selected a new measurement, added to the multi-set, or shift-clicked
  // a new markup). Shrinking — deselecting, sheet change, escape — is
  // intentionally a no-op so we don't fight existing teardown effects.
  const measurementGrew =
    (selectedMeasurementId !== null &&
      selectedMeasurementId !== prevSelectedMeasurementId) ||
    selectedMeasurementIdsSize > prevSelectedMeasurementIdsSize;
  const markupGrew = selectedMarkupIdsSize > prevSelectedMarkupIdsSize;

  if (measurementGrew && !markupGrew && selectedMarkupIdsSize > 0) {
    return "clear-markups";
  }
  if (markupGrew && !measurementGrew) {
    return "clear-measurements";
  }
  return "noop";
}
