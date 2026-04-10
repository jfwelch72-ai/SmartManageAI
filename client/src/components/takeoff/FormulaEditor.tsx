import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle } from "lucide-react";
import { evaluateFormula, FORMULA_HELP, type FormulaContext } from "@shared/utils/assemblyFormula";

interface FormulaEditorProps {
  formula: string;
  onChange: (formula: string) => void;
  measurementType: string;
}

const SAMPLE_CONTEXTS: Record<string, FormulaContext> = {
  LINEAR: { length: 100, area: 0, volume: 0, count: 0, depth: 0 },
  AREA: { length: 0, area: 500, volume: 0, count: 0, depth: 0 },
  VOLUME: { length: 0, area: 0, volume: 10, count: 0, depth: 4 },
  COUNT: { length: 0, area: 0, volume: 0, count: 12, depth: 0 },
};

export function FormulaEditor({ formula, onChange, measurementType }: FormulaEditorProps) {
  const [showHelp, setShowHelp] = useState(false);

  const sampleCtx = SAMPLE_CONTEXTS[measurementType] || SAMPLE_CONTEXTS.LINEAR;
  const preview = formula.trim() ? evaluateFormula(formula, sampleCtx) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Formula (optional)</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowHelp(!showHelp)} data-testid="button-formula-help">
              <HelpCircle className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-[240px]">
            <p className="text-xs">Variables: length, area, volume, count, depth. Functions: ceil(), floor(), round(), abs(), max(), min(), sqrt(), pow(). Operators: +, -, *, /</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <Input
        value={formula}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. area * 1.10"
        className="font-mono text-xs"
        data-testid="input-formula"
      />
      {preview !== null && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Preview:</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 h-4 font-mono">{preview.toFixed(2)}</Badge>
          <span className="italic">(sample input)</span>
        </div>
      )}
      {showHelp && (
        <div className="border rounded-md p-2 space-y-1 bg-muted/30">
          <p className="text-[10px] font-semibold">Formula Examples:</p>
          {FORMULA_HELP.map((h, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-[10px] cursor-pointer hover:bg-muted/50 p-1 rounded"
              onClick={() => { onChange(h.example); setShowHelp(false); }}
            >
              <code className="bg-background px-1 rounded font-mono shrink-0">{h.example}</code>
              <span className="text-muted-foreground truncate">{h.desc}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
