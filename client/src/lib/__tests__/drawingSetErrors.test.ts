// @vitest-environment jsdom
/**
 * Task #1812 — covers the wording of the friendly toast surfaced when the
 * drawing-set pin endpoint rejects a duplicate (HTTP 409). The inline pin
 * button in the sheet list and the bulk-manage modal both rely on these
 * helpers; non-409 failures must keep their existing generic message.
 */
import { describe, it, expect } from "vitest";

import {
  isDuplicatePinError,
  pinSheetErrorDescription,
  bulkPinErrorDescription,
} from "../drawingSetErrors";

function err(status: number, message = `${status}: server error`): Error & { status?: number } {
  const e = new Error(message) as Error & { status?: number };
  e.status = status;
  return e;
}

describe("isDuplicatePinError", () => {
  it("recognises errors with status 409 (the canonical duplicate-pin shape)", () => {
    expect(isDuplicatePinError(err(409, "Sheet already in this drawing set"))).toBe(true);
  });

  it("falls back to substring matching when the status field is absent", () => {
    expect(isDuplicatePinError(new Error("Request failed with 409"))).toBe(true);
  });

  it("returns false for unrelated client/server errors", () => {
    expect(isDuplicatePinError(err(400, "Invalid input"))).toBe(false);
    expect(isDuplicatePinError(err(403, "Forbidden"))).toBe(false);
    expect(isDuplicatePinError(err(404, "Not found"))).toBe(false);
    expect(isDuplicatePinError(err(500, "boom"))).toBe(false);
    expect(isDuplicatePinError(undefined)).toBe(false);
    expect(isDuplicatePinError(null)).toBe(false);
    expect(isDuplicatePinError("plain string")).toBe(false);
  });

  it("does not treat the digits 409 inside an unrelated message as a match", () => {
    // Bare substring search would be too loose — the helper looks for a
    // word-bounded "409" so unrelated numeric IDs don't trigger the
    // duplicate-pin toast.
    expect(isDuplicatePinError(new Error("Status 4090 not handled"))).toBe(false);
  });
});

describe("pinSheetErrorDescription (inline pin toast)", () => {
  it("names both the sheet and the set when the backend returns 409", () => {
    const description = pinSheetErrorDescription(err(409), {
      sheetName: "A-101",
      setName: "IFC Set 03/15",
    });
    expect(description).toBe('"A-101" is already pinned to "IFC Set 03/15".');
  });

  it("falls back to a sheet-less phrasing when the sheet name is unknown", () => {
    const description = pinSheetErrorDescription(err(409), {
      sheetName: null,
      setName: "IFC Set 03/15",
    });
    expect(description).toBe('This sheet is already pinned to "IFC Set 03/15".');
  });

  it("falls back to a generic set reference when the set name is unknown", () => {
    const description = pinSheetErrorDescription(err(409), {
      sheetName: "A-101",
      setName: null,
    });
    expect(description).toBe('"A-101" is already pinned to this set.');
  });

  it("returns the existing generic message for non-duplicate failures", () => {
    expect(
      pinSheetErrorDescription(err(500, "boom"), { sheetName: "A-101", setName: "Set" }),
    ).toBe("Failed to pin sheet.");
    expect(
      pinSheetErrorDescription(err(403, "Forbidden"), { sheetName: "A-101", setName: "Set" }),
    ).toBe("Failed to pin sheet.");
  });
});

describe("bulkPinErrorDescription (bulk-manage modal toast)", () => {
  it("names the set when the bulk endpoint returns 409", () => {
    expect(
      bulkPinErrorDescription(err(409), { setName: "IFC Set 03/15" }),
    ).toBe('One or more selected sheets are already pinned to "IFC Set 03/15".');
  });

  it("falls back to a generic set reference when the set name is unknown", () => {
    expect(bulkPinErrorDescription(err(409), { setName: null })).toBe(
      "One or more selected sheets are already pinned to this set.",
    );
  });

  it("returns the existing generic message for non-duplicate failures", () => {
    expect(bulkPinErrorDescription(err(500), { setName: "Set" })).toBe(
      "Failed to update pinned sheets.",
    );
  });
});
