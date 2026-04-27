// @vitest-environment jsdom
//
// Task #2118 — Persist the "include step-by-step formula breakdowns"
// toggle for the estimate PDF / Excel exports. These tests pin the
// localStorage round-trip and the cross-instance sync so estimators
// don't have to re-flip the switch on every export.

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useExportIncludeFormulas } from "../use-export-include-formulas";

const STORAGE_KEY = "estimate-export:include-formulas";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("useExportIncludeFormulas", () => {
  it("defaults to false for first-time users with nothing in storage", () => {
    const { result } = renderHook(() => useExportIncludeFormulas());
    expect(result.current[0]).toBe(false);
  });

  it("hydrates initial state from a previously stored 'true'", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    const { result } = renderHook(() => useExportIncludeFormulas());
    expect(result.current[0]).toBe(true);
  });

  it("writes the new value to localStorage when toggled on", () => {
    const { result } = renderHook(() => useExportIncludeFormulas());

    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("writes 'false' (not removes) when toggled back off", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    const { result } = renderHook(() => useExportIncludeFormulas());

    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
  });

  it("keeps two mounted instances in sync within the same tab", () => {
    // Mirrors the real layout where the PDF and Excel popovers are mounted
    // side by side in the estimate header — toggling one should update the
    // other immediately, not just on next page load.
    const a = renderHook(() => useExportIncludeFormulas());
    const b = renderHook(() => useExportIncludeFormulas());

    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);

    act(() => a.result.current[1](true));

    expect(a.result.current[0]).toBe(true);
    expect(b.result.current[0]).toBe(true);
  });
});
