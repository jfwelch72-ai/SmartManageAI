import { Info } from "lucide-react";

export interface FormulaBreakdownStep {
  label: string;
  value: string;
  calculation?: string;
}

export interface FormulaBreakdownProps {
  formula: string;
  steps: FormulaBreakdownStep[];
  result: number;
  resultUnit: string;
  testId?: string;
}

/**
 * Shared step-by-step formula breakdown panel.
 *
 * Used by every material section in MaterialCalculator (concrete, stone,
 * excavation, wire mesh, rebar, dowels, sealer, underlayment) to display the
 * derivation behind a calculated quantity in the same visual style as the
 * curb / concrete calculator. The component is presentational only — callers
 * compute the steps and pass them in.
 */
export function FormulaBreakdown({
  formula,
  steps,
  result,
  resultUnit,
  testId = "formula-breakdown",
}: FormulaBreakdownProps) {
  return (
    <div
      className="mt-2 p-3 bg-muted/50 rounded-md border border-muted text-xs space-y-2"
      data-testid={testId}
    >
      <div className="flex items-center gap-2 font-medium text-muted-foreground">
        <Info className="h-3 w-3" />
        <span>Calculation Formula</span>
      </div>
      <div className="font-mono bg-background p-2 rounded border text-xs overflow-x-auto">
        {formula}
      </div>
      <div className="space-y-1">
        <p className="text-muted-foreground font-medium">Step-by-Step:</p>
        {steps.map((step, i) => (
          <div
            key={i}
            className="flex justify-between items-center py-1 border-b border-muted last:border-0"
          >
            <span className="text-muted-foreground">{step.label}</span>
            <span className="font-mono">
              {step.calculation && (
                <span className="text-muted-foreground mr-2">
                  {step.calculation} =
                </span>
              )}
              {step.value}
            </span>
          </div>
        ))}
        <div className="flex justify-between items-center py-1 font-medium bg-primary/5 px-2 rounded">
          <span>Final Result</span>
          <span className="font-mono">
            {result.toFixed(2)} {resultUnit}
          </span>
        </div>
      </div>
    </div>
  );
}

export default FormulaBreakdown;
