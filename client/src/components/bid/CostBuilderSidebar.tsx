import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check } from "lucide-react";

type CostBuilderStep = 1 | 2 | 3 | 4 | 5 | 6;

interface StepDef {
  id: number;
  name: string;
  icon: any;
  cost: number;
}

interface StepProgress {
  current: number;
  total: number;
  label: string;
}

interface CostBuilderSidebarProps {
  currentStep: CostBuilderStep;
  onStepChange: (step: CostBuilderStep) => void;
  steps: StepDef[];
  stepStatus: Record<number, boolean>;
  stepProgress?: Record<number, StepProgress>;
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
  stepProgress,
  directCost,
  overheadPercent,
  overheadAmount,
  profitPercent,
  profitAmount,
  finalBidAmount,
}: CostBuilderSidebarProps) {
  const activeStep = steps.find(s => s.id === currentStep);
  const ActiveIcon = activeStep?.icon;

  return (
    <Card className="w-full">
      <CardContent className="p-0">
        <div className="flex flex-col lg:flex-row lg:items-stretch">
          <div className="sm:hidden p-2">
            <Select
              value={String(currentStep)}
              onValueChange={(v) => onStepChange(Number(v) as CostBuilderStep)}
            >
              <SelectTrigger className="w-full" data-testid="select-mobile-step">
                <div className="flex items-center gap-2">
                  {ActiveIcon && (
                    <div className="flex items-center justify-center w-6 h-6 rounded-full shrink-0 bg-primary text-primary-foreground">
                      <ActiveIcon className="w-3 h-3" />
                    </div>
                  )}
                  <span className="text-sm font-medium truncate">
                    {activeStep?.name}
                    {activeStep && activeStep.cost > 0 && (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        ${activeStep.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </span>
                </div>
              </SelectTrigger>
              <SelectContent>
                {steps.map((step) => {
                  const StepIcon = step.icon;
                  const isCompleted = stepStatus[step.id];
                  return (
                    <SelectItem
                      key={step.id}
                      value={String(step.id)}
                      data-testid={`select-mobile-step-${step.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center justify-center w-5 h-5 rounded-full shrink-0 ${
                          isCompleted
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {isCompleted ? (
                            <Check className="w-3 h-3" />
                          ) : (
                            <StepIcon className="w-3 h-3" />
                          )}
                        </div>
                        <span className="text-sm">{step.name}</span>
                        {step.cost > 0 && (
                          <span className="font-mono text-xs text-muted-foreground">
                            ${step.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <nav className="hidden sm:flex flex-row flex-wrap flex-1 min-w-0">
            {steps.map((step) => {
              const StepIcon = step.icon;
              const isActive = currentStep === step.id;
              const isCompleted = stepStatus[step.id];

              return (
                <button
                  key={step.id}
                  onClick={() => onStepChange(step.id as CostBuilderStep)}
                  className={`flex items-center gap-2 px-3 py-2.5 text-left border-b-2 lg:border-b-2 lg:border-l-0 transition-colors flex-1 min-w-[120px] ${
                    isActive
                      ? 'border-b-primary bg-primary/5 text-foreground'
                      : 'border-b-transparent hover:bg-muted/50 text-muted-foreground'
                  }`}
                  data-testid={`step-${step.id}`}
                >
                  <div className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isCompleted
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-muted text-muted-foreground'
                  }`}>
                    {isCompleted && !isActive ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <StepIcon className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium truncate ${isActive ? 'text-foreground' : ''}`}>
                      {step.name}
                    </p>
                    {stepProgress?.[step.id] ? (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden min-w-[30px] max-w-[50px]">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${stepProgress[step.id].total > 0 ? Math.min(100, (stepProgress[step.id].current / stepProgress[step.id].total) * 100) : 0}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {stepProgress[step.id].current}/{stepProgress[step.id].total} {stepProgress[step.id].label}
                        </span>
                      </div>
                    ) : step.cost > 0 ? (
                      <p className="text-[10px] font-mono text-muted-foreground">
                        ${step.cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </nav>

          <div className="flex flex-col items-start gap-1 px-3 sm:px-4 py-2 sm:py-2.5 border-t lg:border-t-0 lg:border-l bg-muted/30 shrink-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Direct Cost</span>
              <span className="font-mono text-xs font-medium">${directCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">+ Overhead ({overheadPercent}%)</span>
              <span className="font-mono text-xs">${overheadAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">+ Profit ({profitPercent}%)</span>
              <span className="font-mono text-xs text-green-600 dark:text-green-400">${profitAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center gap-1.5 pl-2 border-l">
              <span className="text-xs font-semibold">Final Bid</span>
              <span className="font-mono font-bold text-sm">${finalBidAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
