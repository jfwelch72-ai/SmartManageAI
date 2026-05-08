// Helper child process: reads `{batches: [...]}` JSON from stdin, runs
// it through the real `reconcileMeasurements` from the map-reduce
// drafter, and writes `{measurements: [...]}` to stdout. Lets the
// .mjs replay provider exercise the production reconciliation logic
// without bundling tsx into every bench script.

import { reconcileMeasurements, type MapReduceMeasurement } from "../../../server/services/aiEstimator/mapReduceDraft";

interface InputBatch {
  discipline: string;
  measurements: Array<{
    label: string;
    type: MapReduceMeasurement["type"];
    value: number;
    unit: string;
    costCode?: string | null;
    rationale?: string;
    sheetCitations?: string[];
  }>;
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = JSON.parse(raw) as { batches: InputBatch[] };

  const batches = parsed.batches.map((b) => ({
    discipline: b.discipline,
    measurements: b.measurements.map<MapReduceMeasurement>((m) => ({
      label: m.label,
      type: m.type,
      value: m.value,
      unit: m.unit,
      costCode: m.costCode ?? null,
      rationale: m.rationale ?? "",
      sheetCitations: Array.isArray(m.sheetCitations) ? m.sheetCitations : [],
      contributingDisciplines: [b.discipline],
    })),
  }));

  const measurements = reconcileMeasurements(batches).map((m) => ({
    label: m.label,
    type: m.type,
    value: m.value,
    unit: m.unit,
    sheetCitations: m.sheetCitations,
    contributingDisciplines: m.contributingDisciplines,
  }));
  process.stdout.write(JSON.stringify({ measurements }));
}

main().catch((err) => {
  process.stderr.write(String(err?.stack ?? err));
  process.exit(1);
});
