// @vitest-environment jsdom
/**
 * Task #1671 — Unit tests for the new "Cluster density" radius lookup
 * and the underlying `clusterPins` helper used by `<PlanPinLayer>`.
 *
 * These tests lock in the contract that the three discrete density
 * presets (Low / Med / High) translate to the documented screen-space
 * radii (24 / 36 / 56 px) and that the greedy clustering loop honors
 * the radius — i.e. a pair of pins that stays separate at "low"
 * density merges at "high". This is the regression net for very
 * dense punch-walks where dozens of pins share a single room.
 */
import { describe, it, expect } from "vitest";
import {
  clusterPins,
  CLUSTER_RADIUS_PX_BY_DENSITY,
  DEFAULT_CLUSTER_DENSITY,
  type PlanPin,
} from "../PlanPinLayer";

const CANVAS_W = 1000;
const CANVAS_H = 1000;

function pin(id: string, x: number, y: number): PlanPin {
  return {
    id,
    organizationId: "org-1",
    projectCode: "P1",
    planDocumentId: "doc-1",
    pageNumber: 1,
    x,
    y,
    pinType: "PUNCH",
    refTable: "punch_list_items",
    refId: "ref-" + id,
    createdById: "user-1",
    createdAt: "2026-04-24T00:00:00.000Z",
  };
}

describe("CLUSTER_RADIUS_PX_BY_DENSITY", () => {
  it("exposes 24 / 36 / 56 px for low / medium / high", () => {
    expect(CLUSTER_RADIUS_PX_BY_DENSITY.low).toBe(24);
    expect(CLUSTER_RADIUS_PX_BY_DENSITY.medium).toBe(36);
    expect(CLUSTER_RADIUS_PX_BY_DENSITY.high).toBe(56);
  });

  it("defaults to the previous fixed 36px radius (medium)", () => {
    expect(DEFAULT_CLUSTER_DENSITY).toBe("medium");
    expect(CLUSTER_RADIUS_PX_BY_DENSITY[DEFAULT_CLUSTER_DENSITY]).toBe(36);
  });
});

describe("clusterPins — radius behavior at each density", () => {
  // Two pins separated by ~30px on a 1000x1000 canvas:
  //   low   (24px) → stay singletons
  //   med   (36px) → merge into one cluster
  //   high  (56px) → merge into one cluster
  const pinsAt30px = [pin("a", 0.500, 0.500), pin("b", 0.530, 0.500)];

  it("keeps a 30px-apart pair as singletons at low density (24px)", () => {
    const out = clusterPins(pinsAt30px, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY.low);
    expect(out).toHaveLength(2);
    expect(out.every((c) => c.pins.length === 1)).toBe(true);
  });

  it("merges a 30px-apart pair at medium density (36px)", () => {
    const out = clusterPins(pinsAt30px, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY.medium);
    expect(out).toHaveLength(1);
    expect(out[0].pins).toHaveLength(2);
  });

  it("merges a 30px-apart pair at high density (56px)", () => {
    const out = clusterPins(pinsAt30px, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY.high);
    expect(out).toHaveLength(1);
    expect(out[0].pins).toHaveLength(2);
  });

  // A pair separated by ~50px:
  //   low   (24px) → singletons
  //   med   (36px) → singletons
  //   high  (56px) → merge
  // This is the “very dense punch-walk” case that motivated the task —
  // pins that overlap visually at moderate zoom but don't merge under
  // the previous fixed 36px radius now collapse under "high".
  const pinsAt50px = [pin("a", 0.500, 0.500), pin("b", 0.550, 0.500)];

  it("only merges a 50px-apart pair when density is high", () => {
    const low = clusterPins(pinsAt50px, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY.low);
    const med = clusterPins(pinsAt50px, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY.medium);
    const high = clusterPins(pinsAt50px, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY.high);
    expect(low).toHaveLength(2);
    expect(med).toHaveLength(2);
    expect(high).toHaveLength(1);
    expect(high[0].pins).toHaveLength(2);
  });

  it("keeps far-apart pins as singletons at every density", () => {
    const farPins = [pin("a", 0.10, 0.10), pin("b", 0.90, 0.90)];
    for (const d of ["low", "medium", "high"] as const) {
      const out = clusterPins(farPins, CANVAS_W, CANVAS_H, CLUSTER_RADIUS_PX_BY_DENSITY[d]);
      expect(out).toHaveLength(2);
      expect(out.every((c) => c.pins.length === 1)).toBe(true);
    }
  });

  it("falls back to per-pin singletons when canvas size is unknown", () => {
    const out = clusterPins(pinsAt30px, 0, 0, CLUSTER_RADIUS_PX_BY_DENSITY.high);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.pins.length)).toEqual([1, 1]);
  });
});
