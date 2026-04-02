import { useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import type { TakeoffSheet, TakeoffMeasurement, TakeoffMeasurementGroup, QuantityCategory, TakeoffMarkup, TakeoffSheetLink, TakeoffCondition } from "@shared/schema";
import type { PlanDocument, AddendumOverlayData, MeasurementType } from "@/components/takeoff/types";

export type TakeoffMarkupWithAuthor = TakeoffMarkup & { authorName?: string | null; points: { x: number; y: number }[] };

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
  onCollabBroadcast,
  callbacks,
}: UseTakeoffDataParams) {
  const { toast } = useToast();

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
      toast({ title: "Success", description: "Plan sheet imported to takeoff workspace" });
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
    onSuccess: (data: TakeoffMeasurement) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      if (selectedSheet) {
        takeoffHistory.pushAction("CREATE", data, selectedSheet);
        onCollabBroadcast?.("MEASUREMENT_CREATED", { sheetId: selectedSheet, measurementId: data.id });
      }
      toast({ title: "Success", description: "Measurement saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save measurement", variant: "destructive" });
    },
  });

  const updateMeasurementMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; costCodeId?: string; unitCost?: number; label?: string; categoryId?: string | null; groupId?: string | null; lineStyle?: string; lineWidth?: number; metadata?: string; points?: string; computedLengthFt?: number }) => {
      if (selectedVersionId && (!selectedVersionData || selectedVersionData.status === "LOCKED")) {
        throw new Error("Cannot edit measurements while viewing a locked version");
      }
      const res = await apiRequest("PATCH", `/api/takeoff/measurements/${id}`, data);
      return res.json();
    },
    onSuccess: (_data: TakeoffMeasurement, variables: { id: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      if (selectedSheet) {
        onCollabBroadcast?.("MEASUREMENT_UPDATED", { sheetId: selectedSheet, measurementId: variables.id });
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
      return await apiRequest("DELETE", `/api/takeoff/sheets/${sheetId}`);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save markup", variant: "destructive" });
    },
  });

  const deleteMarkupMutation = useMutation({
    mutationFn: async (markupId: string) => {
      await apiRequest("DELETE", `/api/takeoff/markups/${markupId}`);
      return markupId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "markups"] });
      toast({ title: "Markup deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete markup", variant: "destructive" });
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
        try { meta = typeof (m as any).metadata === 'string' ? JSON.parse((m as any).metadata) : ((m as any).metadata || {}); } catch {}
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
    deleteMarkupMutation,
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
  };
}
