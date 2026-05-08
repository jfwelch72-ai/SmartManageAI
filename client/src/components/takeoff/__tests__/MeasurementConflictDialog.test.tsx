// @vitest-environment jsdom
/**
 * Task #2656 — Coverage for the per-field merge dialog added in
 * Task #2652. Pins three behaviours so the conflict UX can't quietly
 * regress on a future refactor:
 *   1. The teammate's name (sourced server-side from audit_log) is
 *      surfaced in the header — falls back to "Another teammate" when
 *      the lookup returned null.
 *   2. Each field row tags itself "Differs" or "Same" against the
 *      server row, and the Same rows have their radios disabled so
 *      the user can't pick a phantom value for a field they didn't
 *      touch.
 *   3. The "Select all theirs" shortcut flips every diffed radio to
 *      the server value, and "Apply merge" calls onApply with the
 *      hand-merged shape (their value for fields the user toggled,
 *      the user's value for fields left on the default).
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import {
  MeasurementConflictDialog,
  type MeasurementConflict,
} from "../MeasurementConflictDialog";
import type { TakeoffMeasurement } from "@shared/schema";

afterEach(() => cleanup());

function buildConflict(overrides: Partial<MeasurementConflict> = {}): MeasurementConflict {
  // Server row reflects what the teammate just saved. The pending
  // edit is what the current user was about to PATCH. label and
  // unitCost differ; costCodeId is the same on both sides so the
  // dialog should tag it "Same" and disable its radios.
  const serverRow = {
    id: "m-1",
    label: "Server label",
    unitCost: "10.00",
    costCodeId: "cc-shared",
  } as unknown as TakeoffMeasurement;

  return {
    measurementId: "m-1",
    pendingEdit: {
      label: "My new label",
      unitCost: "12.50",
      costCodeId: "cc-shared",
      // Control keys must be filtered out of the diff rows.
      expectedVersion: 4,
      forceOverwrite: false,
    },
    serverRow,
    currentVersion: 5,
    lastEditor: {
      id: "u-2",
      firstName: "Bob",
      lastName: "Builder",
      editedAt: new Date("2026-01-02T03:04:05Z").toISOString(),
    },
    ...overrides,
  };
}

describe("MeasurementConflictDialog (Task #2656)", () => {
  it("shows the teammate's name from lastEditor in the header", () => {
    render(
      <MeasurementConflictDialog
        conflict={buildConflict()}
        onDismiss={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId("text-conflict-editor-name").textContent).toBe(
      "Bob Builder",
    );
  });

  it("falls back to 'Another teammate' when the audit lookup returned null", () => {
    render(
      <MeasurementConflictDialog
        conflict={buildConflict({ lastEditor: null })}
        onDismiss={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId("text-conflict-editor-name").textContent).toBe(
      "Another teammate",
    );
  });

  it("renders 'Differs' / 'Same' badges per field and hides control keys", () => {
    render(
      <MeasurementConflictDialog
        conflict={buildConflict()}
        onDismiss={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    // label differs.
    const labelRow = screen.getByTestId("row-conflict-field-label");
    expect(labelRow.textContent).toContain("Differs");
    // unitCost differs.
    const unitCostRow = screen.getByTestId("row-conflict-field-unitCost");
    expect(unitCostRow.textContent).toContain("Differs");
    // costCodeId matches → Same and the radios are disabled.
    const costCodeRow = screen.getByTestId("row-conflict-field-costCodeId");
    expect(costCodeRow.textContent).toContain("Same");
    const costCodeMine = screen.getByTestId("radio-conflict-mine-costCodeId") as HTMLInputElement;
    const costCodeTheirs = screen.getByTestId("radio-conflict-theirs-costCodeId") as HTMLInputElement;
    expect(costCodeMine.disabled).toBe(true);
    expect(costCodeTheirs.disabled).toBe(true);

    // Mutation-control keys must NOT appear as diff rows.
    expect(screen.queryByTestId("row-conflict-field-expectedVersion")).toBeNull();
    expect(screen.queryByTestId("row-conflict-field-forceOverwrite")).toBeNull();
  });

  it("'Select all theirs' flips every diffed radio to the server value", () => {
    render(
      <MeasurementConflictDialog
        conflict={buildConflict()}
        onDismiss={vi.fn()}
        onApply={vi.fn()}
      />,
    );

    // Defaults: every diffed field starts on "mine".
    expect((screen.getByTestId("radio-conflict-mine-label") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("radio-conflict-mine-unitCost") as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByTestId("button-conflict-select-all-theirs"));

    expect((screen.getByTestId("radio-conflict-theirs-label") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("radio-conflict-theirs-unitCost") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("radio-conflict-mine-label") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("radio-conflict-mine-unitCost") as HTMLInputElement).checked).toBe(false);
  });

  it("'Apply merge' calls onApply with the hand-merged shape", () => {
    const onApply = vi.fn();
    render(
      <MeasurementConflictDialog
        conflict={buildConflict()}
        onDismiss={vi.fn()}
        onApply={onApply}
      />,
    );

    // Toggle just the label to "theirs"; leave unitCost on the default
    // ("mine"). The merged payload should mirror that hand-merge:
    //   - label   → server value ("Server label")
    //   - unitCost → user's pending value ("12.50")
    //   - costCodeId → user's pending value (Same row, echoed)
    // Control keys must NOT appear in the merged payload.
    fireEvent.click(screen.getByTestId("radio-conflict-theirs-label"));
    fireEvent.click(screen.getByTestId("button-conflict-apply"));

    expect(onApply).toHaveBeenCalledTimes(1);
    const merged = onApply.mock.calls[0][0] as Record<string, unknown>;
    expect(merged.label).toBe("Server label");
    expect(merged.unitCost).toBe("12.50");
    expect(merged.costCodeId).toBe("cc-shared");
    expect(merged.expectedVersion).toBeUndefined();
    expect(merged.forceOverwrite).toBeUndefined();
  });

  it("shows the no-diff state when the pending edit matches the server row", () => {
    const conflict = buildConflict({
      pendingEdit: {
        label: "Server label",
        unitCost: "10.00",
        costCodeId: "cc-shared",
      },
    });
    render(
      <MeasurementConflictDialog
        conflict={conflict}
        onDismiss={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId("text-conflict-no-diff")).toBeTruthy();
    // Both shortcut buttons should be disabled when there's nothing to merge.
    expect((screen.getByTestId("button-conflict-select-all-theirs") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("button-conflict-select-all-mine") as HTMLButtonElement).disabled).toBe(true);
  });
});
