/**
 * Task #1768 — Unit coverage for `buildMarkupFailureSummary` /
 * `describeMarkup`. The helpers translate a failed markup-move PATCH
 * into a user-facing toast description plus the set of markup ids the
 * canvas should flash. Failure modes covered here are exactly the
 * shapes the server emits from `/api/takeoff/markups/bulk` and the
 * single-markup PATCH:
 *   - structured `reason` + `failedMarkupIds` (per-mode wording)
 *   - missing structured fields (network / 5xx fallback that still
 *     surfaces the raw server message and the attempted ids)
 *   - the per-reason "and N more" overflow once a batch passes the
 *     naming budget (so a 50-markup failure doesn't paste a wall of
 *     text into the toast)
 */
import { describe, it, expect } from "vitest";
import {
  buildMarkupFailureSummary,
  describeMarkup,
} from "../markup-failure-helpers";

function makeError(status: number, body: any): Error & { status?: number; data?: any } {
  const err: Error & { status?: number; data?: any } = new Error(body?.error ?? "boom");
  err.status = status;
  err.data = body;
  return err;
}

describe("describeMarkup", () => {
  it("uses the markup text in quotes when present", () => {
    expect(describeMarkup({ id: "abc123def", tool: "TEXT", text: "Header" })).toBe('"Header"');
  });

  it("truncates long text labels", () => {
    const long = "x".repeat(100);
    const out = describeMarkup({ id: "abc", tool: "TEXT", text: long });
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('…"')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(34);
  });

  it("falls back to <Tool> <id-prefix> when the markup has no text", () => {
    expect(describeMarkup({ id: "abc123def-456", tool: "RECTANGLE", text: null })).toBe("Rectangle abc123");
  });

  it("falls back to a generic Markup label when the tool is unknown", () => {
    expect(describeMarkup({ id: "id-9", tool: undefined, text: "" })).toBe("Markup id-9");
  });
});

describe("buildMarkupFailureSummary", () => {
  const markups = [
    { id: "m-aaa111", tool: "TEXT", text: "Note Header" },
    { id: "m-bbb222", tool: "RECTANGLE", text: null },
    { id: "m-ccc333", tool: "ARROW", text: null },
    { id: "m-ddd444", tool: "CLOUD", text: null },
  ];

  it("names the deleted markup and uses the not_found phrasing", () => {
    const summary = buildMarkupFailureSummary({
      error: makeError(404, {
        error: "Some markups could not be moved because they no longer exist",
        reason: "not_found",
        failedMarkupIds: ["m-aaa111"],
      }),
      attemptedMarkupIds: ["m-aaa111", "m-bbb222"],
      markups,
    });
    expect(summary.reason).toBe("not_found");
    expect(summary.failedMarkupIds).toEqual(["m-aaa111"]);
    expect(summary.title).toBe("Markup could not be moved");
    expect(summary.description).toContain('"Note Header"');
    expect(summary.description).toContain("no longer exists");
    expect(summary.description).toContain("rolled back");
  });

  it("uses 'X markups could not be moved' once more than one failed", () => {
    const summary = buildMarkupFailureSummary({
      error: makeError(403, {
        error: "Some markups belong to another organization",
        reason: "access_denied",
        failedMarkupIds: ["m-bbb222", "m-ccc333"],
      }),
      attemptedMarkupIds: ["m-aaa111", "m-bbb222", "m-ccc333"],
      markups,
    });
    expect(summary.reason).toBe("access_denied");
    expect(summary.failedMarkupIds).toEqual(["m-bbb222", "m-ccc333"]);
    expect(summary.title).toBe("2 markups could not be moved");
    expect(summary.description).toContain("Rectangle m-bbb2");
    expect(summary.description).toContain("Arrow m-ccc3");
    expect(summary.description).toContain("belongs to another organization");
  });

  it("collapses overflow past the naming budget into 'and N more'", () => {
    const failedIds = Array.from({ length: 7 }, (_, i) => `m-x${i}`);
    const summary = buildMarkupFailureSummary({
      error: makeError(404, {
        error: "Some markups could not be moved because they no longer exist",
        reason: "not_found",
        failedMarkupIds: failedIds,
      }),
      attemptedMarkupIds: failedIds,
      markups: failedIds.map((id) => ({ id, tool: "RECTANGLE", text: null })),
    });
    expect(summary.failedMarkupIds).toHaveLength(7);
    expect(summary.title).toBe("7 markups could not be moved");
    // Helper should have named only the first 3 and rolled the rest
    // into a single "and 4 more" suffix instead of pasting all 7.
    expect(summary.description).toContain("and 4 more");
    // The 4th id MUST NOT appear — that's the whole point of the
    // overflow collapse.
    expect(summary.description).not.toContain("m-x3");
  });

  it("uses the cross_sheet phrasing", () => {
    const summary = buildMarkupFailureSummary({
      error: makeError(400, {
        error: "Some markups belong to a different sheet",
        reason: "cross_sheet",
        failedMarkupIds: ["m-bbb222"],
      }),
      attemptedMarkupIds: ["m-aaa111", "m-bbb222"],
      markups,
    });
    expect(summary.reason).toBe("cross_sheet");
    expect(summary.description).toContain("different sheet");
  });

  it("uses the not_owner phrasing and mentions the manager exception", () => {
    const summary = buildMarkupFailureSummary({
      error: makeError(403, {
        error: "Some markups were created by another user",
        reason: "not_owner",
        failedMarkupIds: ["m-ccc333"],
      }),
      attemptedMarkupIds: ["m-ccc333"],
      markups,
    });
    expect(summary.reason).toBe("not_owner");
    expect(summary.description).toContain("created by another user");
    expect(summary.description).toContain("manager");
  });

  it("falls back to the raw server message when no structured reason is present", () => {
    // Network failure — `apiRequest` rejects with `Error("network down")`
    // and no `data`/`status`. The helper must still produce a
    // useful description that names the attempted markups instead
    // of the legacy "Failed to update markups".
    const summary = buildMarkupFailureSummary({
      error: new Error("network down"),
      attemptedMarkupIds: ["m-aaa111", "m-bbb222"],
      markups,
    });
    expect(summary.reason).toBe("unknown");
    expect(summary.failedMarkupIds).toEqual(["m-aaa111", "m-bbb222"]);
    expect(summary.title).toBe("2 markups could not be moved");
    expect(summary.description).toContain("network down");
    expect(summary.description).toContain('"Note Header"');
    expect(summary.description).toContain("Rectangle m-bbb2");
    expect(summary.description).toContain("rolled back");
  });

  it("surfaces every reason in a mixed-reason batch instead of just the first", () => {
    // Task #1768 — When a single bulk PATCH trips multiple distinct
    // causes (some markups belong to a different sheet AND another
    // was authored by someone else), the toast must call out each
    // cause separately so the user knows which siblings to release
    // and which to ask the author to move. The legacy single-reason
    // path used to drop everything but the first bucket on the floor.
    const summary = buildMarkupFailureSummary({
      error: makeError(403, {
        error: "Some markups belong to a different sheet; some were authored by another user",
        reason: "not_owner",
        failedMarkupIds: ["m-bbb222", "m-ccc333", "m-ddd444"],
        failuresByReason: [
          {
            reason: "cross_sheet",
            failedMarkupIds: ["m-bbb222"],
            message: "Some markups belong to a different sheet",
          },
          {
            reason: "not_owner",
            failedMarkupIds: ["m-ccc333", "m-ddd444"],
            message: "Some markups were authored by another user",
          },
        ],
      }),
      attemptedMarkupIds: ["m-aaa111", "m-bbb222", "m-ccc333", "m-ddd444"],
      markups,
    });

    // Both reasons appear in the description, each with its own
    // named markup(s).
    expect(summary.description).toContain("Rectangle m-bbb2");
    expect(summary.description).toContain("different sheet");
    expect(summary.description).toContain("Arrow m-ccc3");
    expect(summary.description).toContain("Cloud m-ddd4");
    expect(summary.description).toContain("created by another user");
    expect(summary.description).toContain("rolled back");

    // The flat `failedMarkupIds` is the union of both groups so the
    // canvas can flash all three at once.
    expect(summary.failedMarkupIds).toEqual(
      expect.arrayContaining(["m-bbb222", "m-ccc333", "m-ddd444"]),
    );
    expect(summary.failedMarkupIds).toHaveLength(3);

    // `groups` exposes the per-reason breakdown for follow-up UI
    // (e.g. a "Select cross-sheet failures" action).
    expect(summary.groups).toHaveLength(2);
    expect(summary.groups[0].reason).toBe("cross_sheet");
    expect(summary.groups[0].failedMarkupIds).toEqual(["m-bbb222"]);
    expect(summary.groups[1].reason).toBe("not_owner");
    expect(summary.groups[1].failedMarkupIds).toEqual(["m-ccc333", "m-ddd444"]);

    // Title still reports the total and `reason` exposes the dominant
    // group so single-value telemetry/log fields stay consistent.
    expect(summary.title).toBe("3 markups could not be moved");
    expect(summary.reason).toBe("not_owner");
  });

  it("falls back to legacy single-reason shape when failuresByReason is absent", () => {
    // Older server build / partial deploy: the response only carries
    // the legacy `reason` + flat `failedMarkupIds`. The helper should
    // synthesize a single-entry `groups` array so callers don't need
    // a separate code path for old clients.
    const summary = buildMarkupFailureSummary({
      error: makeError(404, {
        error: "Some markups could not be moved",
        reason: "not_found",
        failedMarkupIds: ["m-aaa111"],
      }),
      attemptedMarkupIds: ["m-aaa111"],
      markups,
    });
    expect(summary.groups).toHaveLength(1);
    expect(summary.groups[0].reason).toBe("not_found");
    expect(summary.groups[0].failedMarkupIds).toEqual(["m-aaa111"]);
    expect(summary.reason).toBe("not_found");
  });

  it("ignores unknown reason strings the server might emit later", () => {
    const summary = buildMarkupFailureSummary({
      error: makeError(500, {
        error: "Something exploded",
        reason: "version_locked",
        failedMarkupIds: ["m-aaa111"],
      }),
      attemptedMarkupIds: ["m-aaa111"],
      markups,
    });
    expect(summary.reason).toBe("unknown");
    // The unknown branch keeps the server's raw error message so a
    // forward-incompatible reason still surfaces something to the
    // user instead of being mistranslated.
    expect(summary.description).toContain("Something exploded");
    expect(summary.description).toContain("HTTP 500");
  });
});
