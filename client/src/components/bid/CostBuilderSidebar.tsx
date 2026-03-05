import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Check, ChevronRight, FileText, Package, Truck, Users, Calculator } from "lucide-react";

type CostBuilderStep = 1 | 2 | 3 | 4 | 5;

interface StepDef {
  id: number;
  name: string;
  icon: any;
  cost: number;
}

interface CostBuilderSidebarProps {
  currentStep: CostBuilderStep;
  onStepChange: (step: CostBuilderStep) => void;
  steps: StepDef[];
  stepStatus: Record<number, boolean>;
  directCost: number;
  overheadPercent: number;
  overheadAmount: number;
  profitPercent: number;
  profitAmount: number;
  finalBidAmount: number;
}

export default function CostBuilderSidebar({
  currentStep,
  onStepChange,
  steps,
  stepStatus,
  directCost,
  overheadPercent,
  overheadAmount,
  profitPercent,
  profitAmount,
  finalBidAmount,
}: CostBuilderSidebarProps) {
  return (
    <div className="w-72 flex-shrink-0">
      <Card className="sticky top-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Cost Builder</CardTitle>
          <CardDescription>Build your bid step by step</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <nav className="flex flex-col">
            {steps.map((step) => {
              const StepIcon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = stepStatus[step.id];

              return (
                <button
                  key={step.id}
                  onClick={() => onStepChange(step.id as CostBuilderStep)}
                  className={`flex items-center gap-3 px-4 py-3 text-left border-l-2 transition-colors ${
                    isActive
                      ? 'border-l-primary bg-primary/5 text-foreground'
                      : 'border-l-transparent hover:bg-muted/50 text-muted-foreground'
                  }`}
                  data-testid={`step-${step.id}`}
                >
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isCompleted
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                  }`}>
                    {isCompleted && !isActive ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <StepIcon className="w-4 h-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isActive ? 'text-foreground' : ''}`}>
                      {step.name}
                    </p>
                    {step.cost > 0 && (
                      <p className="text-xs font-mono text-muted-foreground">
                        ${step.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    )}
                  </div>
                  {isActive && (
                    <ChevronRight className="w-4 h-4 text-primary" />
                  )}
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Direct Cost</span>
              <span className="font-mono text-sm">${directCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">+ Overhead ({overheadPercent}%)</span>
              <span className="font-mono text-sm">${overheadAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">+ Profit ({profitPercent}%)</span>
              <span className="font-mono text-sm text-green-600 dark:text-green-400">${profitAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-sm font-semibold">Final Bid</span>
              <span className="font-mono font-bold text-lg">${finalBidAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
