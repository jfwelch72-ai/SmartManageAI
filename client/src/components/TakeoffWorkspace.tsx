import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogPortal } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { 
  MousePointer2, Hand, ZoomIn, Ruler, Square, Circle as CircleIcon, 
  Box, MapPin, StickyNote, Upload, Trash2, Save, Download, Sparkles, Maximize, Minimize, Plus, Pencil 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TakeoffSheet, TakeoffMeasurement, QuantityCategory } from "@shared/schema";
import * as pdfjsLib from 'pdfjs-dist';

type Tool = 
  | "select" 
  | "pan" 
  | "zoom" 
  | "calibrate" 
  | "linear" 
  | "area" 
  | "volume" 
  | "count" 
  | "note";

type MeasurementType = "LINEAR" | "AREA" | "VOLUME" | "COUNT" | "NOTE";

interface TakeoffWorkspaceProps {
  projectId: string;
  projectCode: string;
}

const TOOL_CONFIG = [
  { id: "select", icon: MousePointer2, label: "Select", color: "default" },
  { id: "pan", icon: Hand, label: "Pan", color: "default" },
  { id: "zoom", icon: ZoomIn, label: "Zoom", color: "default" },
  { id: "calibrate", icon: Ruler, label: "Calibrate", color: "secondary" },
  { id: "linear", icon: Ruler, label: "Linear", color: "primary" },
  { id: "area", icon: Square, label: "Area", color: "primary" },
  { id: "volume", icon: Box, label: "Volume", color: "primary" },
  { id: "count", icon: MapPin, label: "Count", color: "primary" },
  { id: "note", icon: StickyNote, label: "Note", color: "default" },
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
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null);
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
  
  // Select tool state
  const [selectedMeasurementId, setSelectedMeasurementId] = useState<string | null>(null);
  
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
  
  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // Fetch sheets for this project
  const { data: sheets = [], isLoading: sheetsLoading } = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/projects", projectId, "takeoff", "sheets"],
  });

  // Fetch measurements for selected sheet
  const { data: measurements = [], isLoading: measurementsLoading } = useQuery<TakeoffMeasurement[]>({
    queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"],
    enabled: !!selectedSheet,
  });

  // Mutation for creating measurements
  const createMeasurementMutation = useMutation({
    mutationFn: async (data: {
      sheetId: string;
      type: MeasurementType;
      points: { x: number; y: number }[];
      label?: string;
      depthInches?: number;
      categoryId?: string | null;
    }) => {
      return await apiRequest("POST", "/api/takeoff/measurements", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      toast({ title: "Success", description: "Measurement saved" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save measurement", variant: "destructive" });
    },
  });

  // Mutation for deleting measurements
  const deleteMeasurementMutation = useMutation({
    mutationFn: async (measurementId: string) => {
      return await apiRequest("DELETE", `/api/takeoff/measurements/${measurementId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      setSelectedMeasurementId(null);
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
      if (data.id) {
        return await apiRequest("PATCH", `/api/quantity-categories/${data.id}`, { 
          name: data.name, 
          color: data.color 
        });
      } else {
        return await apiRequest("POST", `/api/projects/${projectCode}/quantity-categories`, { 
          name: data.name, 
          color: data.color, 
          displayOrder: categories.length 
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "quantity-categories"] });
      setCategoryDialogOpen(false);
      setEditingCategory(null);
      setCategoryName("");
      setCategoryColor("#3b82f6");
      toast({ title: "Success", description: editingCategory ? "Category updated" : "Category created" });
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

  const currentSheet = sheets.find(s => s.id === selectedSheet);

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
    if (tool === "calibrate") {
      setCalibrationMode("first-point");
      setCalibrationPoints([]);
      toast({ 
        title: "Calibration Mode", 
        description: "Click two points on a known distance to calibrate scale" 
      });
    }
  };

  const handleStageClick = (e: any) => {
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    
    // Transform pointer position to sheet space (accounting for pan/zoom)
    const transform = stage.getAbsoluteTransform().copy().invert();
    const point = transform.point(pointerPosition);
    
    // Clear selection when clicking empty space with select tool
    // Only clear if clicking the stage itself, not a shape
    if (activeTool === "select") {
      if (e.target === stage) {
        setSelectedMeasurementId(null);
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
        setCalibrationMode("idle");
        
        const pixelDistance = Math.sqrt(
          Math.pow(newPoints[1].x - newPoints[0].x, 2) + 
          Math.pow(newPoints[1].y - newPoints[0].y, 2)
        );
        
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
        const pixelDistance = Math.sqrt(
          Math.pow(newPoints[1].x - newPoints[0].x, 2) + 
          Math.pow(newPoints[1].y - newPoints[0].y, 2)
        );
        
        const lengthFt = pixelDistance / currentSheet.scalePxPerFoot;
        
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
    } else if (activeTool === "area" || activeTool === "volume") {
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
          description: "Click to add points. Double-click or press Enter to finish." 
        });
      } else {
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
        label: `Count ${measurements.filter(m => m.type === "COUNT").length + 1}`,
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

    const pixelDistance = Math.sqrt(
      Math.pow(calibrationPoints[1].x - calibrationPoints[0].x, 2) + 
      Math.pow(calibrationPoints[1].y - calibrationPoints[0].y, 2)
    );

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

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    
    const scaleBy = 1.1;
    const stage = e.target.getStage();
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    
    const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
    
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

    // Calculate area using shoelace formula
    let area = 0;
    for (let i = 0; i < drawingPoints.length; i++) {
      const j = (i + 1) % drawingPoints.length;
      area += drawingPoints[i].x * drawingPoints[j].y;
      area -= drawingPoints[j].x * drawingPoints[i].y;
    }
    area = Math.abs(area / 2);
    
    // Convert pixel area to square feet
    const areaFt2 = area / (currentSheet.scalePxPerFoot * currentSheet.scalePxPerFoot);
    
    if (activeTool === "area") {
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "AREA",
        points: drawingPoints,
        label: `Area ${measurements.filter(m => m.type === "AREA").length + 1}`,
        categoryId: selectedCategoryId,
      });
      
      toast({ 
        title: "Area Measurement Created", 
        description: `${areaFt2.toFixed(2)} SF` 
      });
    } else if (activeTool === "volume") {
      // For volume, we'll need to prompt for depth
      // For now, just create as area type until we add depth input
      createMeasurementMutation.mutate({
        sheetId: selectedSheet,
        type: "VOLUME",
        points: drawingPoints,
        label: `Volume ${measurements.filter(m => m.type === "VOLUME").length + 1}`,
        depthInches: 12, // Default 12" depth, will add UI for this later
        categoryId: selectedCategoryId,
      });
      
      toast({ 
        title: "Volume Measurement Created", 
        description: `Base area: ${areaFt2.toFixed(2)} SF (depth needed)` 
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
        {TOOL_CONFIG.map((tool) => {
          const Icon = tool.icon;
          return (
            <Tooltip key={tool.id}>
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
                <p>{tool.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
        <Separator className="my-2 w-12" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-upload-plan">
              <Upload className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>Upload Plan</p>
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
              <SelectContent>
                {sheets.map((sheet) => (
                  <SelectItem key={sheet.id} value={sheet.id}>
                    {sheet.sheetName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentSheet && (
              <Badge variant="outline" data-testid="badge-calibration-status">
                {currentSheet.scalePxPerFoot 
                  ? `Calibrated (${currentSheet.units})` 
                  : "Not Calibrated"}
              </Badge>
            )}
          </div>
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

        {/* Canvas Area */}
        <div ref={containerRef} className="flex-1 overflow-hidden relative">
          {selectedSheet ? (
            <Stage
              ref={stageRef}
              width={stageDimensions.width}
              height={stageDimensions.height}
              scaleX={stageScale}
              scaleY={stageScale}
              x={stagePosition.x}
              y={stagePosition.y}
              onClick={handleStageClick}
              onDblClick={(e) => {
                if ((activeTool === "area" || activeTool === "volume") && isDrawing && drawingPoints.length >= 3) {
                  e.evt.preventDefault();
                  completePolygon();
                }
              }}
              onWheel={handleWheel}
              draggable={activeTool === "pan"}
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
                
                {/* Saved measurements */}
                {measurements.map((m) => {
                  const points = typeof m.points === 'string' ? JSON.parse(m.points) : m.points;
                  const isSelected = selectedMeasurementId === m.id;
                  
                  // Get category color if measurement has a category
                  const category = m.categoryId ? categories.find(c => c.id === m.categoryId) : null;
                  const categoryColor = validateHexColor(category?.color);
                  const baseColor = categoryColor || (
                    m.type === "LINEAR" ? "#2563eb" : 
                    m.type === "AREA" ? "#16a34a" : 
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
                  
                  if (m.type === "LINEAR" && points.length >= 2) {
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
                  } else if (m.type === "AREA" && points.length >= 3) {
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
                    {(activeTool === "area" || activeTool === "volume") && drawingPoints.length >= 3 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        fill={hexToRgba(activeTool === "area" ? "#16a34a" : "#ea580c", 0.15)}
                        closed={true}
                        strokeWidth={0}
                      />
                    )}
                    
                    {/* LAYER 2: Dashed outline - drawn on top of fill */}
                    {(activeTool === "area" || activeTool === "volume") && drawingPoints.length >= 2 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        stroke={activeTool === "area" ? "#16a34a" : "#ea580c"}
                        strokeWidth={2}
                        dash={[5, 5]}
                      />
                    )}
                    
                    {/* LAYER 3: Points - drawn on top so they're visible */}
                    {drawingPoints.map((point, i) => (
                      <Circle
                        key={`temp-${i}`}
                        x={point.x}
                        y={point.y}
                        radius={6}
                        fill={activeTool === "area" ? "#16a34a" : activeTool === "volume" ? "#ea580c" : "#2563eb"}
                        stroke="white"
                        strokeWidth={2}
                      />
                    ))}
                    
                    {/* LAYER 4: Highlight first point when drawing polygon with 3+ points - top layer */}
                    {(activeTool === "area" || activeTool === "volume") && drawingPoints.length >= 3 && (
                      <Circle
                        x={drawingPoints[0].x}
                        y={drawingPoints[0].y}
                        radius={10}
                        stroke={activeTool === "area" ? "#16a34a" : "#ea580c"}
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
              </Layer>
            </Stage>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground">
                <Upload className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Select or upload a plan sheet to begin takeoff</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Sidebar */}
      <div className="w-80 bg-card border-l flex flex-col">
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
                        <SelectContent>
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
            {selectedSheet && !currentSheet?.scalePxPerFoot && (
              <Card>
                <CardContent className="pt-6 space-y-4">
                  <h3 className="font-semibold text-sm">Or Use Preset Scale</h3>
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
                      <SelectContent>
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
                        <SelectContent>
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
                  <div className="space-y-2">
                    {categories.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        No categories yet. Create one to organize measurements.
                      </p>
                    ) : (
                      categories.map((category) => (
                        <div 
                          key={category.id}
                          className="flex items-center justify-between p-2 rounded border hover-elevate"
                          style={{ borderLeft: `4px solid ${category.color}` }}
                        >
                          <div className="flex items-center gap-2 flex-1">
                            <div 
                              className="w-4 h-4 rounded"
                              style={{ backgroundColor: category.color }}
                            />
                            <span className="text-sm">{category.name}</span>
                          </div>
                          <div className="flex gap-1">
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
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Active Drawing Tool Settings */}
            {(activeTool === "linear" || activeTool === "area" || activeTool === "volume" || activeTool === "count") && (
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
                      <SelectContent>
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
                              deleteMeasurementMutation.mutate(m.id);
                            }}
                            data-testid={`button-delete-measurement-${m.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                        {(m.computedLengthFt || m.computedAreaFt2 || m.computedVolumeCy || m.type === "COUNT" || m.type === "NOTE") && (
                          <p className="text-sm text-muted-foreground">
                            {m.type === "LINEAR" && m.computedLengthFt 
                              ? `${(Number.isFinite(m.computedLengthFt) ? m.computedLengthFt : 0).toFixed(2)} LF`
                              : m.type === "AREA" && m.computedAreaFt2
                              ? `${(Number.isFinite(m.computedAreaFt2) ? m.computedAreaFt2 : 0).toFixed(2)} SF`
                              : m.type === "VOLUME" && m.computedVolumeCy
                              ? `${(Number.isFinite(m.computedVolumeCy) ? m.computedVolumeCy : 0).toFixed(2)} CY`
                              : m.type === "COUNT"
                              ? "Count marker"
                              : m.type === "NOTE"
                              ? "Note"
                              : ""}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quantity Summary by Category */}
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">Quantity Summary by Category</h3>
                <div className="space-y-4">
                  {/* Category-wise breakdown */}
                  {categories.map((category) => {
                    const categoryMeasurements = measurements.filter(m => m.categoryId === category.id);
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
                  {measurements.filter(m => !m.categoryId).length > 0 && (
                    <div className="border-l-4 border-muted pl-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-sm text-muted-foreground">Uncategorized</span>
                        <Badge variant="outline" className="text-xs">
                          {measurements.filter(m => !m.categoryId).length}
                        </Badge>
                      </div>
                      <div className="space-y-1 text-xs ml-5">
                        {measurements.filter(m => !m.categoryId && m.type === "LINEAR").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Linear:</span>
                            <span>
                              {(() => {
                                const total = measurements
                                  .filter(m => !m.categoryId && m.type === "LINEAR")
                                  .reduce((sum, m) => {
                                    const val = Number(m.computedLengthFt);
                                    return sum + (Number.isFinite(val) ? val : 0);
                                  }, 0);
                                return (Number.isFinite(total) ? total : 0).toFixed(2);
                              })()} LF
                            </span>
                          </div>
                        )}
                        {measurements.filter(m => !m.categoryId && m.type === "AREA").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Area:</span>
                            <span>
                              {(() => {
                                const total = measurements
                                  .filter(m => !m.categoryId && m.type === "AREA")
                                  .reduce((sum, m) => {
                                    const val = Number(m.computedAreaFt2);
                                    return sum + (Number.isFinite(val) ? val : 0);
                                  }, 0);
                                return (Number.isFinite(total) ? total : 0).toFixed(2);
                              })()} SF
                            </span>
                          </div>
                        )}
                        {measurements.filter(m => !m.categoryId && m.type === "VOLUME").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Volume:</span>
                            <span>
                              {(() => {
                                const total = measurements
                                  .filter(m => !m.categoryId && m.type === "VOLUME")
                                  .reduce((sum, m) => {
                                    const val = Number(m.computedVolumeCy);
                                    return sum + (Number.isFinite(val) ? val : 0);
                                  }, 0);
                                return (Number.isFinite(total) ? total : 0).toFixed(2);
                              })()} CY
                            </span>
                          </div>
                        )}
                        {measurements.filter(m => !m.categoryId && m.type === "COUNT").length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Count:</span>
                            <span>{measurements.filter(m => !m.categoryId && m.type === "COUNT").length}</span>
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
                            {(() => {
                              const total = measurements
                                .filter(m => m.type === "LINEAR")
                                .reduce((sum, m) => {
                                  const val = Number(m.computedLengthFt);
                                  return sum + (Number.isFinite(val) ? val : 0);
                                }, 0);
                              return (Number.isFinite(total) ? total : 0).toFixed(2);
                            })()} LF
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Area:</span>
                          <span className="font-medium">
                            {(() => {
                              const total = measurements
                                .filter(m => m.type === "AREA")
                                .reduce((sum, m) => {
                                  const val = Number(m.computedAreaFt2);
                                  return sum + (Number.isFinite(val) ? val : 0);
                                }, 0);
                              return (Number.isFinite(total) ? total : 0).toFixed(2);
                            })()} SF
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Volume:</span>
                          <span className="font-medium">
                            {(() => {
                              const total = measurements
                                .filter(m => m.type === "VOLUME")
                                .reduce((sum, m) => {
                                  const val = Number(m.computedVolumeCy);
                                  return sum + (Number.isFinite(val) ? val : 0);
                                }, 0);
                              return (Number.isFinite(total) ? total : 0).toFixed(2);
                            })()} CY
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Count:</span>
                          <span className="font-medium">
                            {measurements.filter(m => m.type === "COUNT").length}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </div>

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogPortal container={workspaceRef.current}>
          <DialogContent data-testid="dialog-note">
            <DialogHeader>
              <DialogTitle>Add Note</DialogTitle>
            </DialogHeader>
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
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        </DialogPortal>
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={(open) => {
        setCategoryDialogOpen(open);
        if (!open) {
          setEditingCategory(null);
        }
      }}>
        <DialogPortal container={workspaceRef.current}>
          <DialogContent data-testid="dialog-category">
            <DialogHeader>
              <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
            </DialogHeader>
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
            <DialogFooter>
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
            </DialogFooter>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </div>
  );
}
