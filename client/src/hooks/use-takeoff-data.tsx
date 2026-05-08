import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useTakeoffHistory, type MeasurementSnapshot } from "@/hooks/use-takeoff-history";
import { useInvalidateDrawingSetCompares } from "@/hooks/use-invalidate-drawing-set-compares";
import type { TakeoffSheet, TakeoffMeasurement, TakeoffMeasurementGroup, QuantityCategory, TakeoffMarkup, TakeoffSheetLink, TakeoffCondition } from "@shared/schema";
import type { PlanDocument, AddendumOverlayData, MeasurementType } from "@/components/takeoff/types";
import { buildMarkupFailureSummary, type MarkupFailureSummary } from "@/components/markups/markup-failure-helpers";

export type TakeoffMarkupWithAuthor = Omit<TakeoffMarkup, "points"> & { authorName?: string | null; points: { x: number; y: number }[] };

type TakeoffContext =
  | { type: "project"; projectId: string; projectCode: string }
  | { type: "bid"; bidId: string; bidCode: string }
  | { type: "standalone"; standaloneTakeoffId: string; standaloneTitle?: string };

interface UseTakeoffDataParams {
  projectId: string;
  projectCode: string;
  context?: TakeoffContext;
  selectedSheet: string | null;
  selectedVersionId?: string | null;
  uploadDialogOpen: boolean;
  takeoffHistory: ReturnType<typeof useTakeoffHistory>;
  selectedCategoryId: string | null;
  autoImportEnabled?: boolean;
  onCollabBroadcast?: (type: "MEASUREMENT_CREATED" | "MEASUREMENT_UPDATED" | "MEASUREMENT_DELETED", payload: any) => void;
  callbacks: {
    setUploadDialogOpen: (v: boolean) => void;
    setSelectedSheet: (v: string | null) => void;
    setSelectedMeasurementId: (v: string | null) => void;
    setRenameDialogOpen: (v: boolean) => void;
    setDeleteSheetConfirmOpen: (v: boolean) => void;
    setCategoryDialogOpen: (v: boolean) => void;
    setEditingCategory: (v: QuantityCategory | null) => void;
    setCategoryName: (v: string) => void;
    setCategoryColor: (v: string) => void;
    setSelectedCategoryId: (v: string | null) => void;
    /**
     * Task #1837 — Called when a single/bulk markup PATCH fails with
     * `reason: "not_found"` (typically because a teammate deleted
     * those markups on another device). The workspace prunes its
     * local selection set so the user can't re-select a phantom that
     * the server has already removed.
     */
    pruneSelectedMarkupIds?: (ids: string[]) => void;
    /**
     * Task #1970 — Same affordance as `pruneSelectedMarkupIds` but
     * for measurements. Called when `updateMeasurementMutation`
     * receives a `reason: "not_found"` 404 (typically because a
     * teammate deleted the measurement on another device). The
     * workspace clears `selectedMeasurementId` and prunes any
     * matching ids from the multi-select set so the properties
     * panel can't re-edit a phantom that the server has already
     * removed.
     */
    pruneSelectedMeasurementIds?: (ids: string[]) => void;
  };
}

export function useTakeoffData({
  projectId,
  projectCode,
  context,
  selectedSheet,
  selectedVersionId,
  uploadDialogOpen,
  takeoffHistory,
  selectedCategoryId,
  autoImportEnabled,
  onCollabBroadcast,
  callbacks,
}: UseTakeoffDataParams) {
  const { toast } = useToast();

  // Task #1768 — Tracks markup ids whose most-recent move PATCH was
  // rejected by the server. The TakeoffWorkspace renders a temporary
  // red glow on every id in this set so a 50-markup batch failure
  // points the user at exactly which siblings to fix instead of a
  // black-box "try again". Auto-clears after a few seconds; the
  // mutation onError handlers replace the set on every new failure so
  // an old highlight never lingers from a previous gesture.
  const [failedMarkupIds, setFailedMarkupIdsState] = useState<Set<string>>(() => new Set());
  const failedMarkupIdsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashFailedMarkupIds = useCallback((ids: string[]) => {
    if (failedMarkupIdsTimerRef.current) {
      clearTimeout(failedMarkupIdsTimerRef.current);
      failedMarkupIdsTimerRef.current = null;
    }
    if (ids.length === 0) {
      setFailedMarkupIdsState(new Set());
      return;
    }
    setFailedMarkupIdsState(new Set(ids));
    failedMarkupIdsTimerRef.current = setTimeout(() => {
      setFailedMarkupIdsState(new Set());
      failedMarkupIdsTimerRef.current = null;
    }, 6000);
  }, []);
  const clearFailedMarkupIds = useCallback(() => {
    flashFailedMarkupIds([]);
  }, [flashFailedMarkupIds]);
  useEffect(() => () => {
    if (failedMarkupIdsTimerRef.current) clearTimeout(failedMarkupIdsTimerRef.current);
  }, []);

  // Task #1837 — When a markup PATCH fails with `reason: "not_found"`
  // the server has already deleted those markups (typically via a
  // teammate on another device). The optimistic-rollback handler
  // restores the pre-mutation snapshot, which would re-introduce the
  // phantom markup with a red glow until the next manual refresh.
  // This helper drops the deleted ids from the active sheet's cached
  // markups list AND from the workspace's selection set so the canvas
  // state immediately matches what the server believes.
  const pruneDeletedMarkups = useCallback(
    (
      summary: MarkupFailureSummary,
      cacheKey: readonly unknown[],
    ) => {
      const notFoundIds = summary.groups
        .filter((g) => g.reason === "not_found")
        .flatMap((g) => g.failedMarkupIds);
      if (notFoundIds.length === 0) return;
      const notFoundSet = new Set(notFoundIds);
      queryClient.setQueryData<TakeoffMarkupWithAuthor[]>(
        cacheKey,
        (old) => (old ? old.filter((m) => !notFoundSet.has(m.id)) : old),
      );
      callbacks.pruneSelectedMarkupIds?.(notFoundIds);
    },
    [callbacks],
  );

  // Task #1970 — Mirror the markup helper above for measurements:
  // when a measurement PATCH fails with `reason: "not_found"` the
  // server has already deleted the row (typically a teammate on
  // another device). The legacy onError handler only fired a generic
  // "Failed to update measurement" toast and left the cache intact,
  // so the next edit attempt against the same row would just fail
  // again until the user manually refreshed the workspace. This
  // helper surgically removes the deleted ids from the active
  // sheet's cached measurements list AND clears them out of the
  // workspace's selectedMeasurementId / selectedMeasurementIds
  // state so the properties panel can't re-edit a phantom row.
  const pruneDeletedMeasurements = useCallback(
    (notFoundIds: string[], cacheKey: readonly unknown[]) => {
      if (notFoundIds.length === 0) return;
      const notFoundSet = new Set(notFoundIds);
      queryClient.setQueryData<TakeoffMeasurement[]>(
        cacheKey,
        (old) => (old ? old.filter((m) => !notFoundSet.has(m.id)) : old),
      );
      callbacks.pruneSelectedMeasurementIds?.(notFoundIds);
    },
    [callbacks],
  );

  // Task #1970 — Parse a measurement PATCH error response and return
  // the ids the server says are gone (`reason: "not_found"`). Mirrors
  // the markup-side `parseFailureGroups` shape so a future bulk
  // measurement endpoint can reuse the same `failuresByReason` /
  // legacy-flat shape without changing this caller. The attempted-id
  // fallback (status 404 with no structured body) matches the markup
  // helper's behavior so older server responses still get the prune
  // treatment instead of leaking phantoms. Hook-local because it
  // doesn't close over any state — exposed as a useCallback so its
  // identity stays stable across renders for the onError handler
  // dependency list.
  const extractMeasurementNotFoundIds = useCallback(
    (error: unknown, attemptedIds: string[]): string[] => {
      if (!error || typeof error !== "object") return [];
      const data = (error as { data?: any }).data;
      const status = (error as { status?: number }).status;
      const collected: string[] = [];
      const seen = new Set<string>();
      const pushAll = (raw: unknown) => {
        if (!Array.isArray(raw)) return;
        for (const v of raw) {
          if (typeof v === "string" && v.length > 0 && !seen.has(v)) {
            seen.add(v);
            collected.push(v);
          }
        }
      };
      if (data && typeof data === "object") {
        if (Array.isArray(data.failuresByReason)) {
          for (const g of data.failuresByReason) {
            if (g && typeof g === "object" && g.reason === "not_found") {
              pushAll(g.failedMeasurementIds);
            }
          }
        }
        if (data.reason === "not_found" && Array.isArray(data.failedMeasurementIds)) {
          pushAll(data.failedMeasurementIds);
        }
      }
      // Task #1988 — Plain 404 fallback (also covers Task #1970's
      // "reason: not_found without an enumerated list" case). When the
      // server returns a bare 404 — either a true legacy response
      // (`{ error: "Measurement not found" }` with no `reason` /
      // `failedMeasurementIds`) or a mixed-deployment scenario where
      // the client is updated ahead of the server — we still want to
      // prune the row out of the cache + selection so the canvas does
      // not leak a phantom. We fall back to the ids the caller just
      // tried to operate on (`[variables.id]` for the per-id PATCH /
      // DELETE paths). The bulk DELETE path passes an empty list as
      // attemptedIds so a plain-404 with no enumerated body never
      // accidentally prunes the entire bulk selection — it can only
      // act on ids the modern server explicitly enumerates.
      if (collected.length === 0 && status === 404) {
        for (const id of attemptedIds) {
          if (!seen.has(id)) {
            seen.add(id);
            collected.push(id);
          }
        }
      }
      return collected;
    },
    [],
  );

  // Task #1882 — Track the most recent "Deleted N markups" undo toast
  // so we can auto-dismiss it when the user navigates away from the
  // sheet the deletion happened on. Without this, the toast (and its
  // Undo button) would linger on a different sheet where invoking the
  // restore would put the markups back on the wrong canvas context for
  // the user.
  const bulkDeleteToastRef = useRef<{ dismiss: () => void; sheetId: string } | null>(null);
  // Task #1901 — Same affordance as #1882 but for the measurements
  // bulk-delete path. The two refs are kept independent so a navigate
  // event clears whichever toasts belong to the previous sheet without
  // either layer piggy-backing on the other's dismiss handle.
  const bulkDeleteMeasurementsToastRef = useRef<{ dismiss: () => void; sheetId: string } | null>(null);
  useEffect(() => {
    const tracked = bulkDeleteToastRef.current;
    if (tracked && tracked.sheetId !== selectedSheet) {
      tracked.dismiss();
      bulkDeleteToastRef.current = null;
    }
    const trackedMeas = bulkDeleteMeasurementsToastRef.current;
    if (trackedMeas && trackedMeas.sheetId !== selectedSheet) {
      trackedMeas.dismiss();
      bulkDeleteMeasurementsToastRef.current = null;
    }
  }, [selectedSheet]);
  useEffect(() => () => {
    bulkDeleteToastRef.current?.dismiss();
    bulkDeleteToastRef.current = null;
    bulkDeleteMeasurementsToastRef.current?.dismiss();
    bulkDeleteMeasurementsToastRef.current = null;
  }, []);

  // Task #1902 — Track the most recent "Deleted sheet" undo toast so
  // it is dismissed if the workspace unmounts (e.g. user navigates
  // away from the takeoff page entirely). The toast's Undo button
  // closes over the snapshot the DELETE response returned, so even if
  // the workspace state is gone the restore POST still succeeds — but
  // we proactively drop the dangling toast to avoid stale UI on
  // re-mount. We do NOT dismiss it on `selectedSheet` change the way
  // the bulk-markup toast does: the deleted sheet is gone, so the
  // post-delete sheet selection is the natural follow-on context for
  // the Undo button.
  const sheetDeleteToastRef = useRef<{ dismiss: () => void } | null>(null);
  useEffect(() => () => {
    sheetDeleteToastRef.current?.dismiss();
    sheetDeleteToastRef.current = null;
  }, []);

  const isBid = context?.type === "bid";
  const isStandalone = context?.type === "standalone";
  const ctxId = isStandalone
    ? context.standaloneTakeoffId
    : isBid
      ? context.bidId
      : projectId;
  const ctxCode = isStandalone
    ? context.standaloneTakeoffId
    : isBid
      ? context.bidCode
      : projectCode;

  // Task #1913 — Mirror PlansTab's #1895 staleness wiring from inside the
  // takeoff workspace. Sheet rename / duplicate / delete / supersede here
  // mutate the same `takeoff_sheets.is_active` / `sheet_name` fields that
  // every drawing set's `/compare` query reads, so we invalidate every
  // set's compare query after each mutation. Drawing sets are
  // project-scoped, so bid-context takeoffs pass `null` and this becomes
  // a no-op there.
  const invalidateDrawingSetCompares = useInvalidateDrawingSetCompares(
    isBid ? null : projectId,
  );

  const sheetsQueryKey = isStandalone
    ? ["/api/takeoff/standalone", ctxId, "sheets"]
    : isBid
      ? ["/api/bids", ctxId, "takeoff", "sheets"]
      : ["/api/projects", ctxId, "takeoff", "sheets"];

  const categoriesQueryKey = isStandalone
    ? ["/api/takeoff/standalone", ctxId, "categories"]
    : isBid
      ? ["/api/bids", ctxId, "takeoff", "categories"]
      : ["/api/projects", ctxCode, "quantity-categories"];

  const { data: sheets = [], isLoading: sheetsLoading } = useQuery<TakeoffSheet[]>({
    queryKey: sheetsQueryKey,
  });

  const { data: planDocuments = [], isLoading: documentsLoading } = useQuery<PlanDocument[]>({
    queryKey: isBid
      ? ["/api/bids", ctxCode, "documents"]
      : ["/api/projects", ctxCode, "documents"],
    enabled: uploadDialogOpen && !isStandalone,
  });

  const importPlanMutation = useMutation({
    mutationFn: async ({ documentId, revisionLabel }: { documentId: string; revisionLabel?: string }) => {
      const url = isBid
        ? `/api/bids/${ctxId}/takeoff/import-plan`
        : `/api/projects/${ctxId}/takeoff/import-plan`;
      const res = await apiRequest("POST", url, { documentId, revisionLabel });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      // Task #1913 — importing a plan creates new active takeoff_sheets
      // that may match pinned sheet names in any drawing set, so refresh
      // every set's compare query (mirrors PlansTab #1895 behavior).
      invalidateDrawingSetCompares();
      callbacks.setUploadDialogOpen(false);
      if (data?.sheets?.[0]?.id) {
        callbacks.setSelectedSheet(data.sheets[0].id);
      }
      const sheetCount = data?.sheets?.length || 1;
      toast({
        title: "Success",
        description: sheetCount > 1
          ? `Imported ${sheetCount} sheets from multi-page PDF`
          : "Plan sheet imported to takeoff workspace",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error?.message || "Failed to import plan sheet",
        variant: "destructive"
      });
    },
  });

  const supersedeSheetMutation = useMutation({
    mutationFn: async ({ oldSheetId, newSheetId, revisionLabel }: { oldSheetId: string; newSheetId: string; revisionLabel?: string }) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${oldSheetId}/supersede`, { newSheetId, revisionLabel });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      // Task #1913 — supersede explicitly flips the old sheet's is_active,
      // which is exactly what every drawing set's /compare query reads to
      // decide if its pinned revision is stale. Refresh every set's
      // compare so SetStaleBadge updates without window refocus.
      invalidateDrawingSetCompares();
      toast({ title: "Revision recorded", description: "The old sheet has been superseded by the new revision." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to mark sheet as superseded", variant: "destructive" });
    },
  });

  const { data: projectAddenda = [] } = useQuery<AddendumOverlayData[]>({
    queryKey: ["/api/projects", ctxId, "addenda"],
    enabled: !isBid && !isStandalone,
  });

  const { data: selectedVersionData } = useQuery<{ id: string; status: string }>({
    queryKey: ["/api/takeoff/versions", selectedVersionId],
    enabled: !!selectedVersionId,
  });

  const measurementsQueryKey = selectedVersionId
    ? ["/api/takeoff/sheets", selectedSheet, "measurements", { versionId: selectedVersionId }]
    : ["/api/takeoff/sheets", selectedSheet, "measurements"];

  const { data: measurements = [], isLoading: measurementsLoading } = useQuery<TakeoffMeasurement[]>({
    queryKey: measurementsQueryKey,
    queryFn: async () => {
      const url = selectedVersionId
        ? `/api/takeoff/sheets/${selectedSheet}/measurements?versionId=${selectedVersionId}`
        : `/api/takeoff/sheets/${selectedSheet}/measurements`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch measurements");
      return res.json();
    },
    enabled: !!selectedSheet,
  });

  const allMeasurementsUrl = isStandalone
    ? `/api/takeoff/standalone/${ctxId}/all-measurements`
    : isBid
      ? `/api/bids/${ctxId}/takeoff/all-measurements`
      : `/api/projects/${ctxId}/takeoff/all-measurements`;

  const { data: allMeasurementsRaw = [] } = useQuery<TakeoffMeasurement[]>({
    queryKey: [allMeasurementsUrl],
    queryFn: async () => {
      const res = await fetch(allMeasurementsUrl, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 30000,
  });

  const measurementCountsPerSheet = useMemo(() => {
    const map = new Map<string, number>();
    allMeasurementsRaw.forEach(m => {
      map.set(m.sheetId, (map.get(m.sheetId) || 0) + 1);
    });
    return map;
  }, [allMeasurementsRaw]);

  // Task #2344 — Per-sheet projection of just the calibration-snapshot
  // columns (`scaleAtCaptureLabel`, `scaleAtCapturePxPerFoot`). The
  // workspace feeds these into `computeSheetCalibrationConfidence` so
  // every sheet — not just the active one — can render its own
  // four-level confidence dot in the bottom bar and the sheet
  // selector dropdown without re-fetching its measurements. We
  // project only the two fields the helper reads so the map stays
  // cheap to memo against (a 5,000-measurement project would
  // otherwise force every chip-consuming memo to compare full
  // measurement rows).
  const measurementsBySheet = useMemo(() => {
    const map = new Map<string, { scaleAtCaptureLabel: string | null; scaleAtCapturePxPerFoot: number | null }[]>();
    allMeasurementsRaw.forEach((m) => {
      const entry = {
        scaleAtCaptureLabel: (m as { scaleAtCaptureLabel?: string | null }).scaleAtCaptureLabel ?? null,
        scaleAtCapturePxPerFoot:
          (m as { scaleAtCapturePxPerFoot?: number | string | null }).scaleAtCapturePxPerFoot != null
            ? Number((m as { scaleAtCapturePxPerFoot?: number | string | null }).scaleAtCapturePxPerFoot)
            : null,
      };
      const existing = map.get(m.sheetId);
      if (existing) {
        existing.push(entry);
      } else {
        map.set(m.sheetId, [entry]);
      }
    });
    return map;
  }, [allMeasurementsRaw]);

  const { data: markups = [] } = useQuery<TakeoffMarkupWithAuthor[]>({
    queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"],
    enabled: !!selectedSheet,
  });

  const { data: sheetLinks = [] } = useQuery<TakeoffSheetLink[]>({
    queryKey: ["/api/takeoff/sheets", selectedSheet, "links"],
    enabled: !!selectedSheet,
  });

  const createSheetLinkMutation = useMutation({
    mutationFn: async (data: {
      sourceSheetId: string;
      targetSheetId: string;
      x: number;
      y: number;
      width: number;
      height: number;
      label?: string;
    }) => {
      const res = await apiRequest("POST", "/api/takeoff/sheet-links", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "links"] });
      toast({ title: "Link created" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create link", variant: "destructive" });
    },
  });

  const deleteSheetLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await apiRequest("DELETE", `/api/takeoff/sheet-links/${linkId}`);
      return linkId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "links"] });
      toast({ title: "Link deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete link", variant: "destructive" });
    },
  });

  const detectLinksMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${sheetId}/detect-links`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "links"] });
      toast({ title: "Link Detection Complete", description: `${data.detected} links detected` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to detect links", variant: "destructive" });
    },
  });

  const createMeasurementMutation = useMutation({
    mutationFn: async (data: {
      sheetId: string;
      type: MeasurementType;
      points: { x: number; y: number }[];
      label?: string;
      depthFeet?: number;
      categoryId?: string | null;
      pitchRatio?: string;
      costCodeId?: string;
      unitCost?: number;
      color?: string;
      computedSurfaceAreaFt2?: number;
      computedLengthFt?: number;
      metadata?: string;
      lineStyle?: string;
      lineWidth?: number;
      // Task #2319 — provenance fields the canvas commit wrapper
      // (`commitMeasurement` in `use-takeoff-interactions`) computes
      // from the per-vertex snap log. Both are optional so callers
      // that bypass the wrapper (note dialog, Ctrl+D duplicate)
      // continue to type-check; the server's needs_review rule treats
      // a null `snapHitRatio` as "no signal", not as "low snap".
      snapHitRatio?: number;
      snapModesUsed?: string[];
    }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot create measurements while viewing a locked version");
      }
      const payload = { ...data };
      if (payload.categoryId && !payload.lineStyle && !payload.lineWidth) {
        const cat = categories.find(c => c.id === payload.categoryId);
        if (cat) {
          payload.lineStyle = cat.lineStyle || "solid";
          payload.lineWidth = cat.lineWidth || 3;
        }
      }
      const res = await apiRequest("POST", "/api/takeoff/measurements", payload);
      return res.json();
    },
    onSuccess: async (data: TakeoffMeasurement) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      if (selectedSheet) {
        takeoffHistory.pushAction("CREATE", data, selectedSheet);
        onCollabBroadcast?.("MEASUREMENT_CREATED", { sheetId: selectedSheet, measurementId: data.id });
      }
      toast({ title: "Success", description: "Measurement saved" });

      if (autoImportEnabled && data.id) {
        try {
          const importRes = await apiRequest("POST", `/api/takeoff/measurements/${data.id}/auto-import`);
          const importData = await importRes.json();
          if (importData.autoImported) {
            const estimateKey = isBid ? ["/api/bids", ctxId, "estimate"] : ["/api/projects", ctxId, "estimate"];
            queryClient.invalidateQueries({ queryKey: estimateKey });
            toast({ title: "Auto-imported", description: `${data.label || "Measurement"} added to estimate` });
          } else if (importData.skipped) {
            toast({ title: "Skipped", description: importData.reason || "Measurement not imported" });
          }
        } catch {
          toast({ title: "Auto-import failed", description: "Measurement saved but could not auto-import to estimate", variant: "destructive" });
        }
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save measurement", variant: "destructive" });
    },
  });

  // Task #2629 — Optimistic concurrency state. Surfaces a conflict
  // resolution dialog when a teammate's edit advanced the row's
  // `version` between our last read and our PATCH. The dialog shows
  // both sides and lets the user pick "keep theirs" (do nothing
  // beyond the cache refresh) or "overwrite" (re-PATCH without
  // `expectedVersion`, accepting the legacy last-write-wins fallback).
  const [measurementConflict, setMeasurementConflict] = useState<{
    measurementId: string;
    pendingEdit: Record<string, unknown>;
    serverRow: TakeoffMeasurement | null;
    currentVersion: number | null;
    // Task #2652 — Teammate who last edited the row (looked up
    // server-side from the most recent UPDATE audit_log entry). Null
    // when the audit lookup failed or no prior UPDATE exists yet.
    lastEditor: { id: string; firstName: string | null; lastName: string | null; editedAt: string } | null;
  } | null>(null);
  const dismissMeasurementConflict = useCallback(() => setMeasurementConflict(null), []);

  const updateMeasurementMutation = useMutation({
    // Task #1770 — `skipHistory` is the same opt-out the markup mutation
    // (#1755) uses: bulk callers (e.g. `handleBulkCategoryAssign` in the
    // sidebar) push one MEASUREMENT_UPDATE_BATCH up front and then fan
    // out N per-id PATCHes that pass `skipHistory: true` so the per-call
    // path never adds its own entry. The flag is stripped before the
    // PATCH body is sent so the API surface is unchanged.
    //
    // Task #1843 — `previous` mirrors `updateMarkupMutation`'s shape
    // (#1758): a single rename / category / cost edit through the
    // properties panel forwards a before-state snapshot so onSuccess
    // can push exactly one MEASUREMENT_UPDATE history entry. Without
    // this, single-measurement edits produced zero history entries
    // (only batch / CREATE / DELETE were tracked) and the user could
    // not Undo a rename. Stripped from the PATCH body alongside
    // `skipHistory` so the API surface is unchanged.
    mutationFn: async ({ id, skipHistory: _skipHistory, previous: _previous, expectedVersion, forceOverwrite, ...data }: { id: string; costCodeId?: string; unitCost?: number; label?: string; categoryId?: string | null; groupId?: string | null; lineStyle?: string; lineWidth?: number; metadata?: string; points?: string; computedLengthFt?: number; skipHistory?: boolean; expectedVersion?: number; forceOverwrite?: boolean; previous?: { label?: string | null; costCodeId?: string | null; unitCost?: number | string | null; categoryId?: string | null; groupId?: string | null; lineStyle?: string | null; lineWidth?: number | null; metadata?: string | null; points?: string } }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot edit measurements while viewing a locked version");
      }
      // Task #2629 — Auto-attach the cached row's `version` as
      // `expectedVersion` so the server's CAS path engages on every
      // normal edit. `forceOverwrite` (set by the conflict dialog's
      // "overwrite" button) opts back into legacy last-write-wins.
      let resolvedVersion: number | undefined = expectedVersion;
      if (resolvedVersion === undefined && !forceOverwrite && selectedSheet) {
        const cached = queryClient.getQueryData<TakeoffMeasurement[]>([
          "/api/takeoff/sheets",
          selectedSheet,
          "measurements",
        ]);
        const row = cached?.find((m) => m.id === id) as (TakeoffMeasurement & { version?: number }) | undefined;
        if (row && typeof row.version === "number") resolvedVersion = row.version;
      }
      const body: Record<string, unknown> = { ...data };
      if (resolvedVersion !== undefined && !forceOverwrite) body.expectedVersion = resolvedVersion;
      const res = await apiRequest("PATCH", `/api/takeoff/measurements/${id}`, body);
      return res.json();
    },
    onSuccess: (_data: TakeoffMeasurement & { version?: number }, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      if (selectedSheet) {
        onCollabBroadcast?.("MEASUREMENT_UPDATED", { sheetId: selectedSheet, measurementId: variables.id });
      }
      // Task #1843 — single-edit history push. Mirrors the per-field
      // diff in `updateMarkupMutation.onSuccess` (#1758): only fields
      // present on BOTH `variables` (the new value) and `previous` (the
      // pre-edit value) are recorded so undo/redo replay only the
      // fields the user actually changed. Bulk callers pass
      // `skipHistory: true` and pre-push their own MEASUREMENT_UPDATE_BATCH
      // entry so we must skip here in that case.
      if (selectedSheet && variables.previous && !variables.skipHistory) {
        const previous = variables.previous;
        // Task #2653 — Stamp the post-PATCH version onto both
        // sides of the snapshot so undo's CAS sends the version
        // the row currently has on the server. The redo branch
        // updates `before.version` from its own response after
        // undo runs (history hook).
        const postVersion = typeof _data.version === "number" ? _data.version : undefined;
        const before: MeasurementSnapshot = { id: variables.id, version: postVersion };
        const after: MeasurementSnapshot = { id: variables.id, version: postVersion };
        let hasChange = false;
        if (variables.label !== undefined && previous.label !== undefined) {
          before.label = previous.label; after.label = variables.label; hasChange = true;
        }
        if (variables.costCodeId !== undefined && previous.costCodeId !== undefined) {
          before.costCodeId = previous.costCodeId; after.costCodeId = variables.costCodeId; hasChange = true;
        }
        if (variables.unitCost !== undefined && previous.unitCost !== undefined) {
          before.unitCost = previous.unitCost; after.unitCost = variables.unitCost; hasChange = true;
        }
        if (variables.categoryId !== undefined && previous.categoryId !== undefined) {
          before.categoryId = previous.categoryId; after.categoryId = variables.categoryId; hasChange = true;
        }
        if (variables.groupId !== undefined && previous.groupId !== undefined) {
          before.groupId = previous.groupId; after.groupId = variables.groupId; hasChange = true;
        }
        if (variables.lineStyle !== undefined && previous.lineStyle !== undefined) {
          before.lineStyle = previous.lineStyle; after.lineStyle = variables.lineStyle; hasChange = true;
        }
        if (variables.lineWidth !== undefined && previous.lineWidth !== undefined) {
          before.lineWidth = previous.lineWidth; after.lineWidth = variables.lineWidth; hasChange = true;
        }
        if (variables.metadata !== undefined && previous.metadata !== undefined) {
          before.metadata = previous.metadata; after.metadata = variables.metadata; hasChange = true;
        }
        if (variables.points !== undefined && previous.points !== undefined) {
          before.points = previous.points; after.points = variables.points; hasChange = true;
        }
        if (hasChange) {
          takeoffHistory.pushMeasurementUpdateAction(before, after, selectedSheet);
        }
      }
    },
    onError: (error: unknown, variables) => {
      // Task #1970 — Mirror the markup not_found prune (Task #1837)
      // for measurements: when the server reports the measurement is
      // already gone (typically a teammate deleted it on another
      // device), drop it out of the cached measurements list and
      // clear it from the workspace selection so the user can't keep
      // re-trying an edit against a phantom row that will never
      // succeed. Non-not_found failures (network down, validation)
      // stay on the legacy generic toast path with no cache surgery.
      const notFoundIds = extractMeasurementNotFoundIds(
        error,
        variables?.id ? [variables.id] : [],
      );
      if (notFoundIds.length > 0) {
        pruneDeletedMeasurements(notFoundIds, measurementsQueryKey);
        toast({
          title: "Measurement was deleted",
          description:
            "Another teammate removed this measurement, so your edit could not be saved. The canvas has been refreshed.",
          variant: "destructive",
        });
        return;
      }
      // Task #2629 — Optimistic-concurrency 409 conflict. The server
      // refused the PATCH because the row's `version` advanced after
      // we last read it (a teammate edited it on another tab). Pull
      // the current row by invalidating the cache so the canvas
      // re-renders the server's truth, and tell the user to retry
      // their edit on the refreshed value rather than silently
      // overwriting their teammate's change.
      const errMsg = error instanceof Error ? error.message : String(error ?? "");
      const errStatus = (error as { status?: number } | null)?.status;
      const errData = (error as { data?: { reason?: string; current?: TakeoffMeasurement; currentVersion?: number; lastEditor?: { id: string; firstName: string | null; lastName: string | null; editedAt: string } | null } } | null)?.data;
      if (errStatus === 409 || errData?.reason === "version_conflict" || /\b409\b|version_conflict/.test(errMsg)) {
        if (selectedSheet) {
          queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
        }
        // Task #2629 — Capture the conflict so the workspace can show
        // a side-by-side resolution dialog ("keep theirs" vs
        // "overwrite") instead of just a destructive toast.
        // Task #2652 — Pass through the server-supplied `lastEditor`
        // so the dialog can name the teammate who saved over the row.
        const { id, skipHistory: _skip, previous: _prev, ...pendingEdit } = variables ?? ({} as Record<string, unknown>);
        if (id) {
          setMeasurementConflict({
            measurementId: String(id),
            pendingEdit: pendingEdit as Record<string, unknown>,
            serverRow: errData?.current ?? null,
            currentVersion: typeof errData?.currentVersion === "number" ? errData.currentVersion : null,
            lastEditor: errData?.lastEditor ?? null,
          });
        }
        toast({
          title: "Edit conflict",
          description:
            "Another teammate updated this measurement while you were editing. Pick whose version to keep.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Error", description: "Failed to update measurement", variant: "destructive" });
    },
  });

  // Task #2334 — Per-row "Unlock & rescale" mutation. Releases a
  // measurement from the `lockedScalePxPerFoot` snapshot it was
  // captured into during a previous re-calibration's lock branch
  // (Task #2326) and asks the server to re-derive its
  // `computedLengthFt` / `computedAreaFt2` against the sheet's
  // current scale. The server is authoritative for the recompute so
  // the client just invalidates the measurements cache; we don't
  // optimistically guess at the new quantity values because the
  // formula depends on per-type geometry that the workspace doesn't
  // duplicate. The not_found 404 path reuses the existing
  // `extractMeasurementNotFoundIds` / `pruneDeletedMeasurements`
  // helpers so a teammate-deleted row drops out of the cache and the
  // selection set in the same gesture, matching the per-id PATCH.
  const unlockAndRescaleMeasurementMutation = useMutation({
    mutationFn: async (input: string | { id: string; expectedVersion?: number; forceOverwrite?: boolean }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot unlock measurements while viewing a locked version");
      }
      const id = typeof input === "string" ? input : input.id;
      const explicitVersion = typeof input === "string" ? undefined : input.expectedVersion;
      const forceOverwrite = typeof input !== "string" && input.forceOverwrite === true;
      // Task #2653 — Auto-attach the cached row's `version` as
      // `expectedVersion` so the unlock-rescale path engages CAS by
      // default. Mirrors `updateMeasurementMutation` (Task #2629).
      let resolvedVersion: number | undefined = explicitVersion;
      if (resolvedVersion === undefined && !forceOverwrite && selectedSheet) {
        const cached = queryClient.getQueryData<TakeoffMeasurement[]>([
          "/api/takeoff/sheets",
          selectedSheet,
          "measurements",
        ]);
        const row = cached?.find((m) => m.id === id) as (TakeoffMeasurement & { version?: number }) | undefined;
        if (row && typeof row.version === "number") resolvedVersion = row.version;
      }
      const body: Record<string, unknown> | undefined =
        resolvedVersion !== undefined && !forceOverwrite ? { expectedVersion: resolvedVersion } : undefined;
      const res = await apiRequest("POST", `/api/takeoff/measurements/${id}/unlock-rescale`, body);
      return res.json() as Promise<TakeoffMeasurement & { unlocked?: boolean }>;
    },
    onSuccess: (data, variables) => {
      const measurementId = typeof variables === "string" ? variables : variables.id;
      queryClient.invalidateQueries({ queryKey: measurementsQueryKey });
      if (selectedSheet) {
        onCollabBroadcast?.("MEASUREMENT_UPDATED", { sheetId: selectedSheet, measurementId });
      }
      // The route returns `unlocked: false` in the idempotent
      // no-op case (the row was already unlocked — usually a stale
      // optimistic cache or a teammate beat us to it). Don't claim
      // we just unlocked something we didn't.
      if (data && data.unlocked === false) {
        toast({
          title: "Already unlocked",
          description: "This measurement was already tracking the sheet's current scale.",
        });
        return;
      }
      toast({
        title: "Measurement unlocked",
        description: "Length and area now follow the sheet's current scale.",
      });
    },
    onError: (error: unknown, variables) => {
      const measurementId = typeof variables === "string" ? variables : variables?.id;
      const notFoundIds = extractMeasurementNotFoundIds(
        error,
        measurementId ? [measurementId] : [],
      );
      if (notFoundIds.length > 0) {
        pruneDeletedMeasurements(notFoundIds, measurementsQueryKey);
        toast({
          title: "Measurement was deleted",
          description:
            "Another teammate removed this measurement, so the unlock could not be applied. The canvas has been refreshed.",
          variant: "destructive",
        });
        return;
      }
      // Task #2653 — Surface measurement version_conflict 409s
      // from the unlock-rescale path through the same dialog the
      // per-id PATCH uses. Mirrors `updateMeasurementMutation`.
      const data = (error as { data?: { reason?: string; current?: TakeoffMeasurement | null; currentVersion?: number | null } } | undefined)?.data;
      if (data?.reason === "version_conflict" && measurementId) {
        setMeasurementConflict({
          measurementId,
          pendingEdit: { action: "unlock_and_rescale" },
          serverRow: data.current ?? null,
          currentVersion: data.currentVersion ?? null,
          lastEditor: null,
        });
        toast({
          title: "Measurement was modified",
          description:
            "Another teammate updated this measurement — review their version before unlocking.",
          variant: "destructive",
        });
        return;
      }
      // 400 sheet_not_calibrated has its own friendly toast so the
      // user is told to calibrate the sheet before retrying.
      if (data?.reason === "sheet_not_calibrated") {
        toast({
          title: "Sheet is not calibrated",
          description: "Calibrate the sheet's scale before unlocking measurements.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Error", description: "Failed to unlock measurement", variant: "destructive" });
    },
  });

  // Task #2357 — Bulk "Unlock & rescale" mutation. Releases N
  // measurements from their `lockedScalePxPerFoot` snapshots in one
  // round-trip and asks the server to re-derive each row's
  // `computedLengthFt` / `computedAreaFt2` against the sheet's
  // current scale. Companion to `unlockAndRescaleMeasurementMutation`
  // above (Task #2334) for the per-row affordance: an estimator who
  // mistakenly chose "Lock existing measurements" on a sheet
  // re-calibration can release every locked row in a single click
  // instead of clicking each lock icon individually.
  //
  // The server is authoritative for the recompute (formulas depend on
  // per-type geometry the workspace doesn't duplicate), so we just
  // invalidate the measurements cache and broadcast a per-row
  // collab event so other viewers see the rescaled values right
  // away. The toast count comes from the server's `unlockedCount`
  // (so already-unlocked rows in the batch don't inflate the message)
  // and the not_found / sheet_not_calibrated error shapes mirror the
  // per-row mutation so the existing `extractMeasurementNotFoundIds`
  // / `pruneDeletedMeasurements` helpers prune deleted rows out of
  // the cache + selection in the same gesture.
  const bulkUnlockAndRescaleMeasurementsMutation = useMutation({
    mutationFn: async (input: string[] | { ids: string[]; versions?: Record<string, number>; forceOverwrite?: boolean }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot unlock measurements while viewing a locked version");
      }
      const ids = Array.isArray(input) ? input : input.ids;
      const explicitVersions = Array.isArray(input) ? undefined : input.versions;
      const forceOverwrite = !Array.isArray(input) && input.forceOverwrite === true;
      // Task #2653 — Auto-attach a `versions` map (id → cached
      // `version`) so the bulk path engages CAS by default. Mirrors
      // `bulkUpdateMeasurementsMutation` and the per-row unlock.
      let versions: Record<string, number> | undefined = explicitVersions;
      if (!versions && !forceOverwrite && selectedSheet) {
        const cached = queryClient.getQueryData<TakeoffMeasurement[]>([
          "/api/takeoff/sheets",
          selectedSheet,
          "measurements",
        ]);
        const cachedById = new Map<string, TakeoffMeasurement & { version?: number }>(
          (cached ?? []).map((m) => [m.id, m as TakeoffMeasurement & { version?: number }]),
        );
        const acc: Record<string, number> = {};
        for (const id of ids) {
          const row = cachedById.get(id);
          if (row && typeof row.version === "number") acc[id] = row.version;
        }
        if (Object.keys(acc).length > 0) versions = acc;
      }
      const body: Record<string, unknown> = { ids };
      if (versions && !forceOverwrite) body.versions = versions;
      const res = await apiRequest("POST", `/api/takeoff/measurements/bulk-unlock-rescale`, body);
      return res.json() as Promise<{
        measurements: TakeoffMeasurement[];
        unlockedCount: number;
        alreadyUnlockedIds: string[];
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: measurementsQueryKey });
      if (selectedSheet) {
        for (const m of data.measurements) {
          onCollabBroadcast?.("MEASUREMENT_UPDATED", { sheetId: selectedSheet, measurementId: m.id });
        }
      }
      const count = data.unlockedCount;
      if (count === 0) {
        toast({
          title: "Already unlocked",
          description: "These measurements were already tracking the sheet's current scale.",
        });
        return;
      }
      toast({
        title: count === 1 ? "Measurement unlocked" : `${count} measurements unlocked`,
        description: "Length and area now follow the sheet's current scale.",
      });
    },
    onError: (error: unknown, variables) => {
      const ids = Array.isArray(variables) ? variables : variables?.ids ?? [];
      const notFoundIds = extractMeasurementNotFoundIds(error, ids);
      if (notFoundIds.length > 0) {
        pruneDeletedMeasurements(notFoundIds, measurementsQueryKey);
        toast({
          title: "Some measurements were deleted",
          description:
            "Another teammate removed one or more of these measurements, so the unlock could not be applied. The canvas has been refreshed.",
          variant: "destructive",
        });
        return;
      }
      const data = (error as { data?: { reason?: string; failedMeasurementIds?: string[]; conflicts?: Array<{ id: string; currentVersion?: number | null; current?: TakeoffMeasurement | null; expectedVersion?: number | null }> } } | undefined)?.data;
      // Task #2653 — Bulk-unlock 409: surface the first conflict
      // through the same dialog the per-id PATCH uses + show a
      // batch-aware toast so the user knows other rows were also
      // touched. Mirrors the bulk PATCH onError below.
      if (data?.reason === "version_conflict" && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        const first = data.conflicts[0];
        setMeasurementConflict({
          measurementId: first.id,
          pendingEdit: { action: "bulk_unlock_and_rescale" },
          serverRow: first.current ?? null,
          currentVersion: first.currentVersion ?? null,
          lastEditor: null,
        });
        toast({
          title: data.conflicts.length === 1 ? "Measurement was modified" : `${data.conflicts.length} measurements were modified`,
          description:
            "Another teammate updated some of these measurements — refresh and retry.",
          variant: "destructive",
        });
        return;
      }
      if (data?.reason === "sheet_not_calibrated") {
        toast({
          title: "Sheet is not calibrated",
          description: "Calibrate the sheet's scale before unlocking these measurements.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Error",
        description: "Failed to unlock measurements",
        variant: "destructive",
      });
    },
  });

  // Task #1989 — Bulk PATCH for editing N measurements in a single
  // round-trip. Mirrors `bulkUpdateMarkupsMutation` (Task #1752 /
  // #1765) so a multi-select category re-assign / cost-code rename
  // collapses into one HTTP request and one cache invalidation
  // instead of fanning out N parallel `updateMeasurementMutation`
  // calls (each one its own audit-log entry on the server and its
  // own `queryClient.invalidateQueries` refetch flicker).
  //
  // Optimistic update mirrors `updateMeasurementMutation` so the
  // affected rows reflect the new values immediately in the
  // properties panel and the list, instead of snapping to the old
  // values until the round-trip resolves. On atomic failure the
  // pre-mutation cache snapshot is restored in one write — no
  // sibling-by-sibling unwind. The `not_found` 404 path reuses the
  // existing `extractMeasurementNotFoundIds` / `pruneDeletedMeasurements`
  // helpers (Task #1970) so deleted-by-teammate rows drop out of the
  // cache and the workspace selection in the same gesture, matching
  // the per-id mutation's behavior.
  //
  // Callers pass `previous` per entry so the mutation can record a
  // single MEASUREMENT_UPDATE_BATCH history entry on success — that
  // wiring is currently driven by the sidebar (which pushes the batch
  // entry directly via `pushMeasurementUpdateBatch` after
  // `mutateAsync` resolves), so the mutation here does NOT push its
  // own entry. Keeping that responsibility in the caller mirrors how
  // `bulkUpdateMarkupsMutation` defers to `commitMarkupBodyDrag` for
  // the markup batch entry.
  const bulkUpdateMeasurementsMutation = useMutation({
    mutationFn: async (data: {
      updates: {
        id: string;
        label?: string;
        categoryId?: string | null;
        costCodeId?: string | null;
        unitCost?: number | null;
        groupId?: string | null;
        lineStyle?: string;
        lineWidth?: number;
        metadata?: string;
        color?: string;
        note?: string | null;
        locationId?: string | null;
        // Task #2653 — Per-row optimistic concurrency. Mirrors the
        // per-id PATCH `expectedVersion` (Task #2629). Auto-attached
        // below from the cached row's `version` when not provided
        // so callers (sidebar bulk-assign, replay paths) get CAS by
        // default. `forceOverwrite` opts back into legacy
        // last-write-wins on the conflict-dialog "overwrite" path.
        expectedVersion?: number;
      }[];
      forceOverwrite?: boolean;
    }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot edit measurements while viewing a locked version");
      }
      const cached = selectedSheet
        ? queryClient.getQueryData<TakeoffMeasurement[]>([
            "/api/takeoff/sheets",
            selectedSheet,
            "measurements",
          ])
        : undefined;
      const cachedById = new Map<string, TakeoffMeasurement & { version?: number }>(
        (cached ?? []).map((m) => [m.id, m as TakeoffMeasurement & { version?: number }]),
      );
      const updates = data.updates.map((u) => {
        if (data.forceOverwrite) {
          const { expectedVersion: _ev, ...rest } = u;
          return rest;
        }
        if (u.expectedVersion !== undefined) return u;
        const row = cachedById.get(u.id);
        if (row && typeof row.version === "number") {
          return { ...u, expectedVersion: row.version };
        }
        return u;
      });
      const res = await apiRequest("PATCH", "/api/takeoff/measurements/bulk", { updates });
      return res.json();
    },
    onMutate: async ({ updates }) => {
      const queryKey = measurementsQueryKey;
      await queryClient.cancelQueries({ queryKey });
      const previousMeasurements = queryClient.getQueryData<TakeoffMeasurement[]>(queryKey);
      if (previousMeasurements) {
        const byId = new Map(updates.map((u) => [u.id, u]));
        queryClient.setQueryData<TakeoffMeasurement[]>(queryKey, (old) => {
          if (!old) return old;
          return old.map((m) => {
            const u = byId.get(m.id);
            if (!u) return m;
            const next: TakeoffMeasurement = { ...m };
            if (u.label !== undefined) next.label = u.label;
            if (u.categoryId !== undefined) next.categoryId = u.categoryId;
            if (u.costCodeId !== undefined) next.costCodeId = u.costCodeId;
            if (u.unitCost !== undefined) next.unitCost = u.unitCost;
            if (u.groupId !== undefined) next.groupId = u.groupId;
            if (u.lineStyle !== undefined) next.lineStyle = u.lineStyle;
            if (u.lineWidth !== undefined) next.lineWidth = u.lineWidth;
            if (u.metadata !== undefined) next.metadata = u.metadata;
            if (u.color !== undefined) next.color = u.color;
            if (u.note !== undefined) next.note = u.note;
            if (u.locationId !== undefined) next.locationId = u.locationId;
            return next;
          });
        });
      }
      return { previousMeasurements, queryKey, attemptedIds: updates.map((u) => u.id) };
    },
    onSuccess: (_data, _vars, _ctx) => {
      queryClient.invalidateQueries({ queryKey: measurementsQueryKey });
    },
    onError: (error: unknown, _vars, ctx) => {
      // Atomic rollback: restore the pre-mutation snapshot in one
      // write so a 50-row failure doesn't leave the canvas in a
      // half-applied state.
      if (ctx?.previousMeasurements) {
        queryClient.setQueryData(ctx.queryKey, ctx.previousMeasurements);
      }
      // Task #1970 reuse — when the server reports any of the rows
      // are gone (typically a teammate deleted them on another
      // device), drop them out of the cached list AND the workspace
      // selection so the user can't keep retrying an edit against a
      // phantom row. Other reasons (locked / cross_sheet / network)
      // stay on the legacy generic toast path with no cache surgery.
      const notFoundIds = extractMeasurementNotFoundIds(
        error,
        ctx?.attemptedIds ?? [],
      );
      if (notFoundIds.length > 0) {
        pruneDeletedMeasurements(notFoundIds, ctx?.queryKey ?? measurementsQueryKey);
        toast({
          title: "Measurement was deleted",
          description:
            "Another teammate removed one or more of these measurements, so your edits could not be saved. The canvas has been refreshed.",
          variant: "destructive",
        });
        return;
      }
      // Task #2653 — Surface bulk PATCH 409 version_conflict
      // through the same dialog the per-id PATCH uses + a
      // batch-aware toast.
      const data = (error as { data?: { reason?: string; conflicts?: Array<{ id: string; currentVersion?: number | null; current?: TakeoffMeasurement | null; expectedVersion?: number | null }> } } | undefined)?.data;
      if (data?.reason === "version_conflict" && Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        const first = data.conflicts[0];
        setMeasurementConflict({
          measurementId: first.id,
          pendingEdit: { action: "bulk_update" },
          serverRow: first.current ?? null,
          currentVersion: first.currentVersion ?? null,
          lastEditor: null,
        });
        toast({
          title: data.conflicts.length === 1 ? "Measurement was modified" : `${data.conflicts.length} measurements were modified`,
          description:
            "Another teammate edited some of these measurements — refresh and retry.",
          variant: "destructive",
        });
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof (error as { message: unknown }).message === "string"
            ? (error as { message: string }).message
            : null;
      const description = message || "Failed to update measurements";
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  const deleteMeasurementMutation = useMutation({
    mutationFn: async (measurement: TakeoffMeasurement) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot delete measurements while viewing a locked version");
      }
      await apiRequest("DELETE", `/api/takeoff/measurements/${measurement.id}`);
      return measurement;
    },
    onSuccess: (deleted: TakeoffMeasurement) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      callbacks.setSelectedMeasurementId(null);
      if (selectedSheet) {
        takeoffHistory.pushAction("DELETE", deleted, selectedSheet);
        onCollabBroadcast?.("MEASUREMENT_DELETED", { sheetId: selectedSheet, measurementId: deleted.id });
      }
      toast({ title: "Success", description: "Measurement deleted" });
    },
    onError: (error: unknown, measurement) => {
      // Task #1988 — Mirror the PATCH not_found prune (Task #1970) for
      // the per-id DELETE path: when the server reports the row is
      // already gone (typically because a teammate removed it on
      // another device), drop it out of the cached measurements list
      // and clear it from the workspace selection so the user can't
      // keep re-trying a delete against a phantom row that will never
      // exist. Non-not_found failures (network down, 403) stay on the
      // legacy generic toast path with no cache surgery.
      const notFoundIds = extractMeasurementNotFoundIds(
        error,
        measurement ? [measurement.id] : [],
      );
      if (notFoundIds.length > 0) {
        pruneDeletedMeasurements(notFoundIds, measurementsQueryKey);
        toast({
          title: "Measurement was already deleted",
          description:
            "Another teammate already removed this measurement, so the canvas has been refreshed.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Error", description: "Failed to delete measurement", variant: "destructive" });
    },
  });

  // Task #1901 — Bulk DELETE for measurements with a visible Undo
  // toast, mirroring the markup affordance from #1882. The measurements
  // API has no `/bulk` DELETE endpoint today (unlike #1832 for markups),
  // so the mutation fans out per-id DELETEs via Promise.all and
  // optimistically removes the rows from cache up front. On success we
  // push exactly one MEASUREMENT_DELETE_BATCH history entry (the Undo
  // button replays it via takeoffHistory.undo() — Cmd/Ctrl+Z works in
  // parallel through the same entry) and surface a destructive toast
  // with an explicit Undo button. The toast carries a `duration` so the
  // shared toast hook auto-dismisses it (without `duration`,
  // TOAST_REMOVE_DELAY pins it forever) and is force-dismissed if the
  // user navigates to a different sheet (see
  // `bulkDeleteMeasurementsToastRef` effect above). On failure we
  // restore the cache snapshot and surface a destructive error toast.
  // We bypass `deleteMeasurementMutation` so its per-id `pushAction`
  // does not pollute history with N entries alongside the batch entry.
  const bulkDeleteMeasurementsMutation = useMutation({
    mutationFn: async (measurementsToDelete: TakeoffMeasurement[]) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot delete measurements while viewing a locked version");
      }
      await Promise.all(
        measurementsToDelete.map((m) =>
          apiRequest("DELETE", `/api/takeoff/measurements/${m.id}`),
        ),
      );
      return measurementsToDelete;
    },
    onMutate: async (measurementsToDelete) => {
      const queryKey = measurementsQueryKey;
      await queryClient.cancelQueries({ queryKey });
      const previousMeasurements = queryClient.getQueryData<TakeoffMeasurement[]>(queryKey);
      const ids = new Set(measurementsToDelete.map((m) => m.id));
      queryClient.setQueryData<TakeoffMeasurement[]>(queryKey, (old) =>
        old ? old.filter((m) => !ids.has(m.id)) : old,
      );
      return { previousMeasurements, queryKey };
    },
    onSuccess: (deleted) => {
      queryClient.invalidateQueries({ queryKey: measurementsQueryKey });
      callbacks.setSelectedMeasurementId(null);
      if (selectedSheet) {
        takeoffHistory.pushMeasurementDeleteBatchAction(deleted, selectedSheet);
        // Mirror the per-id mutation's collab fan-out so the other
        // viewers' canvases drop the rows in real time too.
        for (const m of deleted) {
          onCollabBroadcast?.("MEASUREMENT_DELETED", { sheetId: selectedSheet, measurementId: m.id });
        }
      }
      const count = deleted.length;
      if (count > 0 && selectedSheet) {
        bulkDeleteMeasurementsToastRef.current?.dismiss();
        const sheetIdAtDelete = selectedSheet;
        const handle = toast({
          variant: "destructive",
          title: `Deleted ${count} ${count === 1 ? "measurement" : "measurements"}`,
          duration: 8000,
          action: (
            <ToastAction
              altText="Undo bulk delete of measurements"
              data-testid="button-toast-undo-bulk-delete-measurements"
              onClick={() => {
                bulkDeleteMeasurementsToastRef.current = null;
                takeoffHistory.undo();
              }}
            >
              Undo
            </ToastAction>
          ),
        });
        bulkDeleteMeasurementsToastRef.current = { dismiss: handle.dismiss, sheetId: sheetIdAtDelete };
      }
    },
    onError: (error: any, _vars, ctx) => {
      // Task #1988 — Mirror the PATCH not_found prune (Task #1970) on
      // the bulk DELETE path: when one of the per-id DELETEs comes back
      // with `reason: "not_found"` (a teammate already removed that row
      // on another device), drop those ids out of the optimistic-
      // rollback snapshot so the canvas does NOT put a phantom row
      // back. The remaining rows from the snapshot are restored as
      // before so the user can retry whatever else failed (network
      // hiccup, validation, etc.). The pruned ids are also cleared
      // from the workspace selection set so the properties panel can't
      // re-edit a row that no longer exists.
      //
      // Note: the per-id calls fan out via Promise.all, so only the
      // first rejection surfaces here. That is enough to clear the
      // teammate-deleted rows the server explicitly enumerates in
      // `failedMeasurementIds`; any additional teammate-deletes from
      // sibling per-id calls would be reconciled on the next refetch.
      const notFoundIds = extractMeasurementNotFoundIds(error, []);
      if (ctx?.previousMeasurements) {
        if (notFoundIds.length > 0) {
          const notFoundSet = new Set(notFoundIds);
          queryClient.setQueryData<TakeoffMeasurement[]>(
            ctx.queryKey,
            ctx.previousMeasurements.filter((m) => !notFoundSet.has(m.id)),
          );
        } else {
          queryClient.setQueryData(ctx.queryKey, ctx.previousMeasurements);
        }
      }
      if (notFoundIds.length > 0) {
        callbacks.pruneSelectedMeasurementIds?.(notFoundIds);
        const count = notFoundIds.length;
        toast({
          title:
            count === 1
              ? "Measurement was already deleted"
              : "Some measurements were already deleted",
          description:
            count === 1
              ? "A teammate already removed it before your bulk delete completed, so the canvas has been refreshed."
              : `A teammate already removed ${count} of them before your bulk delete completed, so the canvas has been refreshed.`,
          variant: "destructive",
        });
        return;
      }
      const description =
        (typeof error === "object" && error && typeof error.message === "string"
          ? error.message
          : null) || "Failed to delete measurements";
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  const { data: categories = [] } = useQuery<QuantityCategory[]>({
    queryKey: categoriesQueryKey,
  });

  const saveCategoryMutation = useMutation({
    mutationFn: async (data: { id?: string; name: string; color: string; lineStyle?: string; lineWidth?: number; displayOrder?: number; wasteFactor?: number; unitCost?: number | null }) => {
      let response;
      const payload: any = {
        name: data.name,
        color: data.color,
        lineStyle: data.lineStyle || "solid",
        lineWidth: data.lineWidth || 3,
        wasteFactor: data.wasteFactor ?? 0,
        unitCost: data.unitCost ?? null,
      };
      if (data.id) {
        response = await apiRequest("PATCH", `/api/quantity-categories/${data.id}`, payload);
      } else {
        const url = isBid
          ? `/api/bids/${ctxId}/takeoff/categories`
          : `/api/projects/${ctxCode}/quantity-categories`;
        response = await apiRequest("POST", url, {
          ...payload,
          displayOrder: categories.length
        });
      }
      return await response.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: categoriesQueryKey });
      callbacks.setCategoryDialogOpen(false);
      callbacks.setEditingCategory(null);
      callbacks.setCategoryName("");
      callbacks.setCategoryColor("#3b82f6");
      if (!variables.id && data?.id) {
        callbacks.setSelectedCategoryId(data.id);
        toast({
          title: "Success",
          description: "Category created and selected for measurements"
        });
      } else {
        toast({ title: "Success", description: "Category updated" });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save category", variant: "destructive" });
    },
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (categoryId: string) => {
      return await apiRequest("DELETE", `/api/quantity-categories/${categoryId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: categoriesQueryKey });
      toast({ title: "Success", description: "Category deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete category", variant: "destructive" });
    },
  });

  const sheetsInvalidateKey = isBid
    ? `/api/bids/${ctxId}/takeoff/sheets`
    : `/api/projects/${ctxId}/takeoff/sheets`;

  const renameSheetMutation = useMutation({
    mutationFn: async ({ sheetId, sheetName }: { sheetId: string; sheetName: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/rename`, { sheetName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      // Task #1913 — sheet_name change shifts which sheet a set's pinned
      // revision matches as the latest active, so refresh every set's
      // compare query (mirrors PlansTab #1895 behavior).
      invalidateDrawingSetCompares();
      callbacks.setRenameDialogOpen(false);
      toast({ title: "Sheet renamed" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to rename sheet", variant: "destructive" });
    },
  });

  const duplicateSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${sheetId}/duplicate`);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      // Task #1913 — duplicate creates a new active sheet that may match
      // a pinned sheet name, flipping a set from "Up to date" to "newer".
      invalidateDrawingSetCompares();
      if (data?.sheet?.id) callbacks.setSelectedSheet(data.sheet.id);
      toast({ title: "Sheet duplicated", description: `${data?.measurementsCopied || 0} measurements copied` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to duplicate sheet", variant: "destructive" });
    },
  });

  // Task #1902 — Restores a sheet (and every measurement / markup
  // that was on it) from the snapshot the DELETE handler returned.
  // Powers the Undo action on the destructive "Deleted sheet" toast
  // shown by `deleteSheetMutation` below. The server preserves
  // original ids in the round-trip so any downstream cache that
  // still references the old sheet id resolves after the restore.
  const restoreSheetMutation = useMutation({
    mutationFn: async (snapshot: { sheet: { id: string; sheetName?: string | null }; measurements: any[]; markups: any[] }) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${snapshot.sheet.id}/restore`, snapshot);
      return res.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      // Task #1913 — restore re-activates a previously-deleted sheet, so
      // it can flip every set's compare back to the pre-delete staleness
      // state. Mirror the deleteSheetMutation invalidation above so the
      // SetStaleBadge stays in sync with the round-trip.
      invalidateDrawingSetCompares();
      const restoredId: string | undefined = data?.sheet?.id || variables.sheet.id;
      if (restoredId) {
        // Re-select the restored sheet so the canvas immediately
        // shows the user what just came back. The bid / project
        // measurement count tile also refreshes via the
        // all-measurements query.
        callbacks.setSelectedSheet(restoredId);
        queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", restoredId, "measurements"] });
        queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", restoredId, "markups"] });
        queryClient.invalidateQueries({ queryKey: [allMeasurementsUrl] });
      }
      const sheetName = data?.sheet?.sheetName || variables.sheet.sheetName || "Sheet";
      toast({ title: "Sheet restored", description: `"${sheetName}" is back on the takeoff workspace.` });
    },
    onError: (error: any) => {
      const description = (typeof error === "object" && error && typeof error.message === "string"
        ? error.message
        : null) || "Failed to restore sheet";
      toast({ title: "Couldn't undo sheet deletion", description, variant: "destructive" });
    },
  });

  const deleteSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      // Capture the human-readable sheet name from local cache before
      // the row vanishes; the server snapshot also carries it but
      // having it on the client side lets us name the toast even if
      // the server response shape ever drifts.
      const cached = sheets.find(s => s.id === sheetId);
      const res = await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}?confirm=true`);
      const data = await res.json();
      return { ...data, _deletedSheetName: cached?.sheetName ?? data?.snapshot?.sheet?.sheetName ?? null };
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      // Task #1913 — deleting a sheet drops it from the project's active
      // set, potentially clearing or revealing a newer revision for any
      // set, so refresh every set's compare (mirrors PlansTab #1895).
      invalidateDrawingSetCompares();
      callbacks.setSelectedSheet(sheets.length > 1 ? sheets.find(s => s.id !== selectedSheet)?.id || null : null);
      callbacks.setDeleteSheetConfirmOpen(false);
      // Task #1902 — Surface a destructive-style toast with an Undo
      // button that POSTs the snapshot to the companion restore
      // route. Falls back to the legacy plain "Sheet deleted" toast
      // if the server didn't return a snapshot (e.g. older API or
      // schema gap), so a non-undoable deletion still notifies.
      const snapshot = data?.snapshot;
      if (snapshot?.sheet?.id) {
        sheetDeleteToastRef.current?.dismiss();
        const measurementsCount = Number(data?.measurementsDeleted ?? snapshot.measurements?.length ?? 0);
        const markupsCount = Number(data?.markupsDeleted ?? snapshot.markups?.length ?? 0);
        const counts: string[] = [];
        if (measurementsCount > 0) counts.push(`${measurementsCount} measurement${measurementsCount === 1 ? "" : "s"}`);
        if (markupsCount > 0) counts.push(`${markupsCount} markup${markupsCount === 1 ? "" : "s"}`);
        const description = counts.length > 0 ? `Removed ${counts.join(" and ")}.` : undefined;
        const sheetName = data?._deletedSheetName || snapshot.sheet.sheetName || "Sheet";
        const handle = toast({
          variant: "destructive",
          title: `Deleted "${sheetName}"`,
          description,
          duration: 8000,
          action: (
            <ToastAction
              altText="Undo sheet deletion"
              data-testid="button-toast-undo-delete-sheet"
              onClick={() => {
                sheetDeleteToastRef.current = null;
                restoreSheetMutation.mutate(snapshot);
              }}
            >
              Undo
            </ToastAction>
          ),
        });
        sheetDeleteToastRef.current = { dismiss: handle.dismiss };
      } else {
        toast({ title: "Sheet deleted" });
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete sheet", variant: "destructive" });
    },
  });

  const createMarkupMutation = useMutation({
    mutationFn: async (data: {
      sheetId: string;
      tool: string;
      points: { x: number; y: number }[];
      color: string;
      thickness: number;
      text?: string;
      categoryId?: string | null;
    }) => {
      const res = await apiRequest("POST", "/api/takeoff/markups", data);
      return res.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
      if (selectedSheet && created?.id) {
        const normalized = { ...created, points: typeof created.points === "string" ? JSON.parse(created.points) : created.points };
        takeoffHistory.pushMarkupAction("MARKUP_CREATE", normalized, selectedSheet);
      }
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save markup", variant: "destructive" });
    },
  });

  const updateMarkupMutation = useMutation({
    mutationFn: async (data: {
      id: string;
      color?: string;
      thickness?: number;
      text?: string | null;
      points?: { x: number; y: number }[];
      previous?: {
        color?: string;
        thickness?: number;
        text?: string | null;
        points?: { x: number; y: number }[];
      };
      // Task #1755 — when a multi-select body drag fans out into N
      // parallel PATCHes, the caller already pushed a single
      // MARKUP_UPDATE_BATCH history entry for the whole gesture, so the
      // per-mutation onSuccess must NOT push its own MARKUP_UPDATE entry
      // (otherwise the user is back to N+1 Undo presses to reverse one
      // drag). Single-markup drags omit this flag and keep producing
      // exactly one MARKUP_UPDATE entry — no regression.
      skipHistory?: boolean;
    }) => {
      const { id, previous, skipHistory, ...updates } = data;
      const res = await apiRequest("PATCH", `/api/takeoff/markups/${id}`, updates);
      const result = await res.json();
      return { result, id, updates, previous, skipHistory };
    },
    // Task #1735 — Optimistically rewrite the cached markup before the
    // PATCH lands so a body drag does not snap back to its pre-drag
    // location for the few hundred ms between drag-end and the
    // invalidation refetch. The Konva group's position is reset to the
    // origin on drag-end (`e.target.position({...})` in
    // TakeoffWorkspace.onBodyDragEnd), so the new pixel location is
    // only visible if the cache already holds the translated points.
    // Mirrors the bulkMoveMutation onMutate/onError pattern used by
    // PlanMarkupLayer for plan-side group drags.
    onMutate: async ({ id, color, thickness, text, points }) => {
      const queryKey = ["/api/takeoff/sheets", selectedSheet, "markups"];
      await queryClient.cancelQueries({ queryKey });
      const previousMarkups = queryClient.getQueryData<TakeoffMarkupWithAuthor[]>(queryKey);
      if (previousMarkups) {
        queryClient.setQueryData<TakeoffMarkupWithAuthor[]>(queryKey, (old) => {
          if (!old) return old;
          return old.map((m) => {
            if (m.id !== id) return m;
            const next = { ...m };
            if (color !== undefined) next.color = color;
            if (thickness !== undefined) next.thickness = thickness;
            if (text !== undefined) next.text = text;
            if (points !== undefined) next.points = points;
            return next;
          });
        });
      }
      return { previousMarkups, queryKey };
    },
    onSuccess: ({ id, updates, previous, skipHistory }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
      if (selectedSheet && previous && !skipHistory) {
        const before: { id: string; color?: string; thickness?: number; text?: string | null; points?: { x: number; y: number }[] } = { id };
        const after: { id: string; color?: string; thickness?: number; text?: string | null; points?: { x: number; y: number }[] } = { id };
        let hasChange = false;
        if (updates.color !== undefined && previous.color !== undefined) {
          before.color = previous.color; after.color = updates.color; hasChange = true;
        }
        if (updates.thickness !== undefined && previous.thickness !== undefined) {
          before.thickness = previous.thickness; after.thickness = updates.thickness; hasChange = true;
        }
        if (updates.text !== undefined && previous.text !== undefined) {
          before.text = previous.text; after.text = updates.text; hasChange = true;
        }
        if (updates.points !== undefined && previous.points !== undefined) {
          before.points = previous.points; after.points = updates.points; hasChange = true;
        }
        if (hasChange) {
          takeoffHistory.pushMarkupUpdateAction(before, after, selectedSheet);
        }
      }
    },
    onError: (error, vars, ctx) => {
      // Task #1735 — Roll the cache back to its pre-drag points so the
      // markup returns to its real location instead of being stranded
      // at the failed optimistic position.
      if (ctx?.previousMarkups) {
        queryClient.setQueryData(ctx.queryKey, ctx.previousMarkups);
      }
      // Task #1768 — Single-markup edits and resizes route through this
      // mutation too, so reuse the same per-id / per-reason toast and
      // canvas-flash treatment used by the bulk path. The structured
      // server response (`reason`, `failedMarkupIds`) lets us name the
      // markup and tell the user *why* it rejected (deleted, owned by
      // another user, etc.) instead of the legacy generic toast.
      const cachedMarkups = ctx?.previousMarkups
        ?? queryClient.getQueryData<TakeoffMarkupWithAuthor[]>(["/api/takeoff/sheets", selectedSheet, "markups"])
        ?? [];
      const summary = buildMarkupFailureSummary({
        error,
        attemptedMarkupIds: vars?.id ? [vars.id] : [],
        markups: cachedMarkups.map(m => ({ id: m.id, tool: m.tool, text: m.text })),
      });
      // Task #1837 — If the server reports the markup was deleted
      // out from under us (typically a teammate on another device),
      // surgically remove it from the cached markups list (the
      // `previousMarkups` rollback above just put it back) and prune
      // it out of the workspace selection set so the canvas state
      // matches what the server believes BEFORE the toast names it.
      pruneDeletedMarkups(
        summary,
        ctx?.queryKey ?? ["/api/takeoff/sheets", selectedSheet, "markups"],
      );
      flashFailedMarkupIds(summary.failedMarkupIds);
      toast({ title: summary.title, description: summary.description, variant: "destructive" });
    },
  });

  // Task #1752 — bulk PATCH for group-drag commits. The legacy
  // `onBodyDragEnd` path fanned out N parallel `updateMarkupMutation`
  // calls per multi-select drag, each one a separate HTTP round-trip
  // and each one triggering its own
  // `queryClient.invalidateQueries` refetch of the markups list.
  // This mutation collapses every member of the gesture into a single
  // server request and a single cache invalidation. Optimistic update
  // mirrors `updateMarkupMutation.onMutate` so the dragged markups do
  // not snap back to their pre-drag location while the PATCH is in
  // flight.
  //
  // Task #1765 — Extended to also carry optional `color`, `thickness`,
  // and `text` per entry so the multi-select properties panel can
  // collapse a recolor / restyle into the same single PATCH +
  // single invalidation. The optimistic cache rewrite applies any
  // present field, mirroring `updateMarkupMutation.onMutate` so a
  // bulk recolor lands instantly in the canvas instead of waiting
  // for the round-trip.
  const bulkUpdateMarkupsMutation = useMutation({
    mutationFn: async (data: {
      updates: {
        id: string;
        points?: { x: number; y: number }[];
        color?: string;
        thickness?: number;
        text?: string | null;
      }[];
    }) => {
      const res = await apiRequest("PATCH", "/api/takeoff/markups/bulk", { updates: data.updates });
      return res.json();
    },
    onMutate: async ({ updates }) => {
      const queryKey = ["/api/takeoff/sheets", selectedSheet, "markups"];
      await queryClient.cancelQueries({ queryKey });
      const previousMarkups = queryClient.getQueryData<TakeoffMarkupWithAuthor[]>(queryKey);
      if (previousMarkups) {
        const byId = new Map(updates.map(u => [u.id, u]));
        queryClient.setQueryData<TakeoffMarkupWithAuthor[]>(queryKey, (old) => {
          if (!old) return old;
          return old.map((m) => {
            const u = byId.get(m.id);
            if (!u) return m;
            const next = { ...m };
            if (u.points !== undefined) next.points = u.points;
            if (u.color !== undefined) next.color = u.color;
            if (u.thickness !== undefined) next.thickness = u.thickness;
            if (u.text !== undefined) next.text = u.text;
            return next;
          });
        });
      }
      return { previousMarkups, queryKey, attemptedIds: updates.map(u => u.id) };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.previousMarkups) {
        queryClient.setQueryData(ctx.queryKey, ctx.previousMarkups);
      }
      // Task #1768 — Replace the legacy generic toast with a per-id /
      // per-reason summary so a 50-markup batch failure tells the user
      // *which* siblings rejected and *why* (deleted, owned by another
      // user, etc.) and flashes them on the canvas. Falls back to the
      // raw server message if no structured `reason` is present.
      const cachedMarkups = ctx?.previousMarkups
        ?? queryClient.getQueryData<TakeoffMarkupWithAuthor[]>(["/api/takeoff/sheets", selectedSheet, "markups"])
        ?? [];
      const summary = buildMarkupFailureSummary({
        error,
        attemptedMarkupIds: ctx?.attemptedIds ?? [],
        markups: cachedMarkups.map(m => ({ id: m.id, tool: m.tool, text: m.text })),
      });
      // Task #1837 — Drop any not_found ids out of the cached markups
      // list and the workspace selection set so the canvas matches
      // what the server believes (a teammate deleted those markups
      // from another device). Runs after the rollback above so the
      // surviving siblings still revert to their pre-drag points.
      pruneDeletedMarkups(
        summary,
        ctx?.queryKey ?? ["/api/takeoff/sheets", selectedSheet, "markups"],
      );
      flashFailedMarkupIds(summary.failedMarkupIds);
      toast({ title: summary.title, description: summary.description, variant: "destructive" });
    },
  });

  const deleteMarkupMutation = useMutation({
    mutationFn: async (markup: TakeoffMarkupWithAuthor | string) => {
      const markupId = typeof markup === "string" ? markup : markup.id;
      await apiRequest("DELETE", `/api/takeoff/markups/${markupId}`);
      return typeof markup === "string" ? null : markup;
    },
    onSuccess: (deleted) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
      if (selectedSheet && deleted) {
        takeoffHistory.pushMarkupAction("MARKUP_DELETE", deleted as any, selectedSheet);
      }
      toast({ title: "Markup deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete markup", variant: "destructive" });
    },
  });

  // Task #1832 — Bulk DELETE collapses N parallel per-id `deleteMarkupMutation`
  // calls into a single transactional round-trip. The optimistic cache update
  // strips every selected markup immediately so the canvas stops rendering
  // them; the server runs the removal inside one transaction so a mid-flight
  // failure rolls back atomically (no half-deleted group). On error we
  // restore the cache snapshot, surface a structured toast naming the
  // offending ids when the server returns them, and keep the original
  // selection for the user to retry.
  const bulkDeleteMarkupsMutation = useMutation({
    mutationFn: async (markupIds: string[]) => {
      const res = await apiRequest("DELETE", "/api/takeoff/markups/bulk", { ids: markupIds });
      return res.json() as Promise<{ ok: boolean; count: number; deletedIds: string[] }>;
    },
    onMutate: async (markupIds) => {
      const queryKey = ["/api/takeoff/sheets", selectedSheet, "markups"];
      await queryClient.cancelQueries({ queryKey });
      const previousMarkups = queryClient.getQueryData<TakeoffMarkupWithAuthor[]>(queryKey);
      const ids = new Set(markupIds);
      const deletedSnapshots = (previousMarkups || []).filter((m) => ids.has(m.id));
      queryClient.setQueryData<TakeoffMarkupWithAuthor[]>(queryKey, (old) =>
        old ? old.filter((m) => !ids.has(m.id)) : old,
      );
      return { previousMarkups, queryKey, deletedSnapshots };
    },
    onSuccess: (_data, _vars, ctx) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
      // Task #1860 — Coalesce the deletion into a single
      // MARKUP_DELETE_BATCH history entry so Undo restores every row
      // in one POST /api/takeoff/markups/restore-bulk round-trip
      // (preserving original ids / authorship / sheet) and Redo
      // re-issues the same bulk DELETE in one round-trip — instead
      // of fanning out N parallel per-id POSTs / DELETEs as the
      // original "one entry per row" approach did.
      //
      // Single-row deletes still go through this same batch entry to
      // keep the history wiring uniform; the restore endpoint accepts
      // a 1-element batch identically to the per-id POST it replaces.
      if (selectedSheet && ctx?.deletedSnapshots && ctx.deletedSnapshots.length > 0) {
        takeoffHistory.pushMarkupDeleteBatchAction(
          ctx.deletedSnapshots as any,
          selectedSheet,
        );
      }
      const count = ctx?.deletedSnapshots.length ?? 0;
      // Task #1882 — Surface the new restore endpoint to non-power
      // users via a destructive-style toast with an explicit Undo
      // button (Cmd/Ctrl+Z still works in parallel via the history
      // entry pushed above). Clicking Undo replays the same
      // MARKUP_DELETE_BATCH undo path (POST /api/takeoff/markups/restore-bulk)
      // by calling `takeoffHistory.undo()`, which the entry above just
      // placed at the top of the undo stack. The toast auto-dismisses
      // after 8s and is also force-dismissed if the user navigates to
      // a different sheet (see `bulkDeleteToastRef` effect above).
      if (count > 0 && selectedSheet) {
        bulkDeleteToastRef.current?.dismiss();
        const sheetIdAtDelete = selectedSheet;
        const handle = toast({
          variant: "destructive",
          title: `Deleted ${count} ${count === 1 ? "markup" : "markups"}`,
          duration: 8000,
          action: (
            <ToastAction
              altText="Undo bulk delete of markups"
              data-testid="button-toast-undo-bulk-delete-markups"
              onClick={() => {
                bulkDeleteToastRef.current = null;
                takeoffHistory.undo();
              }}
            >
              Undo
            </ToastAction>
          ),
        });
        bulkDeleteToastRef.current = { dismiss: handle.dismiss, sheetId: sheetIdAtDelete };
      }
    },
    onError: (error: any, _vars, ctx) => {
      if (ctx?.previousMarkups) {
        queryClient.setQueryData(ctx.queryKey, ctx.previousMarkups);
      }
      const description =
        (typeof error === "object" && error && typeof error.message === "string"
          ? error.message
          : null) || "Failed to delete markups";
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  const reorderSheetsMutation = useMutation({
    mutationFn: async (order: { id: string; sheetIndex: number }[]) => {
      // Task #2552 — Standalone takeoffs now have their own
      // `/api/takeoff/standalone/:id/sheets/reorder` endpoint instead
      // of silently no-op'ing against a project URL the standalone
      // takeoff doesn't belong to.
      const url = isStandalone
        ? `/api/takeoff/standalone/${ctxId}/sheets/reorder`
        : isBid
          ? `/api/bids/${ctxId}/takeoff/sheets/reorder`
          : `/api/projects/${ctxId}/takeoff/sheets/reorder`;
      const res = await apiRequest("PATCH", url, { order });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to reorder sheets", variant: "destructive" });
    },
  });

  const handleMoveSheet = (direction: "up" | "down") => {
    if (!selectedSheet) return;
    const idx = sheets.findIndex(s => s.id === selectedSheet);
    if (idx < 0) return;
    const newIdx = direction === "up" ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= sheets.length) return;
    const reordered = [...sheets];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    reorderSheetsMutation.mutate(reordered.map((s, i) => ({ id: s.id, sheetIndex: i })));
  };

  const conditionsQueryKey = ["/api/takeoff/conditions"];

  const { data: conditions = [] } = useQuery<TakeoffCondition[]>({
    queryKey: conditionsQueryKey,
  });

  const createConditionMutation = useMutation({
    mutationFn: async (data: {
      name: string;
      measurementType: string;
      color: string;
      categoryName?: string;
      unitCost?: number;
      costCodeId?: string;
      assemblyId?: string;
      lineStyle?: string;
      labelTemplate?: string;
    }) => {
      const res = await apiRequest("POST", "/api/takeoff/conditions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conditionsQueryKey });
      toast({ title: "Condition saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save condition", variant: "destructive" });
    },
  });

  const updateConditionMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; measurementType?: string; color?: string; categoryName?: string | null; unitCost?: number | null; costCodeId?: string | null; assemblyId?: string | null; lineStyle?: string | null; labelTemplate?: string | null; sortOrder?: number; lastUsedAt?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/conditions/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conditionsQueryKey });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update condition", variant: "destructive" });
    },
  });

  const deleteConditionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/takeoff/conditions/${id}`);
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: conditionsQueryKey });
      toast({ title: "Condition deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete condition", variant: "destructive" });
    },
  });

  const aggregatedMeasurements = useMemo(() => {
    const byType = {
      linear: [] as TakeoffMeasurement[], area: [] as TakeoffMeasurement[], volume: [] as TakeoffMeasurement[], count: [] as TakeoffMeasurement[],
      linearWithDrop: [] as TakeoffMeasurement[], pitchedLinear: [] as TakeoffMeasurement[], pitchedArea: [] as TakeoffMeasurement[], surfaceArea: [] as TakeoffMeasurement[],
      segment: [] as TakeoffMeasurement[],
    };
    const byCategory: Record<string, TakeoffMeasurement[]> = {};
    const uncategorized: TakeoffMeasurement[] = [];
    let linearTotal = 0, areaTotal = 0, volumeTotal = 0, countTotal = 0;
    let pitchedLinearTotal = 0, pitchedAreaTotal = 0, surfaceAreaTotal = 0, linearWithDropTotal = 0;
    let segmentTotal = 0;

    measurements.forEach(m => {
      if (m.type === "LINEAR") {
        byType.linear.push(m);
        const val = Number(m.computedLengthFt);
        linearTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "AREA") {
        byType.area.push(m);
        const val = Number(m.computedAreaFt2);
        areaTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "VOLUME") {
        byType.volume.push(m);
        const val = Number(m.computedVolumeCy);
        volumeTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "COUNT") {
        byType.count.push(m);
        let meta: any = {};
        try { meta = typeof (m as any).metadata === 'string' ? JSON.parse((m as any).metadata) : ((m as any).metadata || {}); } catch (err) { console.warn("[TakeoffData] Failed to parse count metadata:", err); }
        const rawQty = Number(m.count ?? meta.quantity ?? 1);
        const qty = Number.isFinite(rawQty) ? rawQty : 1;
        const unit = (meta.unit || "EA").toUpperCase();
        if (unit === "CY") {
          volumeTotal += qty;
        } else if (unit === "SF") {
          areaTotal += qty;
        } else if (unit === "LF") {
          linearTotal += qty;
        } else {
          countTotal += qty;
        }
      } else if (m.type === "LINEAR_WITH_DROP") {
        byType.linearWithDrop.push(m);
        const val = Number(m.computedLengthFt);
        linearWithDropTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "PITCHED_LINEAR") {
        byType.pitchedLinear.push(m);
        const val = Number(m.computedLengthFt);
        pitchedLinearTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "PITCHED_AREA") {
        byType.pitchedArea.push(m);
        const val = Number((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2);
        pitchedAreaTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "SURFACE_AREA") {
        byType.surfaceArea.push(m);
        const val = Number((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2);
        surfaceAreaTotal += Number.isFinite(val) ? val : 0;
      } else if (m.type === "SEGMENT") {
        byType.segment.push(m);
        const val = Number(m.computedLengthFt);
        segmentTotal += Number.isFinite(val) ? val : 0;
      }

      if (m.categoryId) {
        if (!byCategory[m.categoryId]) byCategory[m.categoryId] = [];
        byCategory[m.categoryId].push(m);
      } else {
        uncategorized.push(m);
      }
    });

    return {
      byType,
      byCategory,
      uncategorized,
      grandTotals: { linearTotal, areaTotal, volumeTotal, countTotal, pitchedLinearTotal, pitchedAreaTotal, surfaceAreaTotal, linearWithDropTotal, segmentTotal }
    };
  }, [measurements]);

  const currentSheet = useMemo(
    () => sheets.find(s => s.id === selectedSheet),
    [sheets, selectedSheet]
  );

  const groupsQueryKey = ["/api/takeoff/sheets", selectedSheet, "groups"];

  const { data: measurementGroups = [] } = useQuery<TakeoffMeasurementGroup[]>({
    queryKey: groupsQueryKey,
    enabled: !!selectedSheet,
  });

  const createGroupMutation = useMutation({
    mutationFn: async (data: { name: string; color?: string; sortOrder?: number }) => {
      const res = await apiRequest("POST", `/api/takeoff/sheets/${selectedSheet}/groups`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      toast({ title: "Group created" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to create group", variant: "destructive" });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name?: string; color?: string; sortOrder?: number }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/groups/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update group", variant: "destructive" });
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      await apiRequest("DELETE", `/api/takeoff/groups/${groupId}`);
      return groupId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      toast({ title: "Group deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete group", variant: "destructive" });
    },
  });

  // Task #2617 — Cascading delete used by the AI map-reduce review-batch
  // workflow: removes the group AND every measurement carrying that
  // groupId in a single round-trip. The plain `deleteGroupMutation`
  // above keeps its non-cascading semantics for non-batch group flows
  // (where the FK's onDelete: set null is the desired behaviour).
  const deleteGroupWithMeasurementsMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const res = await apiRequest(
        "DELETE",
        `/api/takeoff/groups/${groupId}?deleteMeasurements=true`,
      );
      const body = (await res.json().catch(() => ({}))) as { deletedMeasurementCount?: number };
      return { groupId, deletedMeasurementCount: body.deletedMeasurementCount ?? 0 };
    },
    onSuccess: ({ deletedMeasurementCount }) => {
      queryClient.invalidateQueries({ queryKey: groupsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      if (isBid && context?.type === "bid") {
        queryClient.invalidateQueries({ queryKey: [`/api/bids/${context.bidId}/takeoff/all-measurements`] });
      }
      toast({
        title: "Batch deleted",
        description: `Removed the group and ${deletedMeasurementCount} measurement${deletedMeasurementCount === 1 ? "" : "s"}.`,
      });
    },
    onError: (err) => {
      toast({
        title: "Failed to delete batch",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const toggleGroupVisibilityMutation = useMutation({
    mutationFn: async ({ groupId, visible }: { groupId: string; visible: boolean }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/groups/${groupId}/visibility`, { visible });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to toggle visibility", variant: "destructive" });
    },
  });

  const isViewingLockedVersion = !!selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED");

  return {
    sheets,
    sheetsLoading,
    sheetsQueryKey,
    planDocuments,
    documentsLoading,
    projectAddenda,
    measurements,
    measurementsLoading,
    isViewingLockedVersion,
    markups,
    sheetLinks,
    categories,
    currentSheet,
    aggregatedMeasurements,
    importPlanMutation,
    supersedeSheetMutation,
    createMeasurementMutation,
    updateMeasurementMutation,
    unlockAndRescaleMeasurementMutation,
    bulkUnlockAndRescaleMeasurementsMutation,
    bulkUpdateMeasurementsMutation,
    deleteMeasurementMutation,
    bulkDeleteMeasurementsMutation,
    createMarkupMutation,
    updateMarkupMutation,
    bulkUpdateMarkupsMutation,
    deleteMarkupMutation,
    bulkDeleteMarkupsMutation,
    createSheetLinkMutation,
    deleteSheetLinkMutation,
    detectLinksMutation,
    saveCategoryMutation,
    deleteCategoryMutation,
    renameSheetMutation,
    duplicateSheetMutation,
    deleteSheetMutation,
    reorderSheetsMutation,
    handleMoveSheet,
    conditions,
    createConditionMutation,
    updateConditionMutation,
    deleteConditionMutation,
    measurementGroups,
    createGroupMutation,
    updateGroupMutation,
    deleteGroupMutation,
    deleteGroupWithMeasurementsMutation,
    toggleGroupVisibilityMutation,
    measurementCountsPerSheet,
    // Task #2344 — Per-sheet calibration-snapshot projection consumed
    // by the bottom-bar / sheet-selector confidence chips so each
    // sheet can render its own dot without spinning up a per-sheet
    // measurements query.
    measurementsBySheet,
    // Task #1768 — Set of markup ids whose most-recent move PATCH was
    // rejected. The workspace renders a temporary red glow on every id
    // in this set so the user can see exactly which siblings to fix.
    failedMarkupIds,
    clearFailedMarkupIds,
    // Task #2629 — Optimistic-concurrency conflict state for the
    // measurement update path. Consumed by `TakeoffWorkspace` to
    // render a "keep theirs / overwrite" resolution dialog.
    measurementConflict,
    dismissMeasurementConflict,
    // Task #2653 — Allow the history hook (undo/redo) to surface
    // a 409 version_conflict the same way the per-id PATCH does,
    // by handing the workspace a setter it can call from its
    // `onMeasurementConflict` adapter.
    setMeasurementConflict,
  };
}
