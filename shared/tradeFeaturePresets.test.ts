/**
 * Task #1292 — unit coverage for the preset-drift detection helpers added in
 * Task #1271. A regression in any of these (preset map shuffled, Hamming
 * distance off-by-one, diff entry forgotten) would silently re-introduce the
 * misleading "No trade preset has been applied" message for legacy orgs.
 */
import { describe, it, expect } from "vitest";
import {
  findClosestPreset,
  diffFlagsAgainstPreset,
  getFeaturePresetForTrade,
  hasExplicitPresetForTrade,
} from "./tradeFeaturePresets";
import { FEATURE_FLAG_KEYS, type FeatureFlagKey } from "./schema/features";

describe("findClosestPreset", () => {
  it("returns an exact match (distance 0, exact=true) when flags equal a preset", () => {
    const preset = getFeaturePresetForTrade("GENERAL_CONTRACTOR");
    const match = findClosestPreset(preset);
    expect(match).not.toBeNull();
    expect(match!.tradeType).toBe("GENERAL_CONTRACTOR");
    expect(match!.distance).toBe(0);
    expect(match!.exact).toBe(true);
  });

  it("detects single-flag drift with distance 1 and exact=false", () => {
    const preset = getFeaturePresetForTrade("GENERAL_CONTRACTOR");
    const flipKey = FEATURE_FLAG_KEYS[0];
    const drifted: Partial<Record<FeatureFlagKey, boolean>> = {
      ...preset,
      [flipKey]: !preset[flipKey],
    };
    const match = findClosestPreset(drifted);
    expect(match).not.toBeNull();
    expect(match!.tradeType).toBe("GENERAL_CONTRACTOR");
    expect(match!.distance).toBe(1);
    expect(match!.exact).toBe(false);
  });

  it("uses preferredTradeType to break ties between presets with identical flag sets", () => {
    // ROOFING, CONCRETE, MASONRY, etc. all share SPECIALTY_TRADE_PRESET, and
    // ELECTRICAL/PLUMBING/HVAC's TECH_TRADE_PRESET is structurally identical,
    // so an exact match against this flag set has many tied winners.
    const sharedPreset = getFeaturePresetForTrade("MASONRY");

    // Without a preference, the first preset encountered in insertion order
    // wins deterministically (ELECTRICAL precedes the SPECIALTY entries).
    const noPref = findClosestPreset(sharedPreset);
    expect(noPref).not.toBeNull();
    expect(noPref!.distance).toBe(0);

    // With a preference for MASONRY (which has an explicit preset and ties
    // for closest), the org's own trade wins the tie.
    const withPref = findClosestPreset(sharedPreset, "MASONRY");
    expect(withPref).not.toBeNull();
    expect(withPref!.tradeType).toBe("MASONRY");
    expect(withPref!.distance).toBe(0);
    expect(withPref!.exact).toBe(true);
  });

  it("still returns a deterministic winner when the preferredTradeType has no explicit preset", () => {
    expect(hasExplicitPresetForTrade("__NOT_A_REAL_TRADE__")).toBe(false);
    const preset = getFeaturePresetForTrade("GENERAL_CONTRACTOR");
    const match = findClosestPreset(preset, "__NOT_A_REAL_TRADE__");
    expect(match).not.toBeNull();
    // The unknown preferred trade can't win the tie-break, so the regular
    // insertion-order winner (the exact GENERAL_CONTRACTOR match) is returned.
    expect(match!.tradeType).toBe("GENERAL_CONTRACTOR");
    expect(match!.distance).toBe(0);
  });
});

describe("diffFlagsAgainstPreset", () => {
  it("returns an empty diff when flags exactly match the preset", () => {
    const preset = getFeaturePresetForTrade("ROADWAY_CONSTRUCTION");
    expect(diffFlagsAgainstPreset(preset, preset)).toEqual([]);
  });

  it("returns one entry per drifted flag with current vs preset values", () => {
    const preset = getFeaturePresetForTrade("ROADWAY_CONSTRUCTION");
    const flipA = FEATURE_FLAG_KEYS[0];
    const flipB = FEATURE_FLAG_KEYS[FEATURE_FLAG_KEYS.length - 1];
    const drifted: Partial<Record<FeatureFlagKey, boolean>> = {
      ...preset,
      [flipA]: !preset[flipA],
      [flipB]: !preset[flipB],
    };

    const diff = diffFlagsAgainstPreset(drifted, preset);
    expect(diff).toHaveLength(2);
    const byKey = new Map(diff.map((d) => [d.key, d]));
    expect(byKey.get(flipA)).toEqual({
      key: flipA,
      current: !preset[flipA],
      preset: preset[flipA],
    });
    expect(byKey.get(flipB)).toEqual({
      key: flipB,
      current: !preset[flipB],
      preset: preset[flipB],
    });
  });

  it("treats missing keys in the flag map as false when diffing", () => {
    const preset = getFeaturePresetForTrade("GENERAL_CONTRACTOR");
    // Empty flag map → every preset key that is `true` should appear as a
    // diff entry (current=false, preset=true).
    const diff = diffFlagsAgainstPreset({}, preset);
    const expectedCount = FEATURE_FLAG_KEYS.filter((k) => preset[k]).length;
    expect(diff).toHaveLength(expectedCount);
    for (const entry of diff) {
      expect(entry.current).toBe(false);
      expect(entry.preset).toBe(true);
    }
  });
});
