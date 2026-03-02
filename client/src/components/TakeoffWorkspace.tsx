import { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogPortal, DialogDescription, DialogOverlay, DialogClose } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  MousePointer2, Hand, ZoomIn, Ruler, Square, Circle as CircleIcon, 
  Box, MapPin, StickyNote, Upload, Trash2, Save, Download, Sparkles, Maximize, Minimize, Plus, Pencil, Keyboard, ChevronLeft, ChevronRight, FileText, Loader2, Magnet, CornerDownRight, MoreVertical, Copy, ArrowUp, ArrowDown, Layers, Eye, EyeOff, CheckCircle2, AlertTriangle, Target, Info, Undo2, Redo2, Triangle, Scaling, MoveVertical, Grid3x3 
} from "lucide-react";
import AiTakeoffPanel from "@/components/AiTakeoffPanel";
import AssemblyPanel from "@/components/AssemblyPanel";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useTakeoffHistory } from "@/hooks/use-takeoff-history";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory } from "@shared/schema";
import * as pdfjsLib from 'pdfjs-dist';
import {
  computePixelDistance,
  computeDistanceInFeet,
  computePolygonAreaInFt2,
  computeVolumeInCY,
  inchesToFeet,
  createArcSegment,
  sampleArcPoints,
  computePitchedLinearFt,
  computePitchedAreaFt2,
  computeLinearWithDropFt,
  type Point,
  type ArcSegment
} from "@shared/utils/geometry";
import {
  findSnapTargets,
  findNearestSnap,
  applyOrthoLock,
  type SnapResult,
} from "@/utils/snapping";

type Tool = 
  | "select" 
  | "pan" 
  | "zoom" 
  | "calibrate" 
  | "linear" 
  | "arc"
  | "area" 
  | "volume" 
  | "count" 
  | "note"
  | "linear_with_drop"
  | "pitched_area"
  | "pitched_linear"
  | "surface_area";

type MeasurementType = "LINEAR" | "AREA" | "VOLUME" | "COUNT" | "NOTE" | "LINEAR_WITH_DROP" | "PITCHED_AREA" | "PITCHED_LINEAR" | "SURFACE_AREA";

interface TakeoffWorkspaceProps {
  projectId: string;
  projectCode: string;
}

const TOOL_CONFIG = [
  { id: "select", icon: MousePointer2, label: "Select", color: "default", shortcut: "S" },
  { id: "pan", icon: Hand, label: "Pan", color: "default", shortcut: "H" },
  { id: "zoom", icon: ZoomIn, label: "Zoom", color: "default", shortcut: null },
  { id: "calibrate", icon: Ruler, label: "Calibrate", color: "secondary", shortcut: null },
  { id: "linear", icon: Ruler, label: "Linear", color: "primary", shortcut: "L" },
  { id: "arc", icon: CircleIcon, label: "Arc/Radius", color: "primary", shortcut: "R" },
  { id: "area", icon: Square, label: "Area", color: "primary", shortcut: "A" },
  { id: "volume", icon: Box, label: "Volume", color: "primary", shortcut: "V" },
  { id: "count", icon: MapPin, label: "Count", color: "primary", shortcut: "C" },
  { id: "note", icon: StickyNote, label: "Note", color: "default", shortcut: "N" },
  { id: "linear_with_drop", icon: MoveVertical, label: "Linear + Drop", color: "primary", shortcut: "D" },
  { id: "pitched_linear", icon: Triangle, label: "Pitched Linear", color: "primary", shortcut: "P" },
  { id: "pitched_area", icon: Scaling, label: "Pitched Area", color: "primary", shortcut: "T" },
  { id: "surface_area", icon: Grid3x3, label: "Surface Area", color: "primary", shortcut: "G" },
] as const;

// Common architectural, civil, and structural scales
// Assuming 96 DPI (pixels per inch), we calculate pixels per foot for each scale
const COMMON_SCALES = {
  architectural: [
    { label: '1/16" = 1\'-0"', pxPerFoot: 6, description: "Very small scale" },
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Small scale" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Common floor plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Medium detail" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed plans" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large detail" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Enlarged details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Large details" },
  ],
  civil: [
    { label: '1" = 10\'', pxPerFoot: 9.6, description: "Small site plans" },
    { label: '1" = 20\'', pxPerFoot: 4.8, description: "Medium site plans" },
    { label: '1" = 30\'', pxPerFoot: 3.2, description: "Large site plans" },
    { label: '1" = 40\'', pxPerFoot: 2.4, description: "Very large sites" },
    { label: '1" = 50\'', pxPerFoot: 1.92, description: "Regional plans" },
    { label: '1" = 60\'', pxPerFoot: 1.6, description: "Large regional" },
    { label: '1" = 100\'', pxPerFoot: 0.96, description: "Master plans" },
  ],
  structural: [
    { label: '1/8" = 1\'-0"', pxPerFoot: 12, description: "Overall framing" },
    { label: '1/4" = 1\'-0"', pxPerFoot: 24, description: "Framing plans" },
    { label: '3/8" = 1\'-0"', pxPerFoot: 36, description: "Connection details" },
    { label: '1/2" = 1\'-0"', pxPerFoot: 48, description: "Detailed connections" },
    { label: '3/4" = 1\'-0"', pxPerFoot: 72, description: "Large details" },
    { label: '1" = 1\'-0"', pxPerFoot: 96, description: "Full size details" },
    { label: '1-1/2" = 1\'-0"', pxPerFoot: 144, description: "Connection details" },
    { label: '3" = 1\'-0"', pxPerFoot: 288, description: "Bolt details" },
  ],
};

export default function TakeoffWorkspace({ projectId, projectCode }: TakeoffWorkspaceProps) {
  const [activeTool, setActiveTool] = useState<Tool>("select");
  const [currentDrawingTool, setCurrentDrawingTool] = useState<Tool | null>(null); // PHASE 2.3a: Track tool that initiated drawing
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
  const takeoffHistory = useTakeoffHistory(selectedSheet);
  const prevSheetRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSheetRef.current !== null && prevSheetRef.current !== selectedSheet) {
      takeoffHistory.clear();
    }
    prevSheetRef.current = selectedSheet;
  }, [selectedSheet, takeoffHistory]);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [calibrationMode, setCalibrationMode] = useState<"idle" | "first-point" | "second-point">("idle");
  const [calibrationPoints, setCalibrationPoints] = useState<{ x: number; y: number }[]>([]);
  const [calibrationDistance, setCalibrationDistance] = useState("");
  const [units, setUnits] = useState<"ft" | "m">("ft");
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  
  // Preset scale state
  const [scaleCategory, setScaleCategory] = useState<string>("");
  const [selectedPresetScale, setSelectedPresetScale] = useState<string>("");
  
  // Drawing state for measurement tools
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tempMeasurements, setTempMeasurements] = useState<any[]>([]);
  
  // Note tool state
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [notePosition, setNotePosition] = useState<{ x: number; y: number } | null>(null);
  const [noteText, setNoteText] = useState("");
  
  const [pitchRatio, setPitchRatio] = useState("6:12");
  const [dropDistance, setDropDistance] = useState("");

  // PHASE 2.4: Keyboard shortcuts help dialog
  const [shortcutsDialogOpen, setShortcutsDialogOpen] = useState(false);
  
  // PHASE 2.5: Live measurement preview
  const [livePreviewValue, setLivePreviewValue] = useState<string | null>(null);
  const [livePreviewPosition, setLivePreviewPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Select tool state
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  
  // PHASE 2.1: Click vs Drag threshold - track mousedown position to prevent accidental clicks during panning
  const [mouseDownPosition, setMouseDownPosition] = useState<{ x: number; y: number } | null>(null);
  const CLICK_DRAG_THRESHOLD = 5; // pixels - movement less than this is considered a click, not a drag
  const [isDraggingStage, setIsDraggingStage] = useState(false); // Track Stage drag to suppress clicks during pan
  
  // PHASE 2.2b: Spacebar temporary pan - hold spacebar to temporarily pan from any tool
  const [toolBeforeSpacebar, setToolBeforeSpacebar] = useState<Tool | null>(null);
  const [isSpacebarHeld, setIsSpacebarHeld] = useState(false);
  
  // PDF rendering state
  const [pdfImage, setPdfImage] = useState<HTMLImageElement | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  
  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Stage dimensions state
  const [stageDimensions, setStageDimensions] = useState({ width: 800, height: 600 });
  
  // Category management state
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<QuantityCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryColor, setCategoryColor] = useState("#3b82f6");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  
  // Sheet management state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [deleteSheetConfirmOpen, setDeleteSheetConfirmOpen] = useState(false);
  
  // AI Takeoff panel state
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  
  // Addenda overlay state
  const [addendaOverlays, setAddendaOverlays] = useState<Record<string, { visible: boolean; opacity: number; imageUrl?: string }>>({});
  const [addendaImages, setAddendaImages] = useState<Record<string, HTMLImageElement>>({});
  
  // Advanced calibration state
  const [verifyMode, setVerifyMode] = useState<"idle" | "first-point" | "second-point">("idle");
  const [verifyPoints, setVerifyPoints] = useState<{ x: number; y: number }[]>([]);
  const [verifyExpectedDistance, setVerifyExpectedDistance] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ expected: number; measured: number; errorPct: number } | null>(null);
  const [multiCalibPoints, setMultiCalibPoints] = useState<Array<{ points: [{ x: number; y: number }, { x: number; y: number }]; distance: number }>>([]);
  const [multiCalibMode, setMultiCalibMode] = useState(false);
  
  // Snapping state
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoLock, setOrthoLock] = useState(false);
  const [currentSnap, setCurrentSnap] = useState<SnapResult | null>(null);
  const [cursorPosition, setCursorPosition] = useState<Point | null>(null);
  const shiftHeldRef = useRef(false);
  
  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Fetch sheets for this project
  const { data: sheets = [], isLoading: sheetsLoading } = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/projects", projectId, "takeoff", "sheets"],
  });

  // Fetch plan documents for this project (for import dialog)
  interface PlanDocument {
    id: string;
    fileName: string;
    title: string | null;
    fileUrl: string | null;
    uploadedAt: string;
  }
  const { data: planDocuments = [], isLoading: documentsLoading } = useQuery<PlanDocument[]>({
    queryKey: ["/api/projects", projectCode, "documents"],
    enabled: uploadDialogOpen,
  });

  // Mutation to import a plan document to takeoff
  const importPlanMutation = useMutation({
    mutationFn: async (documentId: string) => {
      return await apiRequest("POST", `/api/projects/${projectId}/takeoff/import-plan`, { documentId });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
      setUploadDialogOpen(false);
      // Auto-select the first imported sheet
      if (data?.sheets?.[0]?.id) {
        setSelectedSheet(data.sheets[0].id);
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

  // Fetch addenda for overlay panel
  interface AddendumOverlayData {
    id: string;
    addendumNumber: number;
    title: string;
    status: string;
    storageKey: string | null;
    fileUrl: string | null;
    fileName: string | null;
  }
  const { data: projectAddenda = [] } = useQuery<AddendumOverlayData[]>({
    queryKey: ["/api/projects", projectId, "addenda"],
  });

  // Load addenda overlay images when toggled visible
  useEffect(() => {
    Object.entries(addendaOverlays).forEach(([addendumId, overlay]) => {
      if (overlay.visible && !addendaImages[addendumId] && !overlay.imageUrl) {
        fetch(`/api/addenda/${addendumId}/preview-url`, { credentials: "include" })
          .then(r => r.ok ? r.json() : null)
          .then(data => {
            if (data?.url) {
              setAddendaOverlays(prev => ({ ...prev, [addendumId]: { ...prev[addendumId], imageUrl: data.url } }));
              const img = new window.Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                setAddendaImages(prev => ({ ...prev, [addendumId]: img }));
              };
              img.src = data.url;
            }
          })
          .catch(() => {});
      }
    });
  }, [addendaOverlays, addendaImages]);

  // Fetch measurements for selected sheet
  const { data: measurements = [], isLoading: measurementsLoading } = useQuery<TakeoffMeasurement[]>({
    queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"],
    enabled: !!selectedSheet,
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
      computedSurfaceAreaFt2?: number;
      computedLengthFt?: number;
    }) => {
      const res = await apiRequest("POST", "/api/takeoff/measurements", data);
      return res.json();
    },
    onSuccess: (data: TakeoffMeasurement) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      if (selectedSheet) {
        takeoffHistory.pushAction("CREATE", data, selectedSheet);
      }
      toast({ title: "Success", description: "Measurement saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save measurement", variant: "destructive" });
    },
  });

  const updateMeasurementMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; costCodeId?: string; unitCost?: number; label?: string; categoryId?: string | null }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/measurements/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update measurement", variant: "destructive" });
    },
  });

  // Mutation for deleting measurements
  const deleteMeasurementMutation = useMutation({
    mutationFn: async (measurement: TakeoffMeasurement) => {
      await apiRequest("DELETE", `/api/takeoff/measurements/${measurement.id}`);
      return measurement;
    },
    onSuccess: (deleted: TakeoffMeasurement) => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      setSelectedMeasurementId(null);
      if (selectedSheet) {
        takeoffHistory.pushAction("DELETE", deleted, selectedSheet);
      }
      toast({ title: "Success", description: "Measurement deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete measurement", variant: "destructive" });
    },
  });

  // Fetch categories for this project
  const { data: categories = [] } = useQuery<QuantityCategory[]>({
    queryKey: ["/api/projects", projectCode, "quantity-categories"],
  });

  // Mutation for creating/updating categories
  const saveCategoryMutation = useMutation({
    mutationFn: async (data: { id?: string; name: string; color: string; displayOrder?: number }) => {
      let response;
      if (data.id) {
        response = await apiRequest("PATCH", `/api/quantity-categories/${data.id}`, { 
          name: data.name, 
          color: data.color 
        });
      } else {
        response = await apiRequest("POST", `/api/projects/${projectCode}/quantity-categories`, { 
          name: data.name, 
          color: data.color, 
          displayOrder: categories.length 
        });
      }
      return await response.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "quantity-categories"] });
      setCategoryDialogOpen(false);
      setEditingCategory(null);
      setCategoryName("");
      setCategoryColor("#3b82f6");
      
      // Auto-select newly created category for immediate use
      if (!variables.id && data?.id) {
        setSelectedCategoryId(data.id);
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

  // Mutation for deleting categories
  const deleteCategoryMutation = useMutation({
    mutationFn: async (categoryId: string) => {
      return await apiRequest("DELETE", `/api/quantity-categories/${categoryId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "quantity-categories"] });
      toast({ title: "Success", description: "Category deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete category", variant: "destructive" });
    },
  });

  const renameSheetMutation = useMutation({
    mutationFn: async ({ sheetId, sheetName }: { sheetId: string; sheetName: string }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/sheets/${sheetId}/rename`, { sheetName });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff/sheets`] });
      setRenameDialogOpen(false);
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
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff/sheets`] });
      if (data?.sheet?.id) setSelectedSheet(data.sheet.id);
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
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff/sheets`] });
      setSelectedSheet(sheets.length > 1 ? sheets.find(s => s.id !== selectedSheet)?.id || null : null);
      setDeleteSheetConfirmOpen(false);
      toast({ title: "Sheet deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete sheet", variant: "destructive" });
    },
  });

  const reorderSheetsMutation = useMutation({
    mutationFn: async (order: { id: string; sheetIndex: number }[]) => {
      const res = await apiRequest("PATCH", `/api/projects/${projectId}/takeoff/sheets/reorder`, { order });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/takeoff/sheets`] });
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

  // PERFORMANCE OPTIMIZATION: Single comprehensive aggregation - O(N) once per measurements change
  const aggregatedMeasurements = useMemo(() => {
    const byType = { 
      linear: [] as TakeoffMeasurement[], area: [] as TakeoffMeasurement[], volume: [] as TakeoffMeasurement[], count: [] as TakeoffMeasurement[],
      linearWithDrop: [] as TakeoffMeasurement[], pitchedLinear: [] as TakeoffMeasurement[], pitchedArea: [] as TakeoffMeasurement[], surfaceArea: [] as TakeoffMeasurement[],
    };
    const byCategory: Record<string, TakeoffMeasurement[]> = {};
    const uncategorized: TakeoffMeasurement[] = [];
    let linearTotal = 0, areaTotal = 0, volumeTotal = 0, countTotal = 0;
    let pitchedLinearTotal = 0, pitchedAreaTotal = 0, surfaceAreaTotal = 0, linearWithDropTotal = 0;

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
        countTotal += 1;
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
      grandTotals: { linearTotal, areaTotal, volumeTotal, countTotal, pitchedLinearTotal, pitchedAreaTotal, surfaceAreaTotal, linearWithDropTotal }
    };
  }, [measurements]);

  // PERFORMANCE OPTIMIZATION: Memoize current sheet lookup
  const currentSheet = useMemo(
    () => sheets.find(s => s.id === selectedSheet),
    [sheets, selectedSheet]
  );

  // Helper to validate and sanitize hex colors (supports 3, 4, 6, and 8 digit hex)
  const validateHexColor = (color: string | undefined): string | null => {
    if (!color) return null;
    const trimmed = color.trim();
    // Match #RGB, #RGBA, #RRGGBB, #RRGGBBAA
    const hexPattern = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
    if (!hexPattern.test(trimmed)) return null;
    
    // Convert 3-digit (#RGB) to 6-digit (#RRGGBB)
    if (trimmed.length === 4) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    // Convert 4-digit (#RGBA) to 6-digit (#RRGGBB) - discard alpha
    if (trimmed.length === 5) {
      const r = trimmed[1];
      const g = trimmed[2];
      const b = trimmed[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    // Strip alpha from 8-digit (#RRGGBBAA) to get 6-digit (#RRGGBB)
    if (trimmed.length === 9) {
      return trimmed.substring(0, 7);
    }
    // Already 6-digit or 7-digit with #, return as-is
    return trimmed;
  };

  // Helper to convert hex to rgba (assumes valid 6-digit hex)
  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Configure PDF.js worker
  useEffect(() => {
    // Use new URL() with import.meta.url - Vite will handle the rest (best practice for Vite)
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
  }, []);

  // Load and render PDF when sheet changes
  useEffect(() => {
    if (!currentSheet?.imageUrl) {
      setPdfImage(null);
      return;
    }

    const loadPDF = async () => {
      try {
        setIsPdfLoading(true);
        setPdfImage(null);

        // Use the streaming PDF endpoint (authorization handled server-side)
        const pdfUrl = `/api/takeoff/sheets/${currentSheet.id}/pdf`;

        // Load the PDF document - PDF.js will fetch with credentials automatically
        const loadingTask = pdfjsLib.getDocument({
          url: pdfUrl,
          withCredentials: true, // Send cookies for authentication
        });
        const pdf = await loadingTask.promise;

        // Get the page based on sheetIndex (PDF pages are 1-indexed)
        const pageNumber = (currentSheet.sheetIndex || 0) + 1;
        const page = await pdf.getPage(pageNumber);

        // Set up the canvas with desired scale
        const scale = 1.5;
        const viewport = page.getViewport({ scale });

        // Create a canvas to render the PDF
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        // Render the page
        await page.render({
          canvasContext: context,
          viewport: viewport,
          canvas: canvas
        }).promise;

        // Convert canvas to image for Konva
        const img = new window.Image();
        img.src = canvas.toDataURL();
        img.onload = () => {
          setPdfImage(img);
          setIsPdfLoading(false);
        };
      } catch (error) {
        console.error('Error loading PDF:', error);
        setIsPdfLoading(false);
        toast({
          title: "Error",
          description: "Failed to load PDF. The file may not be a valid PDF document.",
          variant: "destructive"
        });
      }
    };

    loadPDF();
  }, [currentSheet?.id, currentSheet?.imageUrl, toast]);

  const handleToolSelect = (tool: Tool) => {
    setActiveTool(tool);
    
    // PHASE 2.2b: If user explicitly selects a tool while spacebar is held,
    // clear the spacebar state so releasing spacebar doesn't restore the old tool
    if (isSpacebarHeld) {
      setToolBeforeSpacebar(null);
      setIsSpacebarHeld(false);
    }
    
    if (tool === "calibrate") {
      setCalibrationMode("first-point");
      setCalibrationPoints([]);
      toast({ 
        title: "Calibration Mode", 
        description: "Click two points on a known distance to calibrate scale" 
      });
    }
  };

  // PHASE 2.1: Mouse down handler - record position to detect click vs drag
  const handleStageMouseDown = (e: any) => {
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    
    // Guard against null - cursor may be outside canvas
    if (!pointerPosition) {
      return;
    }
    
    // Store screen position (not transformed) to measure actual pixel movement
    setMouseDownPosition(pointerPosition);
  };

  // PHASE 2.1: Mouse up handler - only register as click if movement < threshold
  const handleStageMouseUp = (e: any) => {
    // Guard against missing mousedown or cursor outside canvas
    if (!mouseDownPosition) {
      return; // No mousedown recorded, ignore
    }

    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    
    // Clear mousedown position first (before any early returns)
    setMouseDownPosition(null);
    
    // Guard against null - cursor may have left canvas before release
    if (!pointerPosition) {
      return; // Cursor outside canvas, treat as cancelled interaction
    }
    
    // PHASE 2.1 FIX: Suppress clicks if Stage drag occurred (pan operation)
    if (isDraggingStage) {
      // User was panning - don't trigger click handlers
      return;
    }
    
    // Calculate pixel distance moved since mousedown
    const deltaX = pointerPosition.x - mouseDownPosition.x;
    const deltaY = pointerPosition.y - mouseDownPosition.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    
    // Only register as a click if movement is below threshold
    if (distance < CLICK_DRAG_THRESHOLD) {
      handleStageClick(e);
    }
    // Otherwise it was a drag (pan) - ignore
  };

  // PHASE 2.1 FIX: Track Stage drag lifecycle to suppress clicks during pan
  const handleStageDragStart = () => {
    setIsDraggingStage(true);
  };

  // PHASE 2.2 FIX: Update Stage position during drag to prevent snap-back
  // Only update position when pan is actually active (pan tool or spacebar)
  const handleStageDragMove = (e: any) => {
    // Guard: Only sync position when Stage is draggable (pan mode)
    if (activeTool !== "pan") {
      return;
    }
    const stage = e.target;
    setStagePosition({ x: stage.x(), y: stage.y() });
  };

  const handleStageDragEnd = () => {
    setIsDraggingStage(false);
    // Position already updated via dragmove, just clear drag flag
  };

  const snapTargets = useMemo(
    () => (snapEnabled ? findSnapTargets(measurements) : []),
    [measurements, snapEnabled]
  );

  const resolvePoint = useCallback(
    (rawPoint: Point): Point => {
      let pt = rawPoint;
      if (orthoLock && drawingPoints.length > 0) {
        pt = applyOrthoLock(pt, drawingPoints[drawingPoints.length - 1]);
      }
      if (snapEnabled && snapTargets.length > 0) {
        const snap = findNearestSnap(pt, snapTargets, 12, stageScale);
        if (snap.isSnapped) return snap.snappedPoint;
      }
      return pt;
    },
    [orthoLock, snapEnabled, snapTargets, drawingPoints, stageScale]
  );

  const handleStageMouseMove = useCallback(
    (e: any) => {
      const stage = e.target.getStage();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const transform = stage.getAbsoluteTransform().copy().invert();
      let pt: Point = transform.point(pointer);

      if (orthoLock && drawingPoints.length > 0) {
        pt = applyOrthoLock(pt, drawingPoints[drawingPoints.length - 1]);
      }

      setCursorPosition(pt);

      if (snapEnabled && snapTargets.length > 0) {
        const snap = findNearestSnap(pt, snapTargets, 12, stageScale);
        setCurrentSnap(snap.isSnapped ? snap : null);
      } else {
        setCurrentSnap(null);
      }
    },
    [snapEnabled, snapTargets, stageScale, orthoLock, drawingPoints]
  );

  const handleStageClick = (e: any) => {
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    
    // Transform pointer position to sheet space (accounting for pan/zoom)
    const transform = stage.getAbsoluteTransform().copy().invert();
    let point = transform.point(pointerPosition);

    const isDrawingTool = ["linear", "arc", "area", "volume", "count"].includes(activeTool);
    if (isDrawingTool) {
      point = resolvePoint(point);
    }
    
    // Clear selection when clicking empty space with select tool
    // Only clear if clicking the stage itself, not a shape
    if (activeTool === "select") {
      if (e.target === stage) {
        setSelectedMeasurementId(null);
      }
      return;
    }
    
    // Scale verification click handling
    if (verifyMode === "first-point") {
      setVerifyPoints([point]);
      setVerifyMode("second-point");
      toast({ title: "First Point Set", description: "Click second point to complete verification" });
      return;
    } else if (verifyMode === "second-point") {
      const newPoints = [verifyPoints[0], point];
      setVerifyPoints(newPoints);
      setVerifyMode("idle");
      const expectedDist = parseFloat(verifyExpectedDistance);
      if (expectedDist > 0 && currentSheet?.scalePxPerFoot) {
        const pxDist = computePixelDistance(newPoints[0], newPoints[1]);
        const measuredDist = pxDist / currentSheet.scalePxPerFoot;
        const errorPct = Math.abs(measuredDist - expectedDist) / expectedDist * 100;
        setVerifyResult({ expected: expectedDist, measured: measuredDist, errorPct });
      } else {
        toast({ title: "Error", description: "Enter an expected distance before verifying", variant: "destructive" });
      }
      return;
    }

    if (activeTool === "calibrate") {
      if (calibrationMode === "first-point") {
        setCalibrationPoints([point]);
        setCalibrationMode("second-point");
        toast({ 
          title: "First Point Set", 
          description: "Click second point to complete calibration" 
        });
      } else if (calibrationMode === "second-point") {
        const newPoints = [...calibrationPoints, point];
        setCalibrationPoints(newPoints);
        // Keep mode as "second-point" so panel stays visible for distance entry
        // Mode will be reset to "idle" after successful save
        
        const pixelDistance = computePixelDistance(newPoints[0], newPoints[1]);
        
        toast({ 
          title: "Calibration Complete", 
          description: `Enter the real-world distance (${pixelDistance.toFixed(2)} pixels measured)` 
        });
      }
    } else if (activeTool === "linear") {
      if (!selectedSheet) {
        toast({ title: "Error", description: "Select a sheet first", variant: "destructive" });
        return;
      }
      
      if (!currentSheet?.scalePxPerFoot) {
        toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" });
        return;
      }
      
      if (!isDrawing) {
        // Start drawing - first point
        setIsDrawing(true);
        setDrawingPoints([point]);
      } else {
        // End drawing - second point, save measurement
        const newPoints = [...drawingPoints, point];
        const lengthFt = computeDistanceInFeet(newPoints, currentSheet.scalePxPerFoot);
        
        createMeasurementMutation.mutate({
          sheetId: selectedSheet,
          type: "LINEAR",
          points: newPoints,
          label: `Line ${measurements.length + 1}`,
          categoryId: selectedCategoryId,
        });
        
        setIsDrawing(false);
        setDrawingPoints([]);
        toast({ 
          title: "Measurement Created", 
          description: `${lengthFt.toFixed(2)} LF` 
        });
      }
    } else if (activeTool === "linear_with_drop" || activeTool === "pitched_linear") {
      if (!selectedSheet) {
        toast({ title: "Error", description: "Select a sheet first", variant: "destructive" });
        return;
      }
      if (!currentSheet?.scalePxPerFoot) {
        toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" });
        return;
      }
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingPoints([point]);
      } else {
        const newPoints = [...drawingPoints, point];
        const baseLengthFt = computeDistanceInFeet(newPoints, currentSheet.scalePxPerFoot);
        let finalLength = baseLengthFt;
        let measureType: MeasurementType = activeTool === "linear_with_drop" ? "LINEAR_WITH_DROP" : "PITCHED_LINEAR";

        if (activeTool === "linear_with_drop") {
          const drop = parseFloat(dropDistance) || 0;
          finalLength = computeLinearWithDropFt(baseLengthFt, drop);
        } else {
          finalLength = computePitchedLinearFt(baseLengthFt, pitchRatio);
        }

        createMeasurementMutation.mutate({
          sheetId: selectedSheet,
          type: measureType,
          points: newPoints,
          label: `${activeTool === "linear_with_drop" ? "Drop" : "Pitched"} Line ${measurements.length + 1}`,
          categoryId: selectedCategoryId,
          pitchRatio: activeTool === "pitched_linear" ? pitchRatio : undefined,
          computedLengthFt: finalLength,
        });

        setIsDrawing(false);
        setDrawingPoints([]);
        toast({
          title: "Measurement Created",
          description: `${finalLength.toFixed(2)} LF (${activeTool === "linear_with_drop" ? `drop: ${dropDistance || 0} ft` : `pitch: ${pitchRatio}`})`,
        });
      }
    } else if (activeTool === "arc") {
      // PHASE 2.3a: Arc tool - 3-point arc (start, middle, end)
      console.log(`[Arc Tool] Click detected. isDrawing=${isDrawing}, drawingPoints.length=${drawingPoints.length}`);
      
      if (!selectedSheet) {
        toast({ title: "Error", description: "Select a sheet first", variant: "destructive" });
        return;
      }
      
      if (!currentSheet?.scalePxPerFoot) {
        toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" });
        return;
      }
      
      if (!isDrawing) {
        // Start arc - first point (start)
        console.log("[Arc Tool] Point 1 (start)");
        setIsDrawing(true);
        setCurrentDrawingTool("arc"); // PHASE 2.3a: Lock tool for multi-point workflow
        setDrawingPoints([point]);
        toast({ 
          title: "Arc Tool", 
          description: "Click second point (middle) to define curvature" 
        });
      } else if (drawingPoints.length === 1) {
        // Second point (middle/control point)
        console.log("[Arc Tool] Point 2 (middle)");
        setDrawingPoints([...drawingPoints, point]);
        toast({ 
          title: "Arc Tool", 
          description: "Click third point (end) to complete arc" 
        });
      } else if (drawingPoints.length === 2) {
        // Third point (end) - create arc
        console.log("[Arc Tool] Point 3 (end) - creating arc");
        const [startPoint, middlePoint] = drawingPoints;
        const endPoint = point;
        
        // Create arc segment
        const arcSegment = createArcSegment(
          startPoint,
          endPoint,
          middlePoint,
          currentSheet.scalePxPerFoot
        );
        
        if (!arcSegment) {
          toast({ 
            title: "Error", 
            description: "Points are collinear - cannot form arc. Try different points.", 
            variant: "destructive" 
          });
          setIsDrawing(false);
          setCurrentDrawingTool(null); // PHASE 2.3a: Clear drawing tool lock
          setDrawingPoints([]);
          return;
        }
        
        // Save as ARC measurement with all 3 points
        // Count existing arcs (LINEAR measurements with 3 points)
        const existingArcs = measurements.filter(m => {
          if (m.type !== "LINEAR") return false;
          const pts = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
          return pts.length === 3;
        });
        
        const arcData = {
          sheetId: selectedSheet,
          type: "LINEAR" as const, // Store as LINEAR for now since schema doesn't have ARC type yet
          points: [startPoint, middlePoint, endPoint], // 3 points for arc
          label: `Arc ${existingArcs.length + 1}`,
          categoryId: selectedCategoryId,
        };
        console.log("[Arc Tool] Creating measurement with data:", arcData);
        
        createMeasurementMutation.mutate(arcData);
        
        setIsDrawing(false);
        setCurrentDrawingTool(null); // PHASE 2.3a: Clear drawing tool lock
        setDrawingPoints([]);
        toast({ 
          title: "Arc Created", 
          description: `${arcSegment.arcLength.toFixed(2)} LF` 
        });
      }
    } else if (activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") {
      if (!selectedSheet) {
        toast({ title: "Error", description: "Select a sheet first", variant: "destructive" });
        return;
      }
      
      if (!currentSheet?.scalePxPerFoot) {
        toast({ title: "Error", description: "Calibrate the sheet first", variant: "destructive" });
        return;
      }
      
      if (!isDrawing) {
        // Start polygon - first point
        setIsDrawing(true);
        setDrawingPoints([point]);
        toast({ 
          title: "Drawing Polygon", 
          description: "Click to add points. Click first point to close polygon." 
        });
      } else {
        // Check if clicking near first point to close polygon (when 3+ points exist)
        if (drawingPoints.length >= 3) {
          const firstPoint = drawingPoints[0];
          const distance = computePixelDistance(point, firstPoint);
          
          // If clicking within 10 pixels of first point, close the polygon
          if (distance < 10) {
            completePolygon();
            return;
          }
        }
        
        // Add point to polygon
        setDrawingPoints([...drawingPoints, point]);
      }
    } else if (activeTool === "count") {
      if (!selectedSheet) {
        toast({ title: "Error", description: "Select a sheet first", variant: "destructive" });
        return;
      }
      
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "COUNT",
        points: [point],
        label: `Count ${aggregatedMeasurements.byType.count.length + 1}`,
        categoryId: selectedCategoryId,
      });
    } else if (activeTool === "note") {
      if (!selectedSheet) {
        toast({ title: "Error", description: "Select a sheet first", variant: "destructive" });
        return;
      }
      
      // Open dialog to enter note text
      setNotePosition(point);
      setNoteDialogOpen(true);
    }
  };

  const handleSaveCalibration = async () => {
    if (!selectedSheet || calibrationPoints.length !== 2 || !calibrationDistance) {
      toast({ title: "Error", description: "Complete calibration first", variant: "destructive" });
      return;
    }

    const distanceValue = parseFloat(calibrationDistance.trim());
    
    // Validate distance is a valid number
    if (!Number.isFinite(distanceValue) || distanceValue <= 0) {
      toast({ 
        title: "Error", 
        description: "Please enter a valid distance value",
        variant: "destructive" 
      });
      return;
    }
    
    // Validate minimum distance to prevent unrealistic scales
    const minDistance = units === "ft" ? 0.5 : 0.15; // 0.5ft or 0.15m minimum
    if (distanceValue < minDistance) {
      toast({ 
        title: "Error", 
        description: `Distance must be at least ${minDistance} ${units}. For small details, use a larger reference distance.`,
        variant: "destructive" 
      });
      return;
    }

    const pixelDistance = computePixelDistance(calibrationPoints[0], calibrationPoints[1]);

    const scalePxPerFoot = units === "ft" 
      ? pixelDistance / distanceValue
      : pixelDistance / (distanceValue * 3.28084);

    // Validate scalePxPerFoot is a valid positive number
    if (!Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
      console.error("Invalid calibration value:", { pixelDistance, calibrationDistance, scalePxPerFoot });
      toast({ 
        title: "Error", 
        description: "Invalid calibration value. Please check your measurements.", 
        variant: "destructive" 
      });
      return;
    }

    console.log("Applying manual calibration:", { 
      sheetId: selectedSheet, 
      pixelDistance, 
      calibrationDistance, 
      scalePxPerFoot,
      units 
    });

    try {
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot, units });
      
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
      toast({ title: "Success", description: "Calibration saved" });
      setCalibrationMode("idle");
      setCalibrationPoints([]);
      setCalibrationDistance("");
      setActiveTool("select");
    } catch (error: any) {
      console.error("Failed to save manual calibration:", error);
      const errorMessage = error?.message || "Failed to save calibration";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  };

  const handleApplyPresetScale = async () => {
    if (!selectedSheet || !selectedPresetScale || !scaleCategory) {
      toast({ title: "Error", description: "Please select a scale", variant: "destructive" });
      return;
    }

    // Find the selected scale from the common scales
    const category = COMMON_SCALES[scaleCategory as keyof typeof COMMON_SCALES];
    const scale = category.find(s => s.label === selectedPresetScale);
    
    if (!scale) {
      toast({ title: "Error", description: "Invalid scale selected", variant: "destructive" });
      return;
    }

    // Validate scalePxPerFoot is a valid positive number
    if (!Number.isFinite(scale.pxPerFoot) || scale.pxPerFoot <= 0) {
      console.error("Invalid scale value:", scale.pxPerFoot);
      toast({ title: "Error", description: "Invalid scale value", variant: "destructive" });
      return;
    }

    console.log("Applying preset scale:", { 
      sheetId: selectedSheet, 
      scale: scale.label, 
      pxPerFoot: scale.pxPerFoot 
    });

    try {
      await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, { scalePxPerFoot: scale.pxPerFoot, units: "ft" });
      
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
      toast({ 
        title: "Success", 
        description: `Applied scale: ${scale.label}` 
      });
      setScaleCategory("");
      setSelectedPresetScale("");
    } catch (error: any) {
      console.error("Failed to apply preset scale:", error);
      const errorMessage = error?.message || "Failed to apply scale";
      toast({ title: "Error", description: errorMessage, variant: "destructive" });
    }
  };

  const handleDeleteCategory = async (categoryId: string) => {
    if (!confirm("Delete this category? Measurements will not be deleted, but will lose their category assignment.")) {
      return;
    }
    deleteCategoryMutation.mutate(categoryId);
  };

  const handleSaveCategory = () => {
    if (!categoryName.trim()) {
      toast({ title: "Error", description: "Category name is required", variant: "destructive" });
      return;
    }

    saveCategoryMutation.mutate({
      id: editingCategory?.id,
      name: categoryName,
      color: categoryColor,
    });
  };

  // Populate edit form when editing a category
  useEffect(() => {
    if (editingCategory) {
      setCategoryName(editingCategory.name);
      setCategoryColor(editingCategory.color);
    } else {
      setCategoryName("");
      setCategoryColor("#3b82f6");
    }
  }, [editingCategory]);

  // PHASE 2.2c: Mouse wheel zoom centered on cursor with limits and null guards
  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    
    const scaleBy = 1.1;
    const MIN_SCALE = 0.1; // 10% minimum zoom
    const MAX_SCALE = 10;  // 1000% maximum zoom
    
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    
    // Guard against null - cursor may be outside canvas
    if (!pointer) {
      return;
    }
    
    // Calculate point under cursor in stage coordinates
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    
    // Calculate new scale with limits
    let newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
    
    // Update scale and position so cursor point stays in same screen position
    setStageScale(newScale);
    setStagePosition({
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  };

  const completePolygon = () => {
    if (!selectedSheet || !currentSheet?.scalePxPerFoot || drawingPoints.length < 3) {
      toast({ title: "Error", description: "Need at least 3 points for polygon", variant: "destructive" });
      return;
    }

    // Calculate area using robust geometry utilities
    const areaFt2 = computePolygonAreaInFt2(drawingPoints, currentSheet.scalePxPerFoot);
    
    if (activeTool === "area") {
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "AREA",
        points: drawingPoints,
        label: `Area ${aggregatedMeasurements.byType.area.length + 1}`,
        categoryId: selectedCategoryId,
      });
      
      toast({ 
        title: "Area Measurement Created", 
        description: `${areaFt2.toFixed(2)} SF` 
      });
    } else if (activeTool === "volume") {
      const defaultDepthInches = 12;
      const depthFt = inchesToFeet(defaultDepthInches);
      const volumeCy = computeVolumeInCY(areaFt2, depthFt);
      
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "VOLUME",
        points: drawingPoints,
        label: `Volume ${aggregatedMeasurements.byType.volume.length + 1}`,
        depthFeet: depthFt,
        categoryId: selectedCategoryId,
      });
      
      toast({ 
        title: "Volume Measurement Created", 
        description: `${areaFt2.toFixed(2)} SF @ ${defaultDepthInches}" depth = ${volumeCy.toFixed(2)} CY` 
      });
    } else if (activeTool === "pitched_area") {
      const pitchedArea = computePitchedAreaFt2(areaFt2, pitchRatio);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "PITCHED_AREA",
        points: drawingPoints,
        label: `Pitched Area ${measurements.length + 1}`,
        categoryId: selectedCategoryId,
        pitchRatio,
        computedSurfaceAreaFt2: pitchedArea,
      });
      toast({
        title: "Pitched Area Created",
        description: `Flat: ${areaFt2.toFixed(2)} SF → Pitched (${pitchRatio}): ${pitchedArea.toFixed(2)} SF`,
      });
    } else if (activeTool === "surface_area") {
      const surfaceArea = computePitchedAreaFt2(areaFt2, pitchRatio);
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "SURFACE_AREA",
        points: drawingPoints,
        label: `Surface ${measurements.length + 1}`,
        categoryId: selectedCategoryId,
        pitchRatio,
        computedSurfaceAreaFt2: surfaceArea,
      });
      toast({
        title: "Surface Area Created",
        description: `Flat: ${areaFt2.toFixed(2)} SF → Surface (${pitchRatio}): ${surfaceArea.toFixed(2)} SF`,
      });
    }
    
    setIsDrawing(false);
    setDrawingPoints([]);
  };

  const handleSaveNote = () => {
    if (!noteText.trim() || !notePosition || !selectedSheet) {
      toast({ title: "Error", description: "Enter note text", variant: "destructive" });
      return;
    }

    createMeasurementMutation.mutate({
      sheetId: selectedSheet,
      type: "NOTE",
      points: [notePosition],
      label: noteText,
    });

    toast({ title: "Note Added", description: "Note saved successfully" });
    setNoteDialogOpen(false);
    setNoteText("");
    setNotePosition(null);
  };

  // Add keyboard handler for completing polygon (only when drawing)
  useEffect(() => {
    if (!isDrawing) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && drawingPoints.length >= 3) {
        completePolygon();
      } else if (e.key === "Escape") {
        setIsDrawing(false);
        setDrawingPoints([]);
        toast({ title: "Drawing Cancelled" });
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawing, drawingPoints, activeTool, selectedSheet, currentSheet]);

  // Fullscreen handlers
  const toggleFullscreen = async () => {
    if (!workspaceRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await workspaceRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch (error) {
      toast({ 
        title: "Fullscreen Error", 
        description: "Could not toggle fullscreen mode", 
        variant: "destructive" 
      });
    }
  };

  // Listen for fullscreen changes (e.g., when user presses ESC)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // Shift key tracking for ortho-lock
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftHeldRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // PHASE 2.2b: Spacebar temporary pan - hold spacebar to temporarily switch to pan mode
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Only trigger for spacebar
      if (event.key !== " " && event.code !== "Space") {
        return;
      }
      
      // Don't trigger if typing in an input field
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      
      // Prevent default spacebar behavior (page scroll)
      event.preventDefault();
      
      // PHASE 2.3a: Don't allow tool changes while drawing multi-point measurements
      if (isDrawing && currentDrawingTool) {
        return;
      }
      
      // Only switch to pan if not already in spacebar pan mode
      if (!isSpacebarHeld && activeTool !== "pan") {
        setToolBeforeSpacebar(activeTool);
        setActiveTool("pan");
        setIsSpacebarHeld(true);
      }
    };
    
    const handleKeyUp = (event: KeyboardEvent) => {
      // Only trigger for spacebar
      if (event.key !== " " && event.code !== "Space") {
        return;
      }
      
      // PHASE 2.3a: Don't allow tool changes while drawing multi-point measurements
      if (isDrawing && currentDrawingTool) {
        return;
      }
      
      // Restore previous tool if spacebar was being held
      if (isSpacebarHeld && toolBeforeSpacebar) {
        setActiveTool(toolBeforeSpacebar);
        setToolBeforeSpacebar(null);
        setIsSpacebarHeld(false);
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [activeTool, isSpacebarHeld, toolBeforeSpacebar, isDrawing, currentDrawingTool]); // PHASE 2.3a: Added drawing states

  // PHASE 2.4: Keyboard shortcuts for tools and actions
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      // Don't trigger if typing in an input field
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }

      // Check if inside a Radix portal using composedPath (dialogs, selects, tooltips, etc.)
      // Walk up the DOM tree to find portal roots
      const path = event.composedPath();
      const isInPortal = path.some(node => {
        // Filter out non-Element nodes (text nodes, etc.)
        if (!(node instanceof Element)) {
          return false;
        }
        
        // Check if this element or any ancestor is a Radix portal
        const closestPortal = node.closest('[data-radix-portal]');
        if (closestPortal) {
          return true;
        }
        
        // Check for other Radix markers and ARIA roles
        return (
          node.hasAttribute('data-radix-focus-guard') ||
          node.hasAttribute('data-radix-popper-content-wrapper') ||
          node.getAttribute('role') === 'dialog' ||
          node.getAttribute('role') === 'menu' ||
          node.getAttribute('role') === 'listbox' ||
          node.getAttribute('role') === 'combobox'
        );
      });
      
      // Check if focus is inside an iframe (PDF viewer, embedded content)
      const activeElement = document.activeElement;
      const isInIframe = activeElement?.tagName === 'IFRAME' ||
                        (target instanceof HTMLElement && target.closest('iframe') !== null);

      // Tool shortcuts should not fire in portals, iframes, or during calibration
      const canUseToolShortcuts = !isInPortal && !isInIframe && calibrationMode === "idle" && !(isDrawing && currentDrawingTool);
      
      // Navigation/view shortcuts can fire even during calibration, but not in portals or iframes
      const canUseNavigationShortcuts = !isInPortal && !isInIframe;
      
      const key = event.key.toLowerCase();
      
      // Tool selection shortcuts (blocked in portals, during calibration, or while drawing)
      if (canUseToolShortcuts) {
        switch (key) {
          case 's':
            event.preventDefault();
            setActiveTool("select");
            break;
          case 'h':
            event.preventDefault();
            setActiveTool("pan");
            break;
          case 'l':
            event.preventDefault();
            setActiveTool("linear");
            break;
          case 'a':
            event.preventDefault();
            setActiveTool("area");
            break;
          case 'v':
            event.preventDefault();
            setActiveTool("volume");
            break;
          case 'c':
            event.preventDefault();
            setActiveTool("count");
            break;
          case 'n':
            event.preventDefault();
            setActiveTool("note");
            break;
          case 'r':
            event.preventDefault();
            setActiveTool("arc");
            break;
          case 'd':
            event.preventDefault();
            setActiveTool("linear_with_drop");
            break;
          case 'p':
            event.preventDefault();
            setActiveTool("pitched_linear");
            break;
          case 't':
            event.preventDefault();
            setActiveTool("pitched_area");
            break;
          case 'g':
            event.preventDefault();
            setActiveTool("surface_area");
            break;
        }
      }
      
      // ESC - Cancel current drawing (only when actually drawing, allowed even in calibration)
      if (key === 'escape' && isDrawing && canUseNavigationShortcuts) {
        event.preventDefault();
        setIsDrawing(false);
        setCurrentDrawingTool(null);
        setDrawingPoints([]);
        toast({ title: "Drawing Cancelled", description: "Press ESC to cancel drawing" });
      }
      
      // F - Toggle fullscreen (navigation shortcut, works during calibration)
      if (key === 'f' && !event.ctrlKey && !event.metaKey && canUseNavigationShortcuts) {
        event.preventDefault();
        toggleFullscreen();
      }
      
      // ? - Show keyboard shortcuts help (Shift + /, navigation shortcut)
      // Handle both browsers that send '?' and browsers that send '/' with Shift
      if ((event.key === '?' || (event.shiftKey && event.key === '/')) && canUseNavigationShortcuts) {
        event.preventDefault();
        setShortcutsDialogOpen(true);
      }
      
      // Ctrl+Z - Undo, Ctrl+Y or Ctrl+Shift+Z - Redo
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        takeoffHistory.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        takeoffHistory.redo();
        return;
      }

      // + or = - Zoom in (navigation shortcut, works during calibration, excludes browser zoom)
      if ((key === '+' || key === '=') && !event.ctrlKey && !event.metaKey && !event.shiftKey && canUseNavigationShortcuts) {
        event.preventDefault();
        setStageScale(prev => Math.min(prev * 1.2, 10)); // Max 10x zoom
      }
      
      // - - Zoom out (navigation shortcut, works during calibration, excludes browser zoom)
      if (key === '-' && !event.ctrlKey && !event.metaKey && !event.shiftKey && canUseNavigationShortcuts) {
        event.preventDefault();
        setStageScale(prev => Math.max(prev / 1.2, 0.1)); // Min 0.1x zoom
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isDrawing, currentDrawingTool, toggleFullscreen, calibrationMode, takeoffHistory]);

  // Update Stage dimensions when container size changes
  useLayoutEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setStageDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    // Initial size
    updateDimensions();

    // Watch for container size changes
    if (containerRef.current) {
      const resizeObserver = new ResizeObserver(updateDimensions);
      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [isFullscreen, selectedSheet]);

  return (
    <div ref={workspaceRef} className="flex h-screen">
      {/* Left Toolbar */}
      <div className="w-20 bg-card border-r flex flex-col items-center py-4 gap-2">
        {TOOL_CONFIG.map((tool, idx) => {
          const Icon = tool.icon;
          const showSeparator = tool.id === "linear_with_drop";
          return (
            <div key={tool.id} className="flex flex-col items-center">
              {showSeparator && <Separator className="my-1 w-12" />}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={activeTool === tool.id ? tool.color as any : "ghost"}
                    size="icon"
                    onClick={() => handleToolSelect(tool.id as Tool)}
                    data-testid={`button-tool-${tool.id}`}
                    className="toggle-elevate"
                  >
                    <Icon className="w-5 h-5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <div className="flex items-center gap-2">
                    <span>{tool.label}</span>
                    {tool.shortcut && (
                      <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">
                        {tool.shortcut}
                      </kbd>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
          );
        })}
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => takeoffHistory.undo()}
              disabled={!takeoffHistory.canUndo || takeoffHistory.isPending}
              data-testid="button-undo"
              className="toggle-elevate"
            >
              <Undo2 className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex items-center gap-2">
              <span>Undo</span>
              <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Z</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => takeoffHistory.redo()}
              disabled={!takeoffHistory.canRedo || takeoffHistory.isPending}
              data-testid="button-redo"
              className="toggle-elevate"
            >
              <Redo2 className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <div className="flex items-center gap-2">
              <span>Redo</span>
              <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">Ctrl+Y</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={snapEnabled ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setSnapEnabled(!snapEnabled)}
              data-testid="button-toggle-snap"
              className="toggle-elevate"
            >
              <Magnet className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{snapEnabled ? "Snap: ON" : "Snap: OFF"}</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={orthoLock ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setOrthoLock(!orthoLock)}
              data-testid="button-toggle-ortho"
              className="toggle-elevate"
            >
              <CornerDownRight className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{orthoLock ? "Ortho: ON (90°)" : "Ortho: OFF"}</p>
          </TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setUploadDialogOpen(true)}
              data-testid="button-upload-plan"
            >
              <Upload className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Import Plan Sheet</p>
          </TooltipContent>
        </Tooltip>
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant={aiPanelOpen ? "secondary" : "ghost"} 
              size="icon" 
              onClick={() => setAiPanelOpen(!aiPanelOpen)}
              data-testid="button-ai-takeoff"
              className="toggle-elevate"
            >
              <Sparkles className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>AI Auto-Takeoff</p>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Center Canvas */}
      <div className="flex-1 flex flex-col bg-muted/30">
        {/* Sheet Selector */}
        <div className="h-14 bg-card border-b px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Label className="text-sm font-medium">Sheet:</Label>
            <Select value={selectedSheet || ""} onValueChange={setSelectedSheet}>
              <SelectTrigger className="w-64" data-testid="select-sheet">
                <SelectValue placeholder="Select a sheet..." />
              </SelectTrigger>
              <SelectContent container={workspaceRef.current}>
                {sheets.map((sheet) => (
                  <SelectItem key={sheet.id} value={sheet.id}>
                    {sheet.sheetName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedSheet && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" data-testid="button-sheet-actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    onClick={() => { setRenameValue(currentSheet?.sheetName || ""); setRenameDialogOpen(true); }}
                    data-testid="menu-rename-sheet"
                  >
                    <Pencil className="h-4 w-4 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => duplicateSheetMutation.mutate(selectedSheet)}
                    disabled={duplicateSheetMutation.isPending}
                    data-testid="menu-duplicate-sheet"
                  >
                    <Copy className="h-4 w-4 mr-2" /> Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => handleMoveSheet("up")}
                    disabled={sheets.findIndex(s => s.id === selectedSheet) <= 0}
                    data-testid="menu-move-sheet-up"
                  >
                    <ArrowUp className="h-4 w-4 mr-2" /> Move Up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => handleMoveSheet("down")}
                    disabled={sheets.findIndex(s => s.id === selectedSheet) >= sheets.length - 1}
                    data-testid="menu-move-sheet-down"
                  >
                    <ArrowDown className="h-4 w-4 mr-2" /> Move Down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteSheetConfirmOpen(true)}
                    data-testid="menu-delete-sheet"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Delete Sheet
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {currentSheet && (
              <Badge variant="outline" data-testid="badge-calibration-status">
                {currentSheet.scalePxPerFoot 
                  ? `Calibrated (${currentSheet.units})` 
                  : "Not Calibrated"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => setShortcutsDialogOpen(true)}
                  data-testid="button-keyboard-shortcuts"
                >
                  <Keyboard className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex items-center gap-2">
                  <span>Keyboard Shortcuts</span>
                  <kbd className="px-1.5 py-0.5 text-xs font-mono bg-muted rounded border">?</kbd>
                </div>
              </TooltipContent>
            </Tooltip>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={toggleFullscreen}
              data-testid="button-toggle-fullscreen"
              title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </Button>
          </div>
        </div>

        {/* Canvas Area */}
        <div 
          ref={containerRef} 
          className="flex-1 overflow-hidden relative"
          style={{
            cursor: activeTool === "pan" ? "grab" : 
                   activeTool === "select" ? "default" : 
                   "crosshair"
          }}
        >
          {selectedSheet ? (
            <Stage
              ref={stageRef}
              width={stageDimensions.width}
              height={stageDimensions.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePosition.x}
              y={stagePosition.y}
              onMouseDown={handleStageMouseDown}
              onMouseUp={handleStageMouseUp}
              onMouseMove={handleStageMouseMove}
              onDblClick={(e) => {
                if ((activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && isDrawing && drawingPoints.length >= 3) {
                  e.evt.preventDefault();
                  completePolygon();
                }
              }}
              onWheel={handleWheel}
              draggable={activeTool === "pan"}
              onDragStart={handleStageDragStart}
              onDragMove={handleStageDragMove}
              onDragEnd={handleStageDragEnd}
            >
              <Layer>
                {/* Render PDF image */}
                {isPdfLoading ? (
                  <Text text="Loading PDF..." x={20} y={20} fontSize={16} fill="#888" />
                ) : pdfImage ? (
                  <KonvaImage image={pdfImage} />
                ) : (
                  <Text text="Select a sheet to begin" x={20} y={20} fontSize={16} fill="#888" />
                )}
                
                {/* Addenda overlay images */}
                {Object.entries(addendaOverlays).map(([addendumId, overlay]) => {
                  if (!overlay.visible || !addendaImages[addendumId]) return null;
                  return (
                    <KonvaImage
                      key={`addenda-overlay-${addendumId}`}
                      image={addendaImages[addendumId]}
                      opacity={overlay.opacity}
                      listening={false}
                    />
                  );
                })}

                {/* Saved measurements */}
                {measurements.map((m) => {
                  const points = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
                  const isSelected = selectedMeasurementId === m.id;
                  
                  // Get category color if measurement has a category
                  const category = m.categoryId ? categories.find(c => c.id === m.categoryId) : null;
                  const categoryColor = validateHexColor(category?.color);
                  const baseColor = categoryColor || (
                    m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" ? "#2563eb" : 
                    m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA" ? "#16a34a" : 
                    m.type === "VOLUME" ? "#ea580c" : 
                    m.type === "COUNT" ? "#dc2626" : "#f59e0b"
                  );
                  
                  const handleMeasurementClick = (e: any) => {
                    if (activeTool === "select") {
                      e.cancelBubble = true;
                      e.evt.stopPropagation();
                      setSelectedMeasurementId(m.id === selectedMeasurementId ? null : m.id);
                    }
                  };
                  
                  if ((m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && points.length >= 2) {
                    // PHASE 2.3a: Check if this is an arc (3 points) or straight line (2 points)
                    if (points.length === 3 && currentSheet?.scalePxPerFoot) {
                      // Render as arc
                      const [startPoint, middlePoint, endPoint] = points;
                      const arcSegment = createArcSegment(
                        startPoint,
                        endPoint,
                        middlePoint,
                        currentSheet.scalePxPerFoot
                      );
                      
                      if (arcSegment) {
                        const arcPoints = sampleArcPoints(arcSegment, 30);
                        const flatPoints = arcPoints.flatMap(p => [p.x, p.y]);
                        
                        return (
                          <Line
                            key={m.id}
                            points={flatPoints}
                            stroke={baseColor}
                            strokeWidth={isSelected ? 5 : 3}
                            opacity={isSelected ? 1 : 0.8}
                            onClick={handleMeasurementClick}
                            onTap={handleMeasurementClick}
                          />
                        );
                      }
                    }
                    
                    // Render as straight line (2 points)
                    return (
                      <Line
                        key={m.id}
                        points={[points[0].x, points[0].y, points[1].x, points[1].y]}
                        stroke={baseColor}
                        strokeWidth={isSelected ? 5 : 3}
                        opacity={isSelected ? 1 : 0.8}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if ((m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && points.length >= 3) {
                    const flatPoints = points.flatMap((p: any) => [p.x, p.y]);
                    return (
                      <Line
                        key={m.id}
                        points={flatPoints}
                        stroke={baseColor}
                        strokeWidth={isSelected ? 5 : 3}
                        fill={isSelected ? hexToRgba(baseColor, 0.3) : hexToRgba(baseColor, 0.15)}
                        opacity={isSelected ? 1 : 0.8}
                        closed={true}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if (m.type === "VOLUME" && points.length >= 3) {
                    const flatPoints = points.flatMap((p: any) => [p.x, p.y]);
                    return (
                      <Line
                        key={m.id}
                        points={flatPoints}
                        stroke={baseColor}
                        strokeWidth={isSelected ? 5 : 3}
                        fill={isSelected ? hexToRgba(baseColor, 0.3) : hexToRgba(baseColor, 0.15)}
                        opacity={isSelected ? 1 : 0.8}
                        closed={true}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if (m.type === "COUNT" && points.length >= 1) {
                    return (
                      <Circle
                        key={m.id}
                        x={points[0].x}
                        y={points[0].y}
                        radius={isSelected ? 14 : 12}
                        fill={baseColor}
                        stroke="white"
                        strokeWidth={isSelected ? 3 : 2}
                        opacity={isSelected ? 1 : 0.8}
                        onClick={handleMeasurementClick}
                        onTap={handleMeasurementClick}
                      />
                    );
                  } else if (m.type === "NOTE" && points.length >= 1) {
                    return (
                      <>
                        {/* Note pin */}
                        <Circle
                          key={`${m.id}-pin`}
                          x={points[0].x}
                          y={points[0].y}
                          radius={isSelected ? 10 : 8}
                          fill={baseColor}
                          stroke="white"
                          strokeWidth={isSelected ? 3 : 2}
                          opacity={isSelected ? 1 : 0.8}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                        />
                        {/* Note label */}
                        <Text
                          key={`${m.id}-text`}
                          x={points[0].x + 15}
                          y={points[0].y - 5}
                          text={m.label || "Note"}
                          fontSize={isSelected ? 14 : 12}
                          fill={baseColor}
                          fontStyle="bold"
                          opacity={isSelected ? 1 : 0.8}
                          onClick={handleMeasurementClick}
                          onTap={handleMeasurementClick}
                        />
                      </>
                    );
                  }
                  return null;
                })}
                
                {/* In-progress drawing */}
                {isDrawing && drawingPoints.length > 0 && (
                  <>
                    {/* LAYER 1: Fill for polygon preview (when 3+ points) - drawn first as background */}
                    {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && drawingPoints.length >= 3 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        fill={hexToRgba(activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : "#ea580c", 0.15)}
                        closed={true}
                        strokeWidth={0}
                      />
                    )}
                    
                    {/* LAYER 2: Dashed outline - drawn on top of fill */}
                    {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && drawingPoints.length >= 2 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        stroke={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : "#ea580c"}
                        strokeWidth={2}
                        dash={[5, 5]}
                      />
                    )}
                    
                    {/* PHASE 2.3a: Arc preview while drawing (show after 2 points) */}
                    {activeTool === "arc" && drawingPoints.length === 2 && currentSheet?.scalePxPerFoot && (() => {
                      // This is just a placeholder - full arc requires 3rd point
                      // Show dashed line from start to middle point
                      return (
                        <Line
                          points={[drawingPoints[0].x, drawingPoints[0].y, drawingPoints[1].x, drawingPoints[1].y]}
                          stroke="#2563eb"
                          strokeWidth={2}
                          dash={[5, 5]}
                        />
                      );
                    })()}
                    
                    {/* LAYER 3: Points - drawn on top so they're visible */}
                    {drawingPoints.map((point, i) => (
                      <Circle
                        key={`temp-${i}`}
                        x={point.x}
                        y={point.y}
                        radius={6}
                        fill={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : activeTool === "volume" ? "#ea580c" : "#2563eb"}
                        stroke="white"
                        strokeWidth={2}
                      />
                    ))}
                    
                    {/* LAYER 4: Highlight first point when drawing polygon with 3+ points - top layer */}
                    {(activeTool === "area" || activeTool === "volume" || activeTool === "pitched_area" || activeTool === "surface_area") && drawingPoints.length >= 3 && (
                      <Circle
                        x={drawingPoints[0].x}
                        y={drawingPoints[0].y}
                        radius={10}
                        stroke={activeTool === "area" || activeTool === "pitched_area" || activeTool === "surface_area" ? "#16a34a" : "#ea580c"}
                        strokeWidth={3}
                        fill="transparent"
                        dash={[3, 3]}
                      />
                    )}
                  </>
                )}
                
                {/* Calibration points */}
                {calibrationPoints.map((point, i) => (
                  <Circle
                    key={`cal-${i}`}
                    x={point.x}
                    y={point.y}
                    radius={8}
                    fill="red"
                    stroke="white"
                    strokeWidth={2}
                  />
                ))}
                
                {/* Calibration line */}
                {calibrationPoints.length === 2 && (
                  <Line
                    points={[
                      calibrationPoints[0].x, calibrationPoints[0].y,
                      calibrationPoints[1].x, calibrationPoints[1].y
                    ]}
                    stroke="red"
                    strokeWidth={2}
                    dash={[10, 5]}
                  />
                )}

                {/* Verification points */}
                {verifyPoints.map((point, i) => (
                  <Circle
                    key={`verify-${i}`}
                    x={point.x}
                    y={point.y}
                    radius={8}
                    fill="#f59e0b"
                    stroke="white"
                    strokeWidth={2}
                  />
                ))}
                {verifyPoints.length === 2 && (
                  <Line
                    points={[verifyPoints[0].x, verifyPoints[0].y, verifyPoints[1].x, verifyPoints[1].y]}
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dash={[8, 4]}
                  />
                )}

                {/* Snap indicator */}
                {currentSnap && currentSnap.isSnapped && currentSnap.snapTarget && (
                  <>
                    <Circle
                      x={currentSnap.snappedPoint.x}
                      y={currentSnap.snappedPoint.y}
                      radius={8 / stageScale}
                      stroke="#f59e0b"
                      strokeWidth={2 / stageScale}
                      fill="transparent"
                    />
                    <Line
                      points={[
                        currentSnap.snappedPoint.x - 12 / stageScale, currentSnap.snappedPoint.y,
                        currentSnap.snappedPoint.x + 12 / stageScale, currentSnap.snappedPoint.y,
                      ]}
                      stroke="#f59e0b"
                      strokeWidth={1 / stageScale}
                    />
                    <Line
                      points={[
                        currentSnap.snappedPoint.x, currentSnap.snappedPoint.y - 12 / stageScale,
                        currentSnap.snappedPoint.x, currentSnap.snappedPoint.y + 12 / stageScale,
                      ]}
                      stroke="#f59e0b"
                      strokeWidth={1 / stageScale}
                    />
                    <Text
                      x={currentSnap.snappedPoint.x + 14 / stageScale}
                      y={currentSnap.snappedPoint.y - 6 / stageScale}
                      text={currentSnap.snapTarget.type === "endpoint" ? "End" : "Mid"}
                      fontSize={11 / stageScale}
                      fill="#f59e0b"
                      fontStyle="bold"
                    />
                  </>
                )}

                {/* Ortho-lock guide line */}
                {orthoLock && isDrawing && drawingPoints.length > 0 && cursorPosition && (
                  <Line
                    points={[
                      drawingPoints[drawingPoints.length - 1].x,
                      drawingPoints[drawingPoints.length - 1].y,
                      cursorPosition.x,
                      cursorPosition.y,
                    ]}
                    stroke="#06b6d4"
                    strokeWidth={1 / stageScale}
                    dash={[6 / stageScale, 4 / stageScale]}
                    opacity={0.6}
                  />
                )}
              </Layer>
            </Stage>
          ) : (
            <div 
              className="flex items-center justify-center h-full cursor-pointer hover-elevate"
              onClick={() => setUploadDialogOpen(true)}
              data-testid="button-empty-upload-area"
            >
              <div className="text-center text-muted-foreground p-8 rounded-lg border-2 border-dashed border-muted-foreground/30">
                <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="font-medium">Select or upload a plan sheet to begin takeoff</p>
                <p className="text-sm mt-2">Click here to import a document</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Takeoff Panel - Slide out panel */}
      {aiPanelOpen && (
        <div className="w-80 bg-card border-l flex flex-col">
          <div className="h-14 bg-card border-b px-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <span className="font-semibold">AI Auto-Takeoff</span>
            </div>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={() => setAiPanelOpen(false)}
              data-testid="button-close-ai-panel"
            >
              <ChevronRight className="w-5 h-5" />
            </Button>
          </div>
          <AiTakeoffPanel 
            projectId={projectId}
            sheetId={selectedSheet}
            onItemsImported={(items) => {
              toast({
                title: "Items Imported",
                description: `Successfully imported ${items.length} items to your takeoff`,
              });
            }}
          />
        </div>
      )}

      {/* Right Sidebar */}
      <div className={cn("w-80 bg-card border-l flex flex-col", aiPanelOpen && "hidden md:flex")}>
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Calibration Panel */}
            {calibrationMode !== "idle" && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h3 className="font-semibold text-sm">Manual Calibration</h3>
                  <p className="text-xs text-muted-foreground">Click two points on a known distance</p>
                  <div>
                    <Label>Real-World Distance</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={calibrationDistance}
                        onChange={(e) => setCalibrationDistance(e.target.value)}
                        placeholder="50"
                        data-testid="input-calibration-distance"
                      />
                      <Select value={units} onValueChange={(v: any) => setUnits(v)}>
                        <SelectTrigger className="w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent container={workspaceRef.current}>
                          <SelectItem value="ft">ft</SelectItem>
                          <SelectItem value="m">m</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button 
                    onClick={handleSaveCalibration} 
                    className="w-full"
                    disabled={calibrationPoints.length !== 2 || !calibrationDistance}
                    data-testid="button-save-calibration"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Save Calibration
                  </Button>
                </CardContent>
              </Card>
            )}
            
            {/* Preset Scale Panel */}
            {selectedSheet && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h3 className="font-semibold text-sm">{currentSheet?.scalePxPerFoot ? "Recalibrate with Preset Scale" : "Or Use Preset Scale"}</h3>
                  <p className="text-xs text-muted-foreground">Select a common architectural, civil, or structural scale</p>
                  <div>
                    <Label>Scale Category</Label>
                    <Select 
                      value={scaleCategory} 
                      onValueChange={(v: any) => {
                        setScaleCategory(v);
                        setSelectedPresetScale("");
                      }}
                    >
                      <SelectTrigger data-testid="select-scale-category">
                        <SelectValue placeholder="Select category..." />
                      </SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        <SelectItem value="architectural">Architectural</SelectItem>
                        <SelectItem value="civil">Civil/Site</SelectItem>
                        <SelectItem value="structural">Structural</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {scaleCategory && (
                    <div>
                      <Label>Scale</Label>
                      <Select 
                        value={selectedPresetScale} 
                        onValueChange={setSelectedPresetScale}
                      >
                        <SelectTrigger data-testid="select-preset-scale">
                          <SelectValue placeholder="Select scale..." />
                        </SelectTrigger>
                        <SelectContent container={workspaceRef.current}>
                          {COMMON_SCALES[scaleCategory as keyof typeof COMMON_SCALES].map((scale) => (
                            <SelectItem key={scale.label} value={scale.label}>
                              {scale.label} - {scale.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <Button 
                    onClick={handleApplyPresetScale} 
                    className="w-full"
                    disabled={!selectedPresetScale}
                    data-testid="button-apply-preset-scale"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    Apply Preset Scale
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Quantity Categories */}
            {selectedSheet && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Quantity Categories</h3>
                    <Button 
                      size="sm" 
                      onClick={() => setCategoryDialogOpen(true)}
                      data-testid="button-add-category"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  {categories.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No categories yet. Create one to organize measurements.
                    </p>
                  ) : (
                    <ScrollArea className="max-h-[300px]">
                      <div className="space-y-2 pr-4">
                        {categories.map((category) => (
                          <div 
                            key={category.id}
                            className="flex items-center justify-between p-2 rounded border hover-elevate"
                            style={{ borderLeft: `4px solid ${category.color}` }}
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div 
                                className="w-4 h-4 rounded flex-shrink-0"
                                style={{ backgroundColor: category.color }}
                              />
                              <span className="text-sm truncate">{category.name}</span>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => {
                                  setEditingCategory(category);
                                  setCategoryDialogOpen(true);
                                }}
                                data-testid={`button-edit-category-${category.id}`}
                              >
                                <Pencil className="w-3 h-3" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => handleDeleteCategory(category.id)}
                                data-testid={`button-delete-category-${category.id}`}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Active Drawing Tool Settings */}
            {(activeTool === "linear" || activeTool === "area" || activeTool === "volume" || activeTool === "count" || activeTool === "linear_with_drop" || activeTool === "pitched_linear" || activeTool === "pitched_area" || activeTool === "surface_area") && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h3 className="font-semibold text-sm">Drawing Settings</h3>
                  <div className="space-y-2">
                    <Label htmlFor="category-select">Quantity Category</Label>
                    <Select
                      value={selectedCategoryId || "none"}
                      onValueChange={(value) => setSelectedCategoryId(value === "none" ? null : value)}
                    >
                      <SelectTrigger id="category-select" data-testid="select-category">
                        <SelectValue placeholder="Select category (optional)" />
                      </SelectTrigger>
                      <SelectContent container={workspaceRef.current}>
                        <SelectItem value="none">None</SelectItem>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>
                            <div className="flex items-center gap-2">
                              <div 
                                className="w-3 h-3 rounded-sm" 
                                style={{ backgroundColor: cat.color }}
                              />
                              {cat.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Measurements will be color-coded and grouped by category
                    </p>
                  </div>

                  {(activeTool === "pitched_linear" || activeTool === "pitched_area" || activeTool === "surface_area") && (
                    <div className="space-y-2">
                      <Label htmlFor="pitch-ratio">Pitch Ratio</Label>
                      <Select
                        value={pitchRatio}
                        onValueChange={setPitchRatio}
                      >
                        <SelectTrigger id="pitch-ratio" data-testid="select-pitch-ratio">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent container={workspaceRef.current}>
                          <SelectItem value="1:12">1:12 (low slope)</SelectItem>
                          <SelectItem value="2:12">2:12</SelectItem>
                          <SelectItem value="3:12">3:12</SelectItem>
                          <SelectItem value="4:12">4:12</SelectItem>
                          <SelectItem value="5:12">5:12</SelectItem>
                          <SelectItem value="6:12">6:12 (standard)</SelectItem>
                          <SelectItem value="7:12">7:12</SelectItem>
                          <SelectItem value="8:12">8:12</SelectItem>
                          <SelectItem value="9:12">9:12</SelectItem>
                          <SelectItem value="10:12">10:12</SelectItem>
                          <SelectItem value="12:12">12:12 (45°)</SelectItem>
                          <SelectItem value="14:12">14:12 (steep)</SelectItem>
                          <SelectItem value="16:12">16:12</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Rise:Run ratio — adjusts measured lengths and areas for slope
                      </p>
                    </div>
                  )}

                  {activeTool === "linear_with_drop" && (
                    <div className="space-y-2">
                      <Label htmlFor="drop-distance">Drop Distance (ft)</Label>
                      <Input
                        id="drop-distance"
                        type="number"
                        value={dropDistance}
                        onChange={(e) => setDropDistance(e.target.value)}
                        placeholder="Vertical drop in feet"
                        data-testid="input-drop-distance"
                      />
                      <p className="text-xs text-muted-foreground">
                        Vertical distance added to horizontal measurement (√(h² + v²))
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Measurements List */}
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold">Measurements</h3>
                  <Badge variant="secondary" data-testid="badge-measurement-count">
                    {measurements.length}
                  </Badge>
                </div>
                {measurements.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No measurements yet
                  </p>
                ) : (
                  <div className="space-y-2">
                    {measurements.map((m) => (
                      <div 
                        key={m.id} 
                        className={`p-3 rounded-md bg-muted hover-elevate cursor-pointer ${
                          selectedMeasurementId === m.id ? 'ring-2 ring-primary' : ''
                        }`}
                        onClick={() => setSelectedMeasurementId(m.id === selectedMeasurementId ? null : m.id)}
                        data-testid={`measurement-item-${m.id}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">{m.label || "Untitled"}</span>
                            <Badge variant="outline" className="text-xs">{m.type}</Badge>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMeasurementMutation.mutate(m);
                            }}
                            data-testid={`button-delete-measurement-${m.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {(m.type === "LINEAR" || m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR") && m.computedLengthFt 
                            ? `${(Number.isFinite(m.computedLengthFt) ? m.computedLengthFt : 0).toFixed(2)} LF${(m as any).pitchRatio ? ` (${(m as any).pitchRatio})` : ""}`
                            : (m.type === "AREA" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA") && (m.computedAreaFt2 || (m as any).computedSurfaceAreaFt2)
                            ? `${((m as any).computedSurfaceAreaFt2 || m.computedAreaFt2 || 0).toFixed(2)} SF${(m as any).pitchRatio ? ` (${(m as any).pitchRatio})` : ""}`
                            : m.type === "VOLUME" && m.computedVolumeCy
                            ? `${(Number.isFinite(m.computedVolumeCy) ? m.computedVolumeCy : 0).toFixed(2)} CY`
                            : m.type === "COUNT"
                            ? "Count marker"
                            : m.type === "NOTE"
                            ? "Note"
                            : ""}
                        </p>
                        {(m as any).costCodeId && (
                          <p className="text-xs text-blue-500 mt-1">Cost Code: {(m as any).costCodeId}</p>
                        )}
                        {(m as any).unitCost && (
                          <p className="text-xs text-green-500">Unit Cost: ${Number((m as any).unitCost).toFixed(2)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {selectedMeasurementId && (() => {
              const selM = measurements.find(m => m.id === selectedMeasurementId);
              if (!selM) return null;
              return (
                <Card>
                  <CardContent className="pt-6 space-y-3">
                    <h3 className="font-semibold text-sm">Measurement Properties</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type:</span>
                        <Badge variant="outline">{selM.type}</Badge>
                      </div>
                      {selM.computedLengthFt && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Length:</span>
                          <span>{Number(selM.computedLengthFt).toFixed(2)} LF</span>
                        </div>
                      )}
                      {selM.computedAreaFt2 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Area:</span>
                          <span>{Number(selM.computedAreaFt2).toFixed(2)} SF</span>
                        </div>
                      )}
                      {(selM as any).computedSurfaceAreaFt2 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Surface Area:</span>
                          <span>{Number((selM as any).computedSurfaceAreaFt2).toFixed(2)} SF</span>
                        </div>
                      )}
                      {selM.computedVolumeCy && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Volume:</span>
                          <span>{Number(selM.computedVolumeCy).toFixed(2)} CY</span>
                        </div>
                      )}
                      {(selM as any).pitchRatio && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Pitch:</span>
                          <span>{(selM as any).pitchRatio}</span>
                        </div>
                      )}
                    </div>
                    <Separator />
                    <div className="space-y-2">
                      <Label className="text-xs">Cost Code</Label>
                      <Input
                        placeholder="Enter cost code..."
                        defaultValue={(selM as any).costCodeId || ""}
                        onBlur={(e) => {
                          const val = e.target.value.trim();
                          if (val !== ((selM as any).costCodeId || "")) {
                            updateMeasurementMutation.mutate({ id: selM.id, costCodeId: val || undefined });
                          }
                        }}
                        className="h-8 text-sm"
                        data-testid="input-cost-code"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Unit Cost ($)</Label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        defaultValue={(selM as any).unitCost || ""}
                        onBlur={(e) => {
                          const val = parseFloat(e.target.value) || undefined;
                          if (val !== (selM as any).unitCost) {
                            updateMeasurementMutation.mutate({ id: selM.id, unitCost: val });
                          }
                        }}
                        className="h-8 text-sm"
                        data-testid="input-unit-cost"
                      />
                    </div>
                    {(selM as any).unitCost && (selM.computedLengthFt || selM.computedAreaFt2 || (selM as any).computedSurfaceAreaFt2) && (
                      <div className="p-2 bg-green-50 dark:bg-green-950/30 rounded text-sm">
                        <div className="flex justify-between font-medium">
                          <span>Estimated Total:</span>
                          <span className="text-green-600 dark:text-green-400">
                            ${(Number((selM as any).unitCost) * Number(
                              (selM as any).computedSurfaceAreaFt2 || selM.computedLengthFt || selM.computedAreaFt2 || 0
                            )).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Quantity Summary by Category */}
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">Quantity Summary by Category</h3>
                <div className="space-y-4">
                  {/* Category-wise breakdown */}
                  {categories.map((category) => {
                    const categoryMeasurements = aggregatedMeasurements.byCategory[category.id] || [];
                    if (categoryMeasurements.length === 0) return null;

                    const linearTotal = categoryMeasurements
                      .filter(m => m.type === "LINEAR")
                      .reduce((sum, m) => {
                        const val = Number(m.computedLengthFt);
                        return sum + (Number.isFinite(val) ? val : 0);
                      }, 0);
                    const areaTotal = categoryMeasurements
                      .filter(m => m.type === "AREA")
                      .reduce((sum, m) => {
                        const val = Number(m.computedAreaFt2);
                        return sum + (Number.isFinite(val) ? val : 0);
                      }, 0);
                    const volumeTotal = categoryMeasurements
                      .filter(m => m.type === "VOLUME")
                      .reduce((sum, m) => {
                        const val = Number(m.computedVolumeCy);
                        return sum + (Number.isFinite(val) ? val : 0);
                      }, 0);
                    const countTotal = categoryMeasurements.filter(m => m.type === "COUNT").length;

                    return (
                      <div key={category.id} className="border-l-4 pl-3" style={{ borderColor: category.color }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: category.color }} />
                          <span className="font-medium text-sm">{category.name}</span>
                          <Badge variant="outline" className="text-xs">{categoryMeasurements.length}</Badge>
                        </div>
                        <div className="space-y-1 text-xs ml-5">
                          {linearTotal > 0 && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Linear:</span>
                              <span>{(Number.isFinite(linearTotal) ? linearTotal : 0).toFixed(2)} LF</span>
                            </div>
                          )}
                          {areaTotal > 0 && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Area:</span>
                              <span>{(Number.isFinite(areaTotal) ? areaTotal : 0).toFixed(2)} SF</span>
                            </div>
                          )}
                          {volumeTotal > 0 && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Volume:</span>
                              <span>{(Number.isFinite(volumeTotal) ? volumeTotal : 0).toFixed(2)} CY</span>
                            </div>
                          )}
                          {countTotal > 0 && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Count:</span>
                              <span>{countTotal}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {/* Uncategorized measurements */}
                  {aggregatedMeasurements.uncategorized.length > 0 && (
                    <div className="border-l-4 border-muted pl-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-sm text-muted-foreground">Uncategorized</span>
                        <Badge variant="outline" className="text-xs">
                          {aggregatedMeasurements.uncategorized.length}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs ml-5">
                        {aggregatedMeasurements.uncategorized.filter(m => m.type === "LINEAR").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Linear:</span>
                            <span>
                              {(() => {
                                const total = aggregatedMeasurements.uncategorized
                                  .filter(m => m.type === "LINEAR")
                                  .reduce((sum, m) => {
                                    const val = Number(m.computedLengthFt);
                                    return sum + (Number.isFinite(val) ? val : 0);
                                  }, 0);
                                return (Number.isFinite(total) ? total : 0).toFixed(2);
                              })()} LF
                            </span>
                          </div>
                        )}
                        {aggregatedMeasurements.uncategorized.filter(m => m.type === "AREA").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Area:</span>
                            <span>
                              {(() => {
                                const total = aggregatedMeasurements.uncategorized
                                  .filter(m => m.type === "AREA")
                                  .reduce((sum, m) => {
                                    const val = Number(m.computedAreaFt2);
                                    return sum + (Number.isFinite(val) ? val : 0);
                                  }, 0);
                                return (Number.isFinite(total) ? total : 0).toFixed(2);
                              })()} SF
                            </span>
                          </div>
                        )}
                        {aggregatedMeasurements.uncategorized.filter(m => m.type === "VOLUME").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Volume:</span>
                            <span>
                              {(() => {
                                const total = aggregatedMeasurements.uncategorized
                                  .filter(m => m.type === "VOLUME")
                                  .reduce((sum, m) => {
                                    const val = Number(m.computedVolumeCy);
                                    return sum + (Number.isFinite(val) ? val : 0);
                                  }, 0);
                                return (Number.isFinite(total) ? total : 0).toFixed(2);
                              })()} CY
                            </span>
                          </div>
                        )}
                        {aggregatedMeasurements.uncategorized.filter(m => m.type === "COUNT").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Count:</span>
                            <span>{aggregatedMeasurements.uncategorized.filter(m => m.type === "COUNT").length}</span>
                          </div>
                        )}
                        {aggregatedMeasurements.uncategorized.filter(m => m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Pitched/Surface:</span>
                            <span>{aggregatedMeasurements.uncategorized.filter(m => m.type === "LINEAR_WITH_DROP" || m.type === "PITCHED_LINEAR" || m.type === "PITCHED_AREA" || m.type === "SURFACE_AREA").length} items</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Grand totals */}
                  {measurements.length > 0 && (
                    <div className="pt-3 border-t space-y-2">
                      <h4 className="font-semibold text-sm">Total Quantities</h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Linear:</span>
                          <span className="font-medium">
                            {(Number.isFinite(aggregatedMeasurements.grandTotals.linearTotal) ? aggregatedMeasurements.grandTotals.linearTotal : 0).toFixed(2)} LF
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Area:</span>
                          <span className="font-medium">
                            {(Number.isFinite(aggregatedMeasurements.grandTotals.areaTotal) ? aggregatedMeasurements.grandTotals.areaTotal : 0).toFixed(2)} SF
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Volume:</span>
                          <span className="font-medium">
                            {(Number.isFinite(aggregatedMeasurements.grandTotals.volumeTotal) ? aggregatedMeasurements.grandTotals.volumeTotal : 0).toFixed(2)} CY
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Count:</span>
                          <span className="font-medium">
                            {aggregatedMeasurements.grandTotals.countTotal}
                          </span>
                        </div>
                        {aggregatedMeasurements.grandTotals.linearWithDropTotal > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Linear+Drop:</span>
                            <span className="font-medium">
                              {aggregatedMeasurements.grandTotals.linearWithDropTotal.toFixed(2)} LF
                            </span>
                          </div>
                        )}
                        {aggregatedMeasurements.grandTotals.pitchedLinearTotal > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Pitched Linear:</span>
                            <span className="font-medium">
                              {aggregatedMeasurements.grandTotals.pitchedLinearTotal.toFixed(2)} LF
                            </span>
                          </div>
                        )}
                        {aggregatedMeasurements.grandTotals.pitchedAreaTotal > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Pitched Area:</span>
                            <span className="font-medium">
                              {aggregatedMeasurements.grandTotals.pitchedAreaTotal.toFixed(2)} SF
                            </span>
                          </div>
                        )}
                        {aggregatedMeasurements.grandTotals.surfaceAreaTotal > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Surface Area:</span>
                            <span className="font-medium">
                              {aggregatedMeasurements.grandTotals.surfaceAreaTotal.toFixed(2)} SF
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Assemblies */}
            {selectedSheet && (
              <Card>
                <CardContent className="pt-6">
                  <AssemblyPanel
                    selectedMeasurementId={selectedMeasurementId}
                  />
                </CardContent>
              </Card>
            )}

            {/* Addenda Overlays */}
            {selectedSheet && (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">Addenda Overlays</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">Toggle addendum documents as overlays on the plan sheet.</p>
                  {projectAddenda.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No addenda for this project.</p>
                  ) : (
                    <div className="space-y-2">
                      {projectAddenda.filter(a => {
                        if (!a.storageKey && !a.fileUrl) return false;
                        const key = a.storageKey || a.fileName || a.fileUrl || "";
                        return /\.(png|jpg|jpeg|gif|webp|bmp|svg|tiff?)$/i.test(key);
                      }).map((addendum) => {
                        const overlay = addendaOverlays[addendum.id];
                        const isVisible = overlay?.visible || false;
                        const opacity = overlay?.opacity ?? 0.5;
                        return (
                          <div key={addendum.id} className="border rounded-md p-2 space-y-2" data-testid={`addenda-overlay-${addendum.id}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => {
                                    setAddendaOverlays(prev => ({
                                      ...prev,
                                      [addendum.id]: {
                                        ...prev[addendum.id],
                                        visible: !isVisible,
                                        opacity: prev[addendum.id]?.opacity ?? 0.5,
                                      },
                                    }));
                                  }}
                                  data-testid={`button-toggle-addendum-${addendum.id}`}
                                >
                                  {isVisible ? <Eye className="w-4 h-4 text-primary" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                                </Button>
                                <span className="text-xs font-medium truncate">
                                  #{addendum.addendumNumber} — {addendum.title}
                                </span>
                              </div>
                              <Badge variant="outline" className="text-[10px] shrink-0">{addendum.status}</Badge>
                            </div>
                            {isVisible && (
                              <div className="flex items-center gap-2 pl-8">
                                <span className="text-[10px] text-muted-foreground w-10">Opacity</span>
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={Math.round(opacity * 100)}
                                  onChange={(e) => {
                                    const newOpacity = parseInt(e.target.value) / 100;
                                    setAddendaOverlays(prev => ({
                                      ...prev,
                                      [addendum.id]: { ...prev[addendum.id], opacity: newOpacity },
                                    }));
                                  }}
                                  className="flex-1 h-1 accent-primary"
                                  data-testid={`slider-opacity-addendum-${addendum.id}`}
                                />
                                <span className="text-[10px] text-muted-foreground w-8 text-right">{Math.round(opacity * 100)}%</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {(() => {
                        const imageAddenda = projectAddenda.filter(a => {
                          if (!a.storageKey && !a.fileUrl) return false;
                          const key = a.storageKey || a.fileName || a.fileUrl || "";
                          return /\.(png|jpg|jpeg|gif|webp|bmp|svg|tiff?)$/i.test(key);
                        });
                        const nonImageCount = projectAddenda.length - imageAddenda.length;
                        if (nonImageCount > 0) return (
                          <p className="text-[10px] text-muted-foreground italic">
                            {nonImageCount} addenda not shown (PDF or no file attached — only image overlays supported)
                          </p>
                        );
                        return null;
                      })()}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Calibration Info */}
            {selectedSheet && currentSheet?.scalePxPerFoot && (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-primary" />
                    <h3 className="font-semibold text-sm">Calibration Info</h3>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Scale:</span>
                      <span className="font-mono">{currentSheet.scalePxPerFoot.toFixed(2)} px/{currentSheet.units || "ft"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Units:</span>
                      <span>{currentSheet.units === "m" ? "Meters" : "Feet"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status:</span>
                      <Badge variant="default" className="text-[10px]">
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Calibrated
                      </Badge>
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        setVerifyMode("first-point");
                        setVerifyPoints([]);
                        setVerifyResult(null);
                        toast({ title: "Scale Verification", description: "Click two points on a known distance to verify accuracy" });
                      }}
                      data-testid="button-start-verify"
                    >
                      <Target className="w-3 h-3 mr-1" /> Verify Scale Accuracy
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        setMultiCalibMode(true);
                        setMultiCalibPoints([]);
                        setCalibrationMode("first-point");
                        setCalibrationPoints([]);
                        toast({ title: "Multi-Point Calibration", description: "Take multiple reference measurements for higher accuracy. Click two points for each reference distance." });
                      }}
                      data-testid="button-start-multi-calib"
                    >
                      <Ruler className="w-3 h-3 mr-1" /> Multi-Point Calibration
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Scale Verification Panel */}
            {(verifyMode !== "idle" || verifyResult) && (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Scale Verification</h3>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setVerifyMode("idle"); setVerifyPoints([]); setVerifyResult(null); setVerifyExpectedDistance(""); }}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {verifyMode === "first-point" ? "Click first point of known distance" : "Click second point to measure"}
                  </p>
                  <div>
                    <Label className="text-xs">Expected Distance</Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        value={verifyExpectedDistance}
                        onChange={(e) => setVerifyExpectedDistance(e.target.value)}
                        placeholder="e.g. 20"
                        className="h-8 text-xs"
                        data-testid="input-verify-distance"
                      />
                      <span className="text-xs text-muted-foreground self-center">{currentSheet?.units || "ft"}</span>
                    </div>
                  </div>
                  {verifyResult && (
                    <>
                      <div className={`p-2 rounded text-xs ${verifyResult.errorPct <= 2 ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800" : verifyResult.errorPct <= 5 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"} border`}>
                        <div className="flex items-center gap-1 mb-1">
                          {verifyResult.errorPct <= 2 ? <CheckCircle2 className="w-3 h-3 text-green-600" /> : <AlertTriangle className="w-3 h-3 text-amber-600" />}
                          <span className="font-medium">{verifyResult.errorPct <= 2 ? "Accurate" : verifyResult.errorPct <= 5 ? "Minor deviation" : "Significant deviation"}</span>
                        </div>
                        <div>Expected: {verifyResult.expected.toFixed(2)} {currentSheet?.units || "ft"}</div>
                        <div>Measured: {verifyResult.measured.toFixed(2)} {currentSheet?.units || "ft"}</div>
                        <div>Error: {verifyResult.errorPct.toFixed(1)}%</div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-xs"
                        onClick={() => {
                          setVerifyMode("first-point");
                          setVerifyPoints([]);
                          setVerifyResult(null);
                        }}
                        data-testid="button-verify-again"
                      >
                        <Target className="w-3 h-3 mr-1" /> Verify Again
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Multi-Point Calibration Panel */}
            {multiCalibMode && (
              <Card>
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Multi-Point Calibration</h3>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setMultiCalibMode(false); setMultiCalibPoints([]); setCalibrationMode("idle"); setCalibrationPoints([]); }}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Add multiple reference measurements, then apply averaged calibration for better accuracy.
                  </p>
                  {multiCalibPoints.length > 0 && (
                    <div className="space-y-1">
                      {multiCalibPoints.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between text-xs p-1 bg-muted rounded">
                          <span>Ref #{i + 1}: {entry.distance} {currentSheet?.units || "ft"}</span>
                          <span className="text-muted-foreground font-mono">{computePixelDistance(entry.points[0], entry.points[1]).toFixed(1)} px</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {calibrationPoints.length === 2 && (
                    <div className="space-y-2">
                      <Label className="text-xs">Distance for this reference</Label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          value={calibrationDistance}
                          onChange={(e) => setCalibrationDistance(e.target.value)}
                          placeholder="Distance"
                          className="h-8 text-xs"
                          data-testid="input-multi-calib-distance"
                        />
                        <Button
                          size="sm"
                          className="h-8 text-xs"
                          disabled={!calibrationDistance}
                          onClick={() => {
                            const dist = parseFloat(calibrationDistance);
                            if (!dist || dist <= 0) return;
                            setMultiCalibPoints(prev => [...prev, {
                              points: [calibrationPoints[0], calibrationPoints[1]],
                              distance: dist,
                            }]);
                            setCalibrationPoints([]);
                            setCalibrationDistance("");
                            setCalibrationMode("first-point");
                            toast({ title: "Reference Added", description: `Reference #${multiCalibPoints.length + 1} recorded. Add more or apply.` });
                          }}
                          data-testid="button-add-multi-ref"
                        >
                          <Plus className="w-3 h-3 mr-1" /> Add
                        </Button>
                      </div>
                    </div>
                  )}
                  {multiCalibPoints.length >= 2 && (
                    <Button
                      className="w-full text-xs"
                      size="sm"
                      onClick={async () => {
                        const avgPxPerUnit = multiCalibPoints.reduce((sum, entry) => {
                          const pxDist = computePixelDistance(entry.points[0], entry.points[1]);
                          return sum + pxDist / entry.distance;
                        }, 0) / multiCalibPoints.length;
                        
                        if (!Number.isFinite(avgPxPerUnit) || avgPxPerUnit <= 0) {
                          toast({ title: "Error", description: "Invalid calibration result", variant: "destructive" });
                          return;
                        }

                        try {
                          await apiRequest("PATCH", `/api/takeoff/sheets/${selectedSheet}/calibration`, {
                            scalePxPerFoot: avgPxPerUnit,
                            units: currentSheet?.units || "ft",
                          });
                          queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
                          queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
                          setMultiCalibMode(false);
                          setMultiCalibPoints([]);
                          setCalibrationMode("idle");
                          setCalibrationPoints([]);
                          toast({ title: "Success", description: `Multi-point calibration applied (${multiCalibPoints.length} references averaged)` });
                        } catch {
                          toast({ title: "Error", description: "Failed to save calibration", variant: "destructive" });
                        }
                      }}
                      data-testid="button-apply-multi-calib"
                    >
                      <Save className="w-3 h-3 mr-1" /> Apply Averaged Calibration ({multiCalibPoints.length} points)
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Rename Sheet Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename Sheet</DialogTitle>
            <DialogDescription>Enter a new name for this sheet.</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="Sheet name..."
            onKeyDown={(e) => {
              if (e.key === "Enter" && renameValue.trim() && selectedSheet) {
                renameSheetMutation.mutate({ sheetId: selectedSheet, sheetName: renameValue.trim() });
              }
            }}
            data-testid="input-rename-sheet"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)} data-testid="button-cancel-rename">Cancel</Button>
            <Button
              onClick={() => selectedSheet && renameSheetMutation.mutate({ sheetId: selectedSheet, sheetName: renameValue.trim() })}
              disabled={!renameValue.trim() || renameSheetMutation.isPending}
              data-testid="button-confirm-rename"
            >
              {renameSheetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Sheet Confirmation Dialog */}
      <Dialog open={deleteSheetConfirmOpen} onOpenChange={setDeleteSheetConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Sheet</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{currentSheet?.sheetName}"? This will also remove all measurements on this sheet. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteSheetConfirmOpen(false)} data-testid="button-cancel-delete-sheet">Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => selectedSheet && deleteSheetMutation.mutate(selectedSheet)}
              disabled={deleteSheetMutation.isPending}
              data-testid="button-confirm-delete-sheet"
            >
              {deleteSheetMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note Dialog */}
      <DialogPrimitive.Root open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogPrimitive.Portal container={workspaceRef.current}>
          <DialogPrimitive.Overlay className={cn(
            "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )} />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg"
            )}
            data-testid="dialog-note"
          >
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
                Add Note
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                Add a note to mark this location on the drawing
              </DialogPrimitive.Description>
            </div>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="note-text">Note Text</Label>
                <Textarea
                  id="note-text"
                  placeholder="Enter your note here..."
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  data-testid="input-note-text"
                  rows={4}
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setNoteDialogOpen(false);
                  setNoteText("");
                  setNotePosition(null);
                }}
                data-testid="button-cancel-note"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveNote}
                data-testid="button-save-note"
              >
                Save Note
              </Button>
            </div>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Category Dialog */}
      <DialogPrimitive.Root open={categoryDialogOpen} onOpenChange={(open) => {
        setCategoryDialogOpen(open);
        if (!open) {
          setEditingCategory(null);
        }
      }}>
        <DialogPrimitive.Portal container={workspaceRef.current}>
          <DialogPrimitive.Overlay className={cn(
            "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )} />
          <DialogPrimitive.Content
            className={cn(
              "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg"
            )}
            data-testid="dialog-category"
          >
            <div className="flex flex-col space-y-1.5 text-center sm:text-left">
              <DialogPrimitive.Title className="text-lg font-semibold leading-none tracking-tight">
                {editingCategory ? "Edit Category" : "Add Category"}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                Create or edit quantity categories to organize your measurements
              </DialogPrimitive.Description>
            </div>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="category-name">Category Name</Label>
                <Input
                  id="category-name"
                  placeholder="e.g., Sidewalk, Curb, Curb & Gutter..."
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                  data-testid="input-category-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="category-color">Color</Label>
                <div className="flex gap-2 items-center">
                  <Input
                    id="category-color"
                    type="color"
                    value={categoryColor}
                    onChange={(e) => setCategoryColor(e.target.value)}
                    className="w-20 h-10 cursor-pointer"
                    data-testid="input-category-color"
                  />
                  <Input
                    type="text"
                    value={categoryColor}
                    onChange={(e) => setCategoryColor(e.target.value)}
                    placeholder="#3b82f6"
                    className="flex-1 font-mono"
                    data-testid="input-category-color-text"
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button 
                variant="outline" 
                onClick={() => {
                  setCategoryDialogOpen(false);
                  setEditingCategory(null);
                }}
                data-testid="button-cancel-category"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSaveCategory}
                data-testid="button-save-category"
                disabled={saveCategoryMutation.isPending}
              >
                {saveCategoryMutation.isPending ? "Saving..." : (editingCategory ? "Update" : "Create")}
              </Button>
            </div>
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* PHASE 2.4: Keyboard Shortcuts Help Dialog */}
      <Dialog open={shortcutsDialogOpen} onOpenChange={setShortcutsDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Keyboard Shortcuts</DialogTitle>
            <DialogDescription>
              Speed up your workflow with these keyboard shortcuts
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6">
            <div>
              <h3 className="font-semibold mb-3">Tools</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Select Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">S</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Hand/Pan Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">H</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Linear Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">L</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Arc/Radius Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">R</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Area Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">A</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Volume Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">V</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Count Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">C</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Note Tool</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">N</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Linear + Drop</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">D</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Pitched Linear</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">P</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Pitched Area</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">T</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Surface Area</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">G</kbd>
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-3">Navigation & View</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Temporary Pan</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">Space</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Zoom In</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">+ / =</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Zoom Out</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">-</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Mouse Wheel Zoom</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">Scroll</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Toggle Fullscreen</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">F</kbd>
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <h3 className="font-semibold mb-3">Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Undo</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">Ctrl+Z</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Redo</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">Ctrl+Y</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Cancel Drawing</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">ESC</kbd>
                </div>
                <div className="flex items-center justify-between p-2 rounded hover-elevate">
                  <span className="text-sm">Complete Polygon</span>
                  <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded border">Enter</kbd>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import Plan Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Plan Sheet</DialogTitle>
            <DialogDescription>
              Select a plan document to import into the takeoff workspace
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {documentsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : planDocuments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No plan documents found</p>
                <p className="text-sm mt-2">
                  Upload plan documents to the project first via the Documents section
                </p>
              </div>
            ) : (
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-2">
                  {planDocuments.map((doc) => {
                    // Check if this document is already imported
                    const isAlreadyImported = sheets.some(
                      (sheet: any) => sheet.documentId === doc.id
                    );
                    
                    return (
                      <div
                        key={doc.id}
                        className={cn(
                          "flex items-center gap-3 p-3 rounded-lg border",
                          isAlreadyImported 
                            ? "bg-muted/50 cursor-not-allowed opacity-60"
                            : "hover-elevate cursor-pointer"
                        )}
                        onClick={() => {
                          if (!isAlreadyImported && !importPlanMutation.isPending) {
                            importPlanMutation.mutate(doc.id);
                          }
                        }}
                        data-testid={`button-import-doc-${doc.id}`}
                      >
                        <FileText className="w-8 h-8 text-primary flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {doc.title || doc.fileName}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">
                            {doc.fileName}
                          </p>
                        </div>
                        {isAlreadyImported ? (
                          <Badge variant="secondary">Imported</Badge>
                        ) : importPlanMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setUploadDialogOpen(false)}
              data-testid="button-close-import-dialog"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
