// Fixture loader + lightweight schema validator for the AI takeoff
// regression bench. Throws a descriptive error when a fixture is
// malformed so the runner fails loud instead of silently scoring zero.

import fs from "node:fs";
import path from "node:path";

const ALLOWED_TYPES = new Set(["AREA", "LINEAR", "COUNT", "VOLUME", "ANGULAR", "DIAMETER"]);

function assert(cond, msg) {
  if (!cond) throw new Error(`[fixtures] ${msg}`);
}

function validateMeasurement(m, ctx) {
  assert(m && typeof m === "object", `${ctx}: measurement must be an object`);
  assert(typeof m.label === "string" && m.label.trim().length > 0, `${ctx}: label required`);
  assert(ALLOWED_TYPES.has(m.type), `${ctx}: type must be one of ${[...ALLOWED_TYPES].join(",")}`);
  assert(typeof m.unit === "string" && m.unit.trim().length > 0, `${ctx}: unit required`);
  assert(typeof m.value === "number" && Number.isFinite(m.value), `${ctx}: numeric value required`);
}

export function validateFixture(fx, sourcePath) {
  const ctx = path.basename(sourcePath);
  assert(fx && typeof fx === "object", `${ctx}: fixture must be an object`);
  assert(fx.meta && typeof fx.meta.id === "string", `${ctx}: meta.id required`);
  assert(Array.isArray(fx.meta.tradesCovered) && fx.meta.tradesCovered.length > 0,
    `${ctx}: meta.tradesCovered required`);
  assert(["smoke", "full"].includes(fx.meta.subset), `${ctx}: meta.subset must be smoke|full`);
  assert(Array.isArray(fx.expected) && fx.expected.length > 0, `${ctx}: expected[] required`);
  fx.expected.forEach((m, i) => validateMeasurement(m, `${ctx}.expected[${i}]`));
  assert(fx.replay && Array.isArray(fx.replay.batches), `${ctx}: replay.batches[] required`);
  fx.replay.batches.forEach((b, i) => {
    assert(typeof b.discipline === "string", `${ctx}.replay.batches[${i}]: discipline required`);
    assert(Array.isArray(b.measurements), `${ctx}.replay.batches[${i}]: measurements[] required`);
    b.measurements.forEach((m, j) => validateMeasurement(m, `${ctx}.replay.batches[${i}].measurements[${j}]`));
  });
  // `live.pagesByDiscipline` is OPTIONAL — fixtures missing it are
  // skipped in `--mode=live` runs with a clear message.
  if (fx.live) {
    assert(fx.live.pagesByDiscipline && typeof fx.live.pagesByDiscipline === "object",
      `${ctx}: live.pagesByDiscipline must be an object`);
    for (const [disc, pages] of Object.entries(fx.live.pagesByDiscipline)) {
      assert(Array.isArray(pages), `${ctx}.live.pagesByDiscipline.${disc}: must be an array`);
      pages.forEach((p, i) => {
        assert(p && typeof p.sheetCitation === "string" && typeof p.text === "string",
          `${ctx}.live.pagesByDiscipline.${disc}[${i}]: { sheetCitation, text } required`);
      });
    }
  }
  return fx;
}

export function loadAllFixtures(dir) {
  const out = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const full = path.join(dir, file);
    const raw = JSON.parse(fs.readFileSync(full, "utf8"));
    out.push(validateFixture(raw, full));
  }
  out.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
  return out;
}
