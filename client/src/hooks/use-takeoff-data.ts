import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTakeoffHistory, type MeasurementSnapshot } from "@/hooks/use-takeoff-history";
import type { TakeoffSheet, TakeoffMeasurement, TakeoffMeasurementGroup, QuantityCategory, TakeoffMarkup, TakeoffSheetLink, TakeoffCondition } from "@shared/schema";
import type { PlanDocument, AddendumOverlayData, MeasurementType } from "@/components/takeoff/types";
import { buildMarkupFailureSummary } from "@/components/markups/markup-failure-helpers";

export type TakeoffMarkupWithAuthor = Omit<TakeoffMarkup, "points"> & { authorName?: string | null; points: { x: number; y: number }[] };

type TakeoffContext =
  | { type: "project"; projectId: string; projectCode: string }
  | { type: "bid"; bidId: string; bidCode: string };

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

  const isBid = context?.type === "bid";
  const ctxId = isBid ? context.bidId : projectId;
  const ctxCode = isBid ? context.bidCode : projectCode;

  const sheetsQueryKey = isBid
    ? ["/api/bids", ctxId, "takeoff", "sheets"]
    : ["/api/projects", ctxId, "takeoff", "sheets"];

  const categoriesQueryKey = isBid
    ? ["/api/bids", ctxId, "takeoff", "categories"]
    : ["/api/projects", ctxCode, "quantity-categories"];

  const { data: sheets = [], isLoading: sheetsLoading } = useQuery<TakeoffSheet[]>({
    queryKey: sheetsQueryKey,
  });

  const { data: planDocuments = [], isLoading: documentsLoading } = useQuery<PlanDocument[]>({
    queryKey: isBid
      ? ["/api/bids", ctxCode, "documents"]
      : ["/api/projects", ctxCode, "documents"],
    enabled: uploadDialogOpen,
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
      toast({ title: "Revision recorded", description: "The old sheet has been superseded by the new revision." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to mark sheet as superseded", variant: "destructive" });
    },
  });

  const { data: projectAddenda = [] } = useQuery<AddendumOverlayData[]>({
    queryKey: ["/api/projects", ctxId, "addenda"],
    enabled: !isBid,
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

  const allMeasurementsUrl = isBid
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
    mutationFn: async ({ id, skipHistory: _skipHistory, previous: _previous, ...data }: { id: string; costCodeId?: string; unitCost?: number; label?: string; categoryId?: string | null; groupId?: string | null; lineStyle?: string; lineWidth?: number; metadata?: string; points?: string; computedLengthFt?: number; skipHistory?: boolean; previous?: { label?: string | null; costCodeId?: string | null; unitCost?: number | string | null; categoryId?: string | null; groupId?: string | null; lineStyle?: string | null; lineWidth?: number | null; metadata?: string | null; points?: string } }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot edit measurements while viewing a locked version");
      }
      const res = await apiRequest("PATCH", `/api/takeoff/measurements/${id}`, data);
      return res.json();
    },
    onSuccess: (_data: TakeoffMeasurement, variables) => {
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
        const before: MeasurementSnapshot = { id: variables.id };
        const after: MeasurementSnapshot = { id: variables.id };
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
    onError: () => {
      toast({ title: "Error", description: "Failed to update measurement", variant: "destructive" });
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
    onError: () => {
      toast({ title: "Error", description: "Failed to delete measurement", variant: "destructive" });
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
      if (data?.sheet?.id) callbacks.setSelectedSheet(data.sheet.id);
      toast({ title: "Sheet duplicated", description: `${data?.measurementsCopied || 0} measurements copied` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to duplicate sheet", variant: "destructive" });
    },
  });

  const deleteSheetMutation = useMutation({
    mutationFn: async (sheetId: string) => {
      return await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}?confirm=true`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sheetsQueryKey });
      callbacks.setSelectedSheet(sheets.length > 1 ? sheets.find(s => s.id !== selectedSheet)?.id || null : null);
      callbacks.setDeleteSheetConfirmOpen(false);
      toast({ title: "Sheet deleted" });
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
      // Push one history entry per deleted markup so existing Undo
      // semantics (per-row recreate) keep working unchanged.
      if (selectedSheet && ctx?.deletedSnapshots) {
        for (const m of ctx.deletedSnapshots) {
          takeoffHistory.pushMarkupAction("MARKUP_DELETE", m as any, selectedSheet);
        }
      }
      const count = ctx?.deletedSnapshots.length ?? 0;
      toast({ title: count === 1 ? "Markup deleted" : `${count} markups deleted` });
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
      const url = isBid
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
    deleteMeasurementMutation,
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
    toggleGroupVisibilityMutation,
    measurementCountsPerSheet,
    // Task #1768 — Set of markup ids whose most-recent move PATCH was
    // rejected. The workspace renders a temporary red glow on every id
    // in this set so the user can see exactly which siblings to fix.
    failedMarkupIds,
    clearFailedMarkupIds,
  };
}
