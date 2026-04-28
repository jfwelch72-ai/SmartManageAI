/**
 * Task #2204 — Lock down `canonicalTool()`'s aliasing table.
 *
 * The unified ribbon exposes several "intent" buttons (lasso, polygon,
 * dimension) that share their canvas semantics with another tool. The
 * draw / commit code paths read `canonicalTool(activeTool)` so that the
 * ribbon highlight stays on the user's chosen button while the
 * underlying handler dispatches via the canonical tool. Regressions in
 * this table would silently route a draw to the wrong handler — e.g. a
 * polygon close would skip the AREA mutation. These tests pin every
 * documented alias plus the contract that all other tools (incl.
 * `circle`, which is intentionally NOT aliased per the docstring) pass
 * through unchanged.
 */
import { describe, it, expect } from "vitest";
import { canonicalTool, type Tool } from "../types";

describe("Task #2204 — canonicalTool() ribbon-alias table", () => {
  it("lasso → select", () => {
    expect(canonicalTool("lasso")).toBe("select");
  });

  it("polygon → area", () => {
    expect(canonicalTool("polygon")).toBe("area");
  });

  it("dimension → linear", () => {
    expect(canonicalTool("dimension")).toBe("linear");
  });

  it("circle is NOT aliased — interaction differs from polygon (center+edge)", () => {
    // The docstring on canonicalTool explicitly preserves circle so the
    // dedicated center+radius click handler keeps firing. If a future
    // change adds `case "circle": return "area"` the click branch would
    // never run and the resulting AREA polygon would have no points.
    expect(canonicalTool("circle")).toBe("circle");
  });

  it.each<Tool>([
    "select",
    "pan",
    "calibrate",
    "linear",
    "arc",
    "area",
    "volume",
    "count",
    "note",
    "linear_with_drop",
    "pitched_area",
    "pitched_linear",
    "surface_area",
    "segment",
    "deduct",
    "typical",
    "markup_arrow",
    "markup_text",
    "markup_rectangle",
    "markup_cloud",
    "markup_highlight",
    "markup_freehand",
    "issue_pin",
  ])("non-alias tool %s passes through unchanged", (tool) => {
    expect(canonicalTool(tool)).toBe(tool);
  });

  it("is idempotent — canonicalTool(canonicalTool(x)) === canonicalTool(x)", () => {
    // A second pass through the function must never further-alias the
    // result; otherwise chained calls in the canvas controller would
    // produce surprising tool flips.
    const aliased: Tool[] = ["lasso", "polygon", "dimension"];
    for (const tool of aliased) {
      const once = canonicalTool(tool);
      expect(canonicalTool(once)).toBe(once);
    }
  });
});
