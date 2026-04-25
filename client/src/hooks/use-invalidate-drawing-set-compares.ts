import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

interface DrawingSetSummary {
  id: string;
}

// Task #1913 — Sheet mutations (rename / duplicate / delete / supersede /
// import-plan / document-delete) shift which active revisions exist for a
// project, which in turn feeds every drawing set's `/compare` query and the
// SetStaleBadge UI. This hook returns a callback that invalidates the
// `/compare` query for every set in the project so the badge stays accurate
// without waiting for window refocus or a manual refresh.
//
// Originally lived inline in PlansTab as `invalidateProjectSetCompares`
// (#1895). Extracted into a shared hook in #1913 so the takeoff workspace
// (`use-takeoff-data`) can reuse the exact same invalidation set after its
// parallel rename/duplicate/delete/supersede mutations — the takeoff
// workspace was previously leaving the badge stale until window refocus
// when users edited sheets there instead of from the Plans tab.
//
// `projectId` is intentionally nullable so callers in non-project contexts
// (e.g. bid-scoped takeoff) can pass `null` to make this a no-op.
export function useInvalidateDrawingSetCompares(
  projectId: string | null | undefined,
) {
  const { data: drawingSets = [] } = useQuery<DrawingSetSummary[]>({
    queryKey: ["/api/projects", projectId, "drawing-sets"],
    enabled: !!projectId,
  });

  return useCallback(() => {
    if (!projectId || drawingSets.length === 0) return;
    for (const set of drawingSets) {
      queryClient.invalidateQueries({
        queryKey: ["/api/projects", "drawing-sets", set.id, "compare"],
      });
    }
  }, [projectId, drawingSets]);
}
