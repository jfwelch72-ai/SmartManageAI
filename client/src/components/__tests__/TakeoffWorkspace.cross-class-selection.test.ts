// @vitest-environment jsdom
/**
 * Task #1884 — Regression test for the cross-class selection mutual
 * exclusion that prevents Delete/Backspace from removing a measurement
 * AND a markup at the same time.
 *
 * Background: `selectedMeasurementId` (single-select) /
 * `selectedMeasurementIds` (multi-select) and `selectedMarkupIds`
 * (markup multi-select) are tracked independently in
 * `TakeoffWorkspace.tsx`. With Task #1861 wiring Delete/Backspace to
 * bulk-delete selected markups, a mixed selection used to fire BOTH
 * the measurement-side handler in `use-takeoff-interactions.ts` AND
 * the new markup-side handler in `TakeoffWorkspace.tsx` on the same
 * keypress — silently nuking work the user didn't intend to remove.
 *
 * Fix: the workspace's mutual-exclusion `useEffect` delegates to the
 * pure `resolveCrossClassSelection` helper exported from
 * `TakeoffWorkspace.tsx`. Whenever one class's selection grows the
 * other class is cleared, so the two Delete handlers can never both
 * fire.
 *
 * These tests exercise that helper directly so every mixed-selection
 * edge case (single + markup, multi-set + markup, shift-add markup
 * onto an existing measurement, etc.) is covered without standing up
 * the full Konva workspace.
 */
import { describe, it, expect } from "vitest";
import { resolveCrossClassSelection } from "@/components/TakeoffWorkspace";

describe("resolveCrossClassSelection (Task #1884)", () => {
  it("returns noop on initial mount with empty selections", () => {
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: null,
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 0,
        prevSelectedMeasurementId: null,
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 0,
      }),
    ).toBe("noop");
  });

  it("clears markups when a measurement is selected onto an existing markup selection", () => {
    // Mixed-selection scenario from the task description:
    // user already has markups selected; clicking a measurement
    // triggers `setSelectedMeasurementId(newId)` from null → newId.
    // Without the helper, both handlers would fire on Delete.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 3,
        prevSelectedMeasurementId: null,
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 3,
      }),
    ).toBe("clear-markups");
  });

  it("clears markups when measurement multi-set grows onto an existing markup selection", () => {
    // Ctrl+A "Select all measurements" while markups are selected.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 12,
        selectedMarkupIdsSize: 2,
        prevSelectedMeasurementId: null,
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 2,
      }),
    ).toBe("clear-markups");
  });

  it("clears measurements when a markup is selected onto an existing measurement selection", () => {
    // Mirror of the original scenario: user has a measurement
    // selected; canvas-clicking a markup grows the markup selection
    // from 0 → 1.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 1,
        prevSelectedMeasurementId: "meas-1",
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 0,
      }),
    ).toBe("clear-measurements");
  });

  it("clears measurements when shift-click expands the markup multi-set onto an existing measurement selection", () => {
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 5,
        selectedMarkupIdsSize: 4,
        prevSelectedMeasurementId: "meas-1",
        prevSelectedMeasurementIdsSize: 5,
        prevSelectedMarkupIdsSize: 3,
      }),
    ).toBe("clear-measurements");
  });

  it("returns noop when measurement-only selection changes (Tab to next measurement)", () => {
    // Existing single-class delete behavior must be unchanged: tabbing
    // through measurements with no markups selected is a noop.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-2",
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 0,
        prevSelectedMeasurementId: "meas-1",
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 0,
      }),
    ).toBe("noop");
  });

  it("returns clear-measurements when markup-only selection grows (caller short-circuits when nothing to clear)", () => {
    // Markups-only multi-select expansion (no measurement selected)
    // still returns "clear-measurements" because the helper is purely
    // about which class won the growth race. The caller in
    // `TakeoffWorkspace`'s effect short-circuits on already-empty
    // measurement state (`if (selectedMeasurementId !== null)` /
    // `if (selectedMeasurementIds.size > 0)`), so this is effectively
    // a no-op in production — but pinning the helper's contract here
    // means a future caller refactor can't quietly change it.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: null,
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 4,
        prevSelectedMeasurementId: null,
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 3,
      }),
    ).toBe("clear-measurements");
  });

  it("returns noop when measurement is deselected (shrinking is not a trigger)", () => {
    // Pressing Escape clears `selectedMeasurementId`. That must NOT
    // trigger any markup-side action.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: null,
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 2,
        prevSelectedMeasurementId: "meas-1",
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 2,
      }),
    ).toBe("noop");
  });

  it("returns noop when markups are deselected (shrinking is not a trigger)", () => {
    // After a successful bulk delete the markup selection collapses
    // from N → 0. That must NOT clobber a separately-selected
    // measurement (defensive — single-class behavior preserved).
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 0,
        prevSelectedMeasurementId: "meas-1",
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 4,
      }),
    ).toBe("noop");
  });

  it("returns noop when both grow in the same render (extreme race; do not double-clear)", () => {
    // Defensive — if both setters somehow batch together in one React
    // render the helper is a noop rather than guessing which class
    // wins. The next user interaction will pick a side.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 1,
        prevSelectedMeasurementId: null,
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 0,
      }),
    ).toBe("noop");
  });

  it("returns noop when re-selecting the same measurement id (no growth)", () => {
    // Idempotent re-selection (e.g. a list-row click that resolves to
    // the already-selected id) must not clobber an unrelated markup
    // selection.
    expect(
      resolveCrossClassSelection({
        selectedMeasurementId: "meas-1",
        selectedMeasurementIdsSize: 0,
        selectedMarkupIdsSize: 2,
        prevSelectedMeasurementId: "meas-1",
        prevSelectedMeasurementIdsSize: 0,
        prevSelectedMarkupIdsSize: 2,
      }),
    ).toBe("noop");
  });
});
