import { useQuery } from "@tanstack/react-query";

export interface ProjectStaleSummary {
  staleSetCount: number;
  newerSheetCount: number;
}

export interface DrawingSetStaleSummaryResponse {
  summary: Record<string, ProjectStaleSummary>;
}

// Task #1893 — Single org-scoped roll-up that powers the projects-list
// "out of date drawings" indicator. Backed by
// GET /api/projects/drawing-sets/stale-summary so list rendering stays O(1)
// requests rather than one /compare per drawing set.
export function useDrawingSetStaleSummary(enabled: boolean = true) {
  return useQuery<DrawingSetStaleSummaryResponse>({
    queryKey: ["/api/projects/drawing-sets/stale-summary"],
    enabled,
    staleTime: 60_000,
  });
}
