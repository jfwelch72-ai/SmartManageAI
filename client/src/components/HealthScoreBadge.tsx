import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface HealthScoreBadgeProps {
  score: number;
  trendDirection?: string | null;
  size?: "sm" | "md" | "lg";
  showTrend?: boolean;
  onClick?: () => void;
  className?: string;
}

function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400";
  if (score >= 60) return "text-amber-600 dark:text-amber-500";
  return "text-red-600 dark:text-red-400";
}

function getScoreBgColor(score: number): string {
  if (score >= 80) return "bg-green-500/10 border-green-300 dark:border-green-700";
  if (score >= 60) return "bg-amber-500/10 border-amber-300 dark:border-amber-700";
  return "bg-red-500/10 border-red-300 dark:border-red-700";
}

function getScoreLabel(score: number): string {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "At Risk";
  return "Critical";
}

function getTrendIcon(direction: string | null | undefined) {
  if (direction === "improving") return <TrendingUp className="w-3 h-3 text-green-500" />;
  if (direction === "declining") return <TrendingDown className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

export default function HealthScoreBadge({
  score,
  trendDirection,
  size = "md",
  showTrend = true,
  onClick,
  className,
}: HealthScoreBadgeProps) {
  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-xs gap-1",
    md: "px-2 py-1 text-sm gap-1.5",
    lg: "px-3 py-1.5 text-base gap-2",
  };

  const badge = (
    <div
      className={cn(
        "inline-flex items-center rounded-full border font-semibold tabular-nums transition-colors",
        getScoreBgColor(score),
        sizeClasses[size],
        onClick && "cursor-pointer hover:opacity-80",
        className,
      )}
      onClick={onClick}
      data-testid="badge-health-score"
    >
      <span className={getScoreColor(score)}>{score}</span>
      {showTrend && trendDirection && getTrendIcon(trendDirection)}
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">Health Score: {score}/100 — {getScoreLabel(score)}</p>
          {trendDirection && (
            <p className="text-xs text-muted-foreground capitalize">Trend: {trendDirection}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
