import { describe, it, expect } from "vitest";
import { diffCatalogs, type AgencyCatalog } from "../../scripts/fetch-dot-pay-items";

function makeCatalog(items: Array<[string, string, string]>): AgencyCatalog {
  return {
    specBook: { edition: "2024", title: "Test" },
    source: "https://example.test/",
    items: items.map(([itemNumber, description, unit]) => ({
      itemNumber,
      description,
      unit,
      specSection: itemNumber.split("-")[0] ?? "",
      category: "Standard",
    })),
  };
}

describe("diffCatalogs", () => {
  it("treats every item as added when no previous catalog exists", () => {
    const next = makeCatalog([
      ["100-1", "Mobilization", "LS"],
      ["100-2", "Clearing", "AC"],
    ]);
    const delta = diffCatalogs(null, next);
    expect(delta).toEqual({ added: 2, removed: 0, changed: 0, prevCount: 0, nextCount: 2 });
  });

  it("counts purely-added items without flagging unchanged rows", () => {
    const prev = makeCatalog([
      ["100-1", "Mobilization", "LS"],
      ["100-2", "Clearing", "AC"],
    ]);
    const next = makeCatalog([
      ["100-1", "Mobilization", "LS"],
      ["100-2", "Clearing", "AC"],
      ["100-3", "Grubbing", "AC"],
    ]);
    expect(diffCatalogs(prev, next)).toEqual({
      added: 1,
      removed: 0,
      changed: 0,
      prevCount: 2,
      nextCount: 3,
    });
  });

  it("counts removed items by item-number disappearing from next", () => {
    const prev = makeCatalog([
      ["100-1", "Mobilization", "LS"],
      ["100-2", "Clearing", "AC"],
      ["999-9", "Discontinued", "EA"],
    ]);
    const next = makeCatalog([
      ["100-1", "Mobilization", "LS"],
      ["100-2", "Clearing", "AC"],
    ]);
    expect(diffCatalogs(prev, next)).toEqual({
      added: 0,
      removed: 1,
      changed: 0,
      prevCount: 3,
      nextCount: 2,
    });
  });

  it("flags description and unit edits as changed (not added)", () => {
    const prev = makeCatalog([
      ["100-1", "Mobilization", "LS"],
      ["100-2", "Clearing", "AC"],
    ]);
    const next = makeCatalog([
      ["100-1", "Mobilization (revised)", "LS"], // description change
      ["100-2", "Clearing", "HA"], // unit change
    ]);
    expect(diffCatalogs(prev, next)).toEqual({
      added: 0,
      removed: 0,
      changed: 2,
      prevCount: 2,
      nextCount: 2,
    });
  });

  it("does not double-count rows that were both added and changed", () => {
    const prev = makeCatalog([["100-1", "Mobilization", "LS"]]);
    const next = makeCatalog([
      ["100-1", "Mobilization (revised)", "LS"], // changed
      ["100-2", "Clearing", "AC"], // added
    ]);
    expect(diffCatalogs(prev, next)).toEqual({
      added: 1,
      removed: 0,
      changed: 1,
      prevCount: 1,
      nextCount: 2,
    });
  });
});
