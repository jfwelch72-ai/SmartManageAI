// Task #2311 — Shared AI Takeoff entry-point card used in the Plans
// tab of bids and projects. Renders a violet "AI Takeoff" call-out
// above the sheet list. Clicking it opens a Popover with a scrollable
// list of takeoff sheets so the user can pick which one to analyze.
// Selecting a sheet navigates to the standalone takeoff workspace at
// that sheet with `?openAi=1` appended; the workspace strips the
// param and auto-opens the AI panel. Wording avoids any model name.
import { useMemo, useState } from "react";
import { Sparkles, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PickerSheet {
  id: string;
  sheetName?: string | null;
  pageNumber?: number | null;
}

interface AiTakeoffSheetPickerProps {
  sheets: PickerSheet[];
  // Builds the URL for the chosen sheet. The caller knows whether
  // this is a bid (`/takeoff/<bidCode>`) or project
  // (`/takeoff/project/<projectCode>`) context, so the picker doesn't
  // need either id directly.
  buildHref: (sheetId: string) => string;
  // Routing function from `wouter`'s `useLocation()`. Passing it in
  // (rather than calling the hook here) keeps this component reusable
  // outside of routed contexts and easier to unit-test.
  navigate: (path: string) => void;
  // Stable id for the trigger button so e2e tests can target the
  // bid-tab and project-tab call-outs separately.
  testId: string;
}

export function AiTakeoffSheetPicker({ sheets, buildHref, navigate, testId }: AiTakeoffSheetPickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const sortedSheets = useMemo(() => {
    // Order by page number when present so the picker reads in the
    // same sequence the user sees in the sheet list itself.
    return [...sheets].sort((a, b) => {
      const ap = a.pageNumber ?? Number.MAX_SAFE_INTEGER;
      const bp = b.pageNumber ?? Number.MAX_SAFE_INTEGER;
      if (ap !== bp) return ap - bp;
      return (a.sheetName ?? "").localeCompare(b.sheetName ?? "");
    });
  }, [sheets]);

  const filteredSheets = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return sortedSheets;
    return sortedSheets.filter((s) =>
      (s.sheetName ?? "").toLowerCase().includes(q) ||
      (s.pageNumber != null && String(s.pageNumber).includes(q))
    );
  }, [sortedSheets, filter]);

  const handlePick = (sheetId: string) => {
    setOpen(false);
    navigate(buildHref(sheetId));
  };

  return (
    <div className="px-2 mb-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            // 44px minimum tap target on phones; collapses tighter on
            // sm+ where pointer precision makes a denser row OK.
            className="w-full text-left rounded-lg border border-violet-200 dark:border-violet-900/50 bg-violet-50/60 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/40 transition-colors p-3 sm:p-2.5 min-h-[44px] flex items-center gap-2.5"
            data-testid={testId}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            <div className="rounded-md bg-violet-100 dark:bg-violet-900/40 p-1.5 shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-violet-900 dark:text-violet-100 leading-tight">
                AI Takeoff
              </div>
              <div className="text-[11px] text-violet-700/80 dark:text-violet-300/80 mt-0.5 leading-snug">
                Pick a sheet and let AI suggest counts and quantities to review.
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-violet-600/70 dark:text-violet-400/70 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start" data-testid={`${testId}-popover`}>
          <div className="p-2 border-b">
            <div className="text-xs font-semibold mb-1.5">Choose a sheet for AI Takeoff</div>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search sheets…"
              className="w-full text-xs bg-background border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
              data-testid={`${testId}-filter`}
              autoFocus
            />
          </div>
          <ScrollArea className="max-h-72">
            {filteredSheets.length === 0 ? (
              <div className="px-3 py-6 text-xs text-muted-foreground text-center">
                {sortedSheets.length === 0 ? "No takeoff sheets yet." : "No matching sheets."}
              </div>
            ) : (
              <div className="py-1">
                {filteredSheets.map((s) => {
                  const label = s.sheetName?.trim() || `Sheet ${s.pageNumber ?? ""}`.trim() || "Untitled sheet";
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handlePick(s.id)}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 min-h-[44px] sm:min-h-0"
                      data-testid={`${testId}-sheet-${s.id}`}
                    >
                      {s.pageNumber != null && (
                        <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0 w-6 text-right">
                          {s.pageNumber}
                        </span>
                      )}
                      <span className="truncate flex-1">{label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
