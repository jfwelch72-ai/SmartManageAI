/**
 * Server-side re-export of the shared material formula breakdown helper.
 *
 * The implementation lives in `shared/materialFormulaBreakdown.ts` so the
 * estimate PDF exporter (which imports from here) and the on-screen
 * MaterialCalculator (which imports `@shared/materialFormulaBreakdown`
 * directly) both consume the exact same builder functions — no risk of
 * the PDF and the screen drifting out of sync if someone tweaks a
 * formula. See that file for the canonical implementation and the
 * test in `server/__tests__/materialFormulaBreakdown.test.ts` that
 * pins it to `calculateMaterials`.
 */
export {
  buildLineItemFormulaBreakdowns,
  STONE_DENSITIES_TONS_PER_CY,
  type FormulaBlock,
  type FormulaStep,
  type LineItemFormulaInputs,
} from "@shared/materialFormulaBreakdown";
