/**
 * Task #2624 — Shared post-LLM assembly application step used by the
 * single-shot (`takeoffDraft.ts`) and map-reduce (`mapReduceDraft.ts`)
 * auto-takeoff drafters.
 *
 * Each AI-emitted measurement is run through `matchAssemblyForLine`.
 * When a match is found, the measurement is annotated (in place) with
 * an `assembly` field that carries the parent driving qty, the org
 * waste factor, and the per-component bill-of-materials with both the
 * raw quantity and the waste-adjusted quantity. When no match is
 * found, the measurement is returned unchanged so flat-line behavior
 * remains the fallback.
 *
 * The matcher / explosion is best-effort: any thrown error is logged
 * and the original measurement is preserved.
 */

import { matchAssemblyForLine } from "./assemblies";
import { buildExpansionFromValue, type AssemblyExpansion } from "./explodeAssembly";
import { logError } from "../../utils/logger";

export interface DraftLineForAssembly {
  label: string;
  type: string;
  value: number;
  unit: string;
  costCode?: string | null;
  tradeType?: string | null;
  assembly?: AssemblyExpansion | null;
}

export async function applyAssembliesToDraftLines<
  T extends DraftLineForAssembly,
>(opts: {
  organizationId: string;
  lines: T[];
  tradeType?: string | null;
}): Promise<T[]> {
  if (!Array.isArray(opts.lines) || opts.lines.length === 0) return opts.lines;
  for (const line of opts.lines) {
    if (line.assembly) continue;
    try {
      const assembly = await matchAssemblyForLine({
        organizationId: opts.organizationId,
        line: {
          label: line.label,
          type: line.type,
          unit: line.unit,
          costCode: line.costCode ?? null,
          tradeType: line.tradeType ?? opts.tradeType ?? null,
        },
      });
      if (!assembly) continue;
      const expansion = buildExpansionFromValue({
        assembly,
        components: assembly.components,
        drivingQty: Number(line.value || 0),
      });
      line.assembly = expansion;
    } catch (err) {
      logError(
        "[applyAssembliesToDraft] non-fatal failure",
        { organizationId: opts.organizationId, label: line.label },
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  }
  return opts.lines;
}
