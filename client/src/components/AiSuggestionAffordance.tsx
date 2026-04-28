import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, ThumbsDown, ThumbsUp, Check, X } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface InlineSuggestion {
  metric: "unit_cost" | "labor_hours_per_unit" | "production_rate";
  costCode: string;
  unit: string;
  point: number | null;
  range: { low: number | null; high: number | null };
  sampleSize: number;
  source: "learned_rate";
  message: string;
}

interface Props {
  costCode: string;
  metric: "unit_cost" | "labor_hours_per_unit" | "production_rate";
  unit: string;
  currentValue?: number | null;
  onApply: (value: number) => void;
  estimateId?: string;
  bidId?: string;
  enabled: boolean;
}

/**
 * Renders inline next to an estimate cell. If the org has learned-rate data
 * for this (costCode, metric, unit), shows a small "AI" pill with the median
 * and an Apply button. Captures accept/edit/reject feedback automatically.
 */
export default function AiSuggestionAffordance(props: Props) {
  const [feedbackSent, setFeedbackSent] = useState<"ACCEPTED" | "REJECTED" | null>(null);

  const suggestionQuery = useQuery<{ suggestion: InlineSuggestion | null }>({
    queryKey: ["/api/ai-estimator/suggest/inline", props.costCode, props.metric, props.unit, props.enabled],
    enabled: props.enabled && !!props.costCode && !!props.unit,
    queryFn: async () => {
      const r = await apiRequest("POST", "/api/ai-estimator/suggest/inline", {
        costCode: props.costCode,
        metric: props.metric,
        unit: props.unit,
      });
      return r.json();
    },
  });

  const sendFeedback = useMutation({
    mutationFn: async (vars: { outcome: "ACCEPTED" | "REJECTED"; finalValue?: number | null }) =>
      apiRequest("POST", "/api/ai-estimator/feedback", {
        surface:
          props.metric === "unit_cost"
            ? "inline_unit_cost"
            : props.metric === "labor_hours_per_unit"
              ? "inline_labor_hours"
              : "inline_production_rate",
        outcome: vars.outcome,
        targetType: "inline_suggestion",
        costCode: props.costCode,
        bidId: props.bidId,
        estimateId: props.estimateId,
        originalValue: props.currentValue ?? null,
        finalValue: vars.finalValue ?? null,
        rateSample:
          vars.outcome === "ACCEPTED" && vars.finalValue != null
            ? { metric: props.metric, unit: props.unit, value: vars.finalValue }
            : undefined,
      }),
  });

  if (!props.enabled) return null;
  const sug = suggestionQuery.data?.suggestion;
  if (!sug || sug.point == null) return null;

  const apply = () => {
    props.onApply(sug.point as number);
    setFeedbackSent("ACCEPTED");
    sendFeedback.mutate({ outcome: "ACCEPTED", finalValue: sug.point });
  };
  const reject = () => {
    setFeedbackSent("REJECTED");
    sendFeedback.mutate({ outcome: "REJECTED", finalValue: props.currentValue ?? null });
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary cursor-help"
            data-testid={`ai-suggestion-${props.costCode}-${props.metric}`}
          >
            <Sparkles className="h-3 w-3" />
            {sug.point.toFixed(2)}
            {feedbackSent === "ACCEPTED" ? (
              <Check className="h-3 w-3 text-green-600" />
            ) : feedbackSent === "REJECTED" ? (
              <X className="h-3 w-3 text-muted-foreground" />
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4"
                  onClick={apply}
                  data-testid={`ai-suggestion-apply-${props.costCode}`}
                >
                  <ThumbsUp className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-4 w-4"
                  onClick={reject}
                  data-testid={`ai-suggestion-reject-${props.costCode}`}
                >
                  <ThumbsDown className="h-3 w-3" />
                </Button>
              </>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          <div className="text-xs">
            <div>{sug.message}</div>
            <div className="mt-1 text-muted-foreground">Source: your org's learned rates ({sug.sampleSize} samples)</div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
