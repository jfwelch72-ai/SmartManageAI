import { memo, useCallback } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "wouter";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ProjectStaleSummary } from "@/hooks/use-drawing-set-stale-summary";

interface StaleDrawingsBadgeProps {
  projectCode: string;
  summary: ProjectStaleSummary | undefined;
}

// Task #1893 — Per-row indicator on the projects list. Renders nothing when
// the project has no stale pinned sheets so the column collapses for the
// (common) up-to-date case. Click/Enter/Space jumps to the project's Plans
// tab where DrawingSetsPanel surfaces the per-set comparison UI.
const StaleDrawingsBadge = memo(function StaleDrawingsBadge({
  projectCode,
  summary,
}: StaleDrawingsBadgeProps) {
  const [, setLocation] = useLocation();

  const navigate = useCallback(() => {
    setLocation(`/projects/${projectCode}?tab=plans`);
  }, [projectCode, setLocation]);

  const handleClick = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      navigate();
    },
    [navigate],
  );

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        navigate();
      }
    },
    [navigate],
  );

  if (!summary || summary.newerSheetCount === 0) return null;

  const { staleSetCount, newerSheetCount } = summary;
  const setLabel = staleSetCount === 1 ? "set" : "sets";
  const sheetLabel = newerSheetCount === 1 ? "sheet" : "sheets";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            aria-label={`${newerSheetCount} newer drawing ${sheetLabel} available across ${staleSetCount} ${setLabel}`}
            className="text-xs border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 cursor-pointer hover-elevate active-elevate-2"
            data-testid={`badge-project-stale-drawings-${projectCode}`}
          >
            <AlertTriangle className="w-3 h-3 mr-0.5" />
            {newerSheetCount} newer
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          {newerSheetCount} newer {sheetLabel} available across{" "}
          {staleSetCount} drawing {setLabel}. Click to open the Plans tab.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

export default StaleDrawingsBadge;
