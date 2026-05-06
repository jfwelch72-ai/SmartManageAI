# COMPLETE TAKEOFF + ESTIMATING ENGINE SOURCE CODE DUMP
## TFR Construction Management Platform
## Generated: November 22, 2025

This document contains the complete, unmodified source code for the Takeoff + Estimating Engine system.
All files are presented in their entirety using the ---- FILE START/END ---- format.

---

TABLE OF CONTENTS:
1. Frontend Components (React + TypeScript)
   - TakeoffWorkspace.tsx (1760 lines)
   - ScopeProgressTracker.tsx (643 lines)
   - ScopeItemProgressRow.tsx (160 lines)
   - ScopeOfWorkTable.tsx (132 lines)

2. Database Schema (Drizzle ORM)
   - shared/schema.ts (Takeoff/Estimating sections)

3. Backend Routes (Express.js)
   - server/routes.ts (Takeoff/Estimating/Calibration/Scope sections)

---
import { useState, useRef, useEffect, useLayoutEffect } from "react";
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
          description: "Click to add points. Click first point to close polygon." 
        });
      } else {
        // Check if clicking near first point to close polygon (when 3+ points exist)
        if (drawingPoints.length >= 3) {
          const firstPoint = drawingPoints[0];
          const distance = Math.sqrt(
            Math.pow(point.x - firstPoint.x, 2) + Math.pow(point.y - firstPoint.y, 2)
          );
          
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
              <SelectContent container={workspaceRef.current}>
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
    </div>
  );
}


============================================================
==== FILE START: client/src/components/ScopeProgressTracker.tsx ====
============================================================

import { useState, Fragment, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ScopeItem } from "@shared/schema";
import ScopeItemProgressRow from "./ScopeItemProgressRow";

interface ScopeProgressTrackerProps {
  scopeItems: ScopeItem[];
  isLoading: boolean;
  projectCode: string;
}

export default function ScopeProgressTracker({ scopeItems, isLoading, projectCode }: ScopeProgressTrackerProps) {
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [selectedScopeItem, setSelectedScopeItem] = useState<ScopeItem | null>(null);
  const [showNewScopeDialog, setShowNewScopeDialog] = useState(false);
  
  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Sync filter state FROM URL when location changes
  useEffect(() => {
    const searchParams = new URLSearchParams(location.split('?')[1] || '');
    const urlSearch = searchParams.get('search') || '';
    const urlUnit = searchParams.get('unit') || 'all';
    const urlStatus = searchParams.get('status') || 'all';
    
    // Only update state if ALL values differ to avoid redundant renders
    const needsUpdate = urlSearch !== searchTerm || urlUnit !== unitFilter || urlStatus !== statusFilter;
    
    if (needsUpdate) {
      if (urlSearch !== searchTerm) setSearchTerm(urlSearch);
      if (urlUnit !== unitFilter) setUnitFilter(urlUnit);
      if (urlStatus !== statusFilter) setStatusFilter(urlStatus);
    }
  }, [location, searchTerm, unitFilter, statusFilter]);

  // Sync filter state TO URL when filters change
  useEffect(() => {
    // Start from current URL params to preserve other query parameters
    const params = new URLSearchParams(location.split('?')[1] || '');
    
    // Update or remove filter-specific params
    if (searchTerm) {
      params.set('search', searchTerm);
    } else {
      params.delete('search');
    }
    
    if (unitFilter !== 'all') {
      params.set('unit', unitFilter);
    } else {
      params.delete('unit');
    }
    
    if (statusFilter !== 'all') {
      params.set('status', statusFilter);
    } else {
      params.delete('status');
    }
    
    const queryString = params.toString();
    const newPath = location.split('?')[0] + (queryString ? `?${queryString}` : '');
    
    // Only update if the path has changed to avoid infinite loops
    if (newPath !== location) {
      setLocation(newPath, { replace: true });
    }
  }, [searchTerm, unitFilter, statusFilter, location, setLocation]);
  
  // Form state for daily progress
  const [workDate, setWorkDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [quantityCompleted, setQuantityCompleted] = useState("");
  const [billedQuantity, setBilledQuantity] = useState("");
  const [billingStatus, setBillingStatus] = useState<"NOT_READY" | "READY_TO_BILL" | "BILLED">("NOT_READY");
  const [notes, setNotes] = useState("");

  // Form state for new scope item
  const [newScopeDescription, setNewScopeDescription] = useState("");
  const [newScopeUnit, setNewScopeUnit] = useState("");
  const [newScopeTotalQty, setNewScopeTotalQty] = useState("");
  const [newScopeUnitPrice, setNewScopeUnitPrice] = useState("");

  // Apply filters to scope items
  const filteredScopeItems = scopeItems.filter((item) => {
    const matchesSearch = searchTerm === "" || 
      item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesUnit = unitFilter === "all" || item.unit === unitFilter;
    const matchesStatus = statusFilter === "all" || item.billingStatus === statusFilter;
    return matchesSearch && matchesUnit && matchesStatus;
  });

  // Get unique units and statuses for filter dropdowns
  const uniqueUnits = Array.from(new Set(scopeItems.map(item => item.unit))).sort();
  const uniqueStatuses = ["NOT_READY", "READY_TO_BILL", "BILLED"];

  // Calculate summary totals grouped by unit (filtering and aggregating same units makes sense!)
  const summaryByUnit = filteredScopeItems.reduce((acc, item) => {
    const unit = item.unit;
    if (!acc[unit]) {
      acc[unit] = { total: 0, completed: 0, billed: 0, remaining: 0 };
    }
    const total = parseFloat(item.totalQuantity);
    const completed = parseFloat(item.completedQuantity || "0");
    const billed = parseFloat(item.billedQuantity || "0");
    const remaining = total - completed;
    
    acc[unit].total += total;
    acc[unit].completed += completed;
    acc[unit].billed += billed;
    acc[unit].remaining += remaining;
    return acc;
  }, {} as Record<string, { total: number; completed: number; billed: number; remaining: number }>);

  // Create daily progress mutation
  const createProgressMutation = useMutation({
    mutationFn: async (data: {
      scopeItemId: string;
      workDate: string;
      quantityCompleted: string;
      billedQuantity: string;
      billingStatus: string;
      notes?: string;
    }) => {
      return apiRequest("POST", `/api/scope-items/${data.scopeItemId}/progress`, data);
    },
    onSuccess: async (_data, variables) => {
      // Await invalidation to ensure fresh data before showing success
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Daily progress recorded" });
      setShowProgressDialog(false);
      resetForm();
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to record progress", variant: "destructive" });
    },
  });

  // Delete progress mutation
  const deleteProgressMutation = useMutation({
    mutationFn: async ({ scopeItemId, progressId }: { scopeItemId: string; progressId: string }) => {
      return apiRequest("DELETE", `/api/scope-items/${scopeItemId}/progress/${progressId}`);
    },
    onSuccess: async (_data, variables) => {
      // Await invalidation to ensure fresh data before showing success
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/scope-items", variables.scopeItemId, "progress"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Progress entry deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete entry", variant: "destructive" });
    },
  });

  // Create new scope item mutation
  const createScopeItemMutation = useMutation({
    mutationFn: async (data: {
      description: string;
      unit: string;
      totalQuantity: string;
      unitPrice?: string;
    }) => {
      return apiRequest("POST", `/api/projects/${projectCode}/scope`, data);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "scope"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects"] }),
      ]);
      toast({ title: "Success", description: "Scope item created successfully" });
      setShowNewScopeDialog(false);
      resetNewScopeForm();
    },
    onError: (error: any) => {
      toast({ 
        title: "Error", 
        description: error?.message || "Failed to create scope item", 
        variant: "destructive" 
      });
    },
  });

  const toggleExpand = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const resetForm = () => {
    setWorkDate(format(new Date(), "yyyy-MM-dd"));
    setQuantityCompleted("");
    setBilledQuantity("");
    setBillingStatus("NOT_READY");
    setNotes("");
    setSelectedScopeItem(null);
  };

  const resetNewScopeForm = () => {
    setNewScopeDescription("");
    setNewScopeUnit("");
    setNewScopeTotalQty("");
    setNewScopeUnitPrice("");
  };

  const handleCreateProgress = () => {
    if (!selectedScopeItem || !quantityCompleted) {
      toast({ title: "Error", description: "Please fill in required fields", variant: "destructive" });
      return;
    }

    createProgressMutation.mutate({
      scopeItemId: selectedScopeItem.id,
      workDate,
      quantityCompleted: quantityCompleted || "0",
      billedQuantity: billedQuantity || "0",
      billingStatus,
      notes,
    });
  };

  const handleDeleteProgress = (scopeItemId: string, progressId: string) => {
    if (confirm("Are you sure you want to delete this progress entry?")) {
      deleteProgressMutation.mutate({ scopeItemId, progressId });
    }
  };

  const handleCreateScopeItem = () => {
    if (!newScopeDescription || !newScopeUnit || !newScopeTotalQty) {
      toast({ title: "Error", description: "Please fill in required fields", variant: "destructive" });
      return;
    }

    const totalQty = parseFloat(newScopeTotalQty);
    if (isNaN(totalQty) || totalQty <= 0) {
      toast({ title: "Error", description: "Total quantity must be a positive number", variant: "destructive" });
      return;
    }

    createScopeItemMutation.mutate({
      description: newScopeDescription,
      unit: newScopeUnit,
      totalQuantity: newScopeTotalQty,
      unitPrice: newScopeUnitPrice || undefined,
    });
  };

  const openProgressDialog = (item: ScopeItem) => {
    setSelectedScopeItem(item);
    setShowProgressDialog(true);
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading scope items...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards Grouped by Unit */}
      {Object.keys(summaryByUnit).length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Object.entries(summaryByUnit).map(([unit, totals]) => (
            <Card key={unit}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {unit} Quantities
                </CardTitle>
                <Badge variant="outline">{unit}</Badge>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total:</span>
                    <span className="font-mono font-medium">{totals.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Completed:</span>
                    <span className="font-mono font-medium text-green-600 dark:text-green-400">{totals.completed.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Billed:</span>
                    <span className="font-mono font-medium text-blue-600 dark:text-blue-400">{totals.billed.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Remaining:</span>
                    <span className="font-mono font-medium text-orange-600 dark:text-orange-400">{totals.remaining.toLocaleString()}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      
      {/* Filter and Actions Bar - Always visible */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor="search">Search SOW (Scope of Work)</Label>
              <Input
                id="search"
                placeholder="Search scope of work..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                data-testid="input-search-scope"
              />
            </div>
            <div className="w-[180px]">
              <Label htmlFor="unit-filter">Filter by Unit</Label>
              <Select value={unitFilter} onValueChange={setUnitFilter}>
                <SelectTrigger id="unit-filter" data-testid="select-unit-filter">
                  <SelectValue placeholder="All Units" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Units</SelectItem>
                  {uniqueUnits.map(unit => (
                    <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px]">
              <Label htmlFor="status-filter">Filter by Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter" data-testid="select-status-filter">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {uniqueStatuses.map(status => (
                    <SelectItem key={status} value={status}>{status.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => setShowNewScopeDialog(true)}
              data-testid="button-new-scope-item"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Scope Item
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scope Items Table with Expandable Progress or Empty State */}
      {scopeItems.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium">No scope items yet</p>
              <p className="text-sm mt-2">Click "New Scope Item" to get started</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>SOW (Scope of Work)</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Total Qty</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead>Billing Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredScopeItems.map((item) => {
              const total = parseFloat(item.totalQuantity);
              const completed = parseFloat(item.completedQuantity || "0");
              const billed = parseFloat(item.billedQuantity || "0");
              const remaining = total - completed;
              const isExpanded = expandedItems.has(item.id);

              return (
                <Fragment key={item.id}>
                  <TableRow data-testid={`row-scope-${item.id}`}>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleExpand(item.id)}
                        data-testid={`button-expand-${item.id}`}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell>{item.unit}</TableCell>
                    <TableCell className="text-right font-mono">{total.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{completed.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{billed.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{remaining.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          item.billingStatus === "BILLED" ? "default" :
                          item.billingStatus === "READY_TO_BILL" ? "destructive" :
                          "secondary"
                        }
                        data-testid={`badge-billing-${item.id}`}
                      >
                        {item.billingStatus?.replace("_", " ") || "NOT READY"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openProgressDialog(item)}
                        data-testid={`button-add-progress-${item.id}`}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Add Progress
                      </Button>
                    </TableCell>
                  </TableRow>
                  {isExpanded && (
                    <ScopeItemProgressRow 
                      scopeItemId={item.id}
                      onDelete={(progressId) => handleDeleteProgress(item.id, progressId)}
                    />
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      )}

      {/* Add Progress Dialog */}
      <Dialog open={showProgressDialog} onOpenChange={setShowProgressDialog}>
        <DialogContent data-testid="dialog-add-progress">
          <DialogHeader>
            <DialogTitle>Record Daily Progress</DialogTitle>
          </DialogHeader>
          {selectedScopeItem && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm font-medium">{selectedScopeItem.description}</p>
                <p className="text-xs text-muted-foreground">Unit: {selectedScopeItem.unit}</p>
              </div>
              <div>
                <Label htmlFor="work-date">Work Date</Label>
                <Input
                  id="work-date"
                  type="date"
                  value={workDate}
                  onChange={(e) => setWorkDate(e.target.value)}
                  data-testid="input-work-date"
                />
              </div>
              <div>
                <Label htmlFor="quantity-completed">Quantity Completed *</Label>
                <Input
                  id="quantity-completed"
                  type="number"
                  step="0.01"
                  value={quantityCompleted}
                  onChange={(e) => setQuantityCompleted(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-quantity-completed"
                />
              </div>
              <div>
                <Label htmlFor="billed-quantity">Billed Quantity</Label>
                <Input
                  id="billed-quantity"
                  type="number"
                  step="0.01"
                  value={billedQuantity}
                  onChange={(e) => setBilledQuantity(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-billed-quantity"
                />
              </div>
              <div>
                <Label htmlFor="billing-status">Billing Status</Label>
                <Select value={billingStatus} onValueChange={(value: any) => setBillingStatus(value)}>
                  <SelectTrigger id="billing-status" data-testid="select-billing-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_READY">Not Ready</SelectItem>
                    <SelectItem value="READY_TO_BILL">Ready to Bill</SelectItem>
                    <SelectItem value="BILLED">Billed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="progress-notes">Notes (Optional)</Label>
                <Textarea
                  id="progress-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any notes about today's work..."
                  rows={3}
                  data-testid="input-progress-notes"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowProgressDialog(false);
                resetForm();
              }}
              data-testid="button-cancel-progress"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateProgress}
              disabled={createProgressMutation.isPending}
              data-testid="button-save-progress"
            >
              {createProgressMutation.isPending ? "Saving..." : "Save Progress"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Scope Item Dialog */}
      <Dialog open={showNewScopeDialog} onOpenChange={setShowNewScopeDialog}>
        <DialogContent data-testid="dialog-new-scope-item">
          <DialogHeader>
            <DialogTitle>Create New Scope Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-description">SOW (Scope of Work) *</Label>
              <Input
                id="new-description"
                value={newScopeDescription}
                onChange={(e) => setNewScopeDescription(e.target.value)}
                placeholder="e.g., 4' Sidewalk, Slab on Grade, 18' Curb, Excavation, Bollards"
                data-testid="input-new-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="new-unit">Unit *</Label>
                <Input
                  id="new-unit"
                  value={newScopeUnit}
                  onChange={(e) => setNewScopeUnit(e.target.value)}
                  placeholder="e.g., SF, LF, EA, CY"
                  data-testid="input-new-unit"
                />
              </div>
              <div>
                <Label htmlFor="new-total-qty">Total Quantity *</Label>
                <Input
                  id="new-total-qty"
                  type="number"
                  step="0.01"
                  value={newScopeTotalQty}
                  onChange={(e) => setNewScopeTotalQty(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-new-total-qty"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="new-unit-price">Unit Price (Optional)</Label>
              <Input
                id="new-unit-price"
                type="number"
                step="0.01"
                value={newScopeUnitPrice}
                onChange={(e) => setNewScopeUnitPrice(e.target.value)}
                placeholder="0.00"
                data-testid="input-new-unit-price"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowNewScopeDialog(false);
                resetNewScopeForm();
              }}
              data-testid="button-cancel-new-scope"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateScopeItem}
              disabled={createScopeItemMutation.isPending}
              data-testid="button-save-new-scope"
            >
              {createScopeItemMutation.isPending ? "Creating..." : "Create Scope Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

============================================================
==== FILE END: client/src/components/ScopeProgressTracker.tsx ====
============================================================


============================================================
==== FILE START: client/src/components/ScopeItemProgressRow.tsx ====
============================================================

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Calendar, Check } from "lucide-react";
import { format } from "date-fns";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { DailyScopeProgress } from "@shared/schema";
import { useAuth } from "@/hooks/use-auth";

interface DailyProgressWithCreator {
  progress: DailyScopeProgress;
  creator: {
    id: string;
    firstName: string;
    lastName: string;
  } | null;
}

interface ScopeItemProgressRowProps {
  scopeItemId: string;
  onDelete: (progressId: string) => void;
}

export default function ScopeItemProgressRow({ scopeItemId, onDelete }: ScopeItemProgressRowProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { data: progressEntries, isLoading } = useQuery<DailyProgressWithCreator[]>({
    queryKey: ["/api/scope-items", scopeItemId, "progress"],
  });

  // Mutation to update billing status
  const updateBillingStatusMutation = useMutation({
    mutationFn: async ({ progressId, billingStatus }: { progressId: string; billingStatus: string }) => {
      return apiRequest("PATCH", `/api/scope-items/${scopeItemId}/progress/${progressId}`, { billingStatus });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/scope-items", scopeItemId, "progress"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      toast({ title: "Success", description: "Billing status updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update billing status", variant: "destructive" });
    },
  });

  // Check if user can edit billing status (Superintendent, Office Manager, Admin, Manager)
  const canEditBillingStatus = user && ["SUPERINTENDENT", "OFFICE_MANAGER", "ADMIN", "MANAGER"].includes(user.role);

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={9} className="bg-muted/50 p-4">
          <div className="text-center text-sm text-muted-foreground">Loading progress history...</div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell colSpan={9} className="bg-muted/50 p-4">
        <div className="space-y-2">
          <h4 className="font-semibold text-sm mb-3">Daily Progress History</h4>
          {!progressEntries || progressEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No daily progress entries yet</p>
          ) : (
            <div className="rounded-md border bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Qty Completed</TableHead>
                    <TableHead className="text-right">Qty Billed</TableHead>
                    <TableHead>Billing Status</TableHead>
                    <TableHead>Billed Date</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Recorded By</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {progressEntries.map(({ progress, creator }) => (
                    <TableRow key={progress.id} data-testid={`row-progress-${progress.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(progress.workDate), "MMM d, yyyy")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(progress.quantityCompleted).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {parseFloat(progress.billedQuantity).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {canEditBillingStatus ? (
                          <Select
                            value={progress.billingStatus}
                            onValueChange={(value) => updateBillingStatusMutation.mutate({
                              progressId: progress.id,
                              billingStatus: value,
                            })}
                            disabled={updateBillingStatusMutation.isPending}
                          >
                            <SelectTrigger className="w-36 h-8" data-testid={`select-billing-status-${progress.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="NOT_READY">NOT READY</SelectItem>
                              <SelectItem value="READY_TO_BILL">READY TO BILL</SelectItem>
                              <SelectItem value="BILLED">BILLED</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {progress.billingStatus.replace("_", " ")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {progress.billedDate ? (
                          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
                            {format(new Date(progress.billedDate), "MMM d, yyyy")}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {progress.notes || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {creator ? `${creator.firstName} ${creator.lastName}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(progress.id)}
                          data-testid={`button-delete-progress-${progress.id}`}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

============================================================
==== FILE END: client/src/components/ScopeItemProgressRow.tsx ====
============================================================


============================================================
==== FILE START: client/src/components/ScopeOfWorkTable.tsx ====
============================================================

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ScopeItem {
  id: string;
  description: string;
  unit: string;
  totalQuantity: number;
  completedQuantity: number;
}

interface ScopeOfWorkTableProps {
  items: ScopeItem[];
  onUpdateProgress?: (itemId: string, completed: number) => void;
  readOnly?: boolean;
}

export default function ScopeOfWorkTable({ items, onUpdateProgress, readOnly = false }: ScopeOfWorkTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const handleSave = (itemId: string) => {
    const value = parseFloat(editValue);
    if (!isNaN(value) && onUpdateProgress) {
      onUpdateProgress(itemId, value);
    }
    setEditingId(null);
    setEditValue("");
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="font-semibold">Item Description</TableHead>
            <TableHead className="font-semibold">Unit</TableHead>
            <TableHead className="font-semibold text-right">Total Qty</TableHead>
            <TableHead className="font-semibold text-right">Completed</TableHead>
            <TableHead className="font-semibold">Progress</TableHead>
            {!readOnly && <TableHead className="font-semibold">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const progressPercent = (item.completedQuantity / item.totalQuantity) * 100;
            const isEditing = editingId === item.id;

            return (
              <TableRow key={item.id} data-testid={`row-scope-${item.id}`}>
                <TableCell className="font-medium">{item.description}</TableCell>
                <TableCell>{item.unit}</TableCell>
                <TableCell className="text-right font-mono">{item.totalQuantity.toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  {isEditing ? (
                    <Input
                      type="number"
                      step="0.1"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="w-24 text-right font-mono"
                      autoFocus
                      data-testid={`input-completed-${item.id}`}
                    />
                  ) : (
                    <span className="font-mono">{item.completedQuantity.toLocaleString()}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress value={progressPercent} className="flex-1" />
                    <span className="text-xs text-muted-foreground font-mono w-12 text-right">
                      {Math.round(progressPercent)}%
                    </span>
                  </div>
                </TableCell>
                {!readOnly && (
                  <TableCell>
                    {isEditing ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          onClick={() => handleSave(item.id)}
                          data-testid={`button-save-${item.id}`}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingId(null);
                            setEditValue("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(item.id);
                          setEditValue(item.completedQuantity.toString());
                        }}
                        data-testid={`button-update-${item.id}`}
                      >
                        Update
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

============================================================
==== FILE END: client/src/components/ScopeOfWorkTable.tsx ====
============================================================


============================================================
==== FILE START: shared/schema.ts (TAKEOFF + ESTIMATING TABLES ONLY) ====
============================================================

  entityId: varchar("entity_id").notNull(),
  action: auditActionEnum("action").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  entityTypeIdx: index("audit_log_entity_type_idx").on(table.entityType),
  entityIdIdx: index("audit_log_entity_id_idx").on(table.entityId),
  userIdIdx: index("audit_log_user_id_idx").on(table.userId),
  createdAtIdx: index("audit_log_created_at_idx").on(table.createdAt),
}));

// Billing Events table
export const billingEvents = pgTable("billing_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scopeItemId: varchar("scope_item_id").notNull().references(() => scopeItems.id, { onDelete: "cascade" }),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unitPrice: decimal("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalAmount: decimal("total_amount", { precision: 12, scale: 2 }).notNull(),
  description: text("description"),
  createdById: varchar("created_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Time Clock Shifts table
export const timeClockShifts = pgTable("time_clock_shifts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "set null" }),
  clockIn: timestamp("clock_in").notNull(),
  clockOut: timestamp("clock_out"),
  clockInLatitude: doublePrecision("clock_in_latitude"),
  clockInLongitude: doublePrecision("clock_in_longitude"),
  clockOutLatitude: doublePrecision("clock_out_latitude"),
  clockOutLongitude: doublePrecision("clock_out_longitude"),
  notes: text("notes"),
  autoClockOut: boolean("auto_clock_out").notNull().default(false),
  approvalStatus: shiftApprovalStatusEnum("approval_status").notNull().default("PENDING"),
  approvedById: varchar("approved_by_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  totalHours: decimal("total_hours", { precision: 6, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("time_clock_shifts_user_id_idx").on(table.userId),
  clockInIdx: index("time_clock_shifts_clock_in_idx").on(table.clockIn),
  approvalStatusIdx: index("time_clock_shifts_approval_status_idx").on(table.approvalStatus),
}));

// Time Clock Events table
export const timeClockEvents = pgTable("time_clock_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shiftId: varchar("shift_id").notNull().references(() => timeClockShifts.id, { onDelete: "cascade" }),
  eventType: clockEventTypeEnum("event_type").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  notes: text("notes"),
  performedById: varchar("performed_by_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// AI Settings table
export const aiSettings = pgTable("ai_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dailyRunsEnabled: boolean("daily_runs_enabled").notNull().default(true),
  dailyRunTime: text("daily_run_time").notNull().default("06:00"),
  roleTasksEnabled: boolean("role_tasks_enabled").notNull().default(true),
  billingAlertsEnabled: boolean("billing_alerts_enabled").notNull().default(true),
  profitabilityWarningsEnabled: boolean("profitability_warnings_enabled").notNull().default(true),
  crewSchedulingEnabled: boolean("crew_scheduling_enabled").notNull().default(true),
  bidRemindersEnabled: boolean("bid_reminders_enabled").notNull().default(true),
  materialOrderingEnabled: boolean("material_ordering_enabled").notNull().default(true),
  modelName: text("model_name").notNull().default("gpt-4o"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// AI Runs table
export const aiRuns = pgTable("ai_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runType: text("run_type").notNull().default("daily"),
  status: text("status").notNull().default("in_progress"),
  triggeredById: varchar("triggered_by_id").references(() => users.id),
  snapshotData: text("snapshot_data"),
  profitabilityData: text("profitability_data"),
  aiResponse: text("ai_response"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  createdAtIdx: index("ai_runs_created_at_idx").on(table.createdAt),
}));

// AI Tasks table (role-based prioritized tasks)
export const aiTasks = pgTable("ai_tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  runId: varchar("run_id").notNull().references(() => aiRuns.id, { onDelete: "cascade" }),
  taskType: text("task_type").notNull(),
  role: userRoleEnum("role").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  priority: aiTaskPriorityEnum("priority").notNull().default("MEDIUM"),
  status: aiTaskStatusEnum("status").notNull().default("PENDING"),
  dueDate: timestamp("due_date"),
  projectId: varchar("project_id").references(() => projects.id, { onDelete: "cascade" }),
  projectCode: text("project_code"),
  metadata: text("metadata"),
  assignedToId: varchar("assigned_to_id").references(() => users.id, { onDelete: "set null" }),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  roleIdx: index("ai_tasks_role_idx").on(table.role),
  statusIdx: index("ai_tasks_status_idx").on(table.status),
  priorityIdx: index("ai_tasks_priority_idx").on(table.priority),
}));

// ==================================================
// TAKEOFF + ESTIMATING ENGINE TABLES
// ==================================================

// Enums for takeoff and estimating
export const measurementTypeEnum = pgEnum("measurement_type", ["LINEAR", "AREA", "VOLUME", "COUNT", "NOTE"]);
export const measurementSourceEnum = pgEnum("measurement_source", ["USER", "AI"]);
export const measurementStatusEnum = pgEnum("measurement_status", ["DRAFT", "CONFIRMED"]);
export const scopeTypeEnum = pgEnum("scope_type", ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "UNDERDRAIN", "BASE", "BEDDING", "GENERAL"]);
export const estimateItemCategoryEnum = pgEnum("estimate_item_category", ["CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "OVERHEAD", "PROFIT", "GENERAL"]);

// Project Plans table (for uploaded PDFs)
export const projectPlans = pgTable("project_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  documentId: varchar("document_id").references(() => planDocuments.id, { onDelete: "set null" }),
  originalPdfUrl: text("original_pdf_url").notNull(),
  fileName: text("file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Quantity Categories table (for organizing measurements by scope/type)
export const quantityCategories = pgTable("quantity_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull().default("#3b82f6"),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("quantity_categories_project_idx").on(table.projectId),
}));

// Takeoff Sheets table (per-page images from PDFs)
export const takeoffSheets = pgTable("takeoff_sheets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").references(() => projectPlans.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  sheetIndex: integer("sheet_index").notNull().default(0),
  sheetName: text("sheet_name"),
  scalePxPerFoot: doublePrecision("scale_px_per_foot"),
  units: text("units").notNull().default("ft"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdx: index("takeoff_sheets_project_idx").on(table.projectId),
  planIdx: index("takeoff_sheets_plan_idx").on(table.planId),
}));

// Takeoff Measurements table
export const takeoffMeasurements = pgTable("takeoff_measurements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sheetId: varchar("sheet_id").notNull().references(() => takeoffSheets.id, { onDelete: "cascade" }),
  categoryId: varchar("category_id").references(() => quantityCategories.id, { onDelete: "set null" }),
  type: measurementTypeEnum("type").notNull(),
  label: text("label").notNull(),
  points: text("points").notNull(),
  arcData: text("arc_data"),
  depthFeet: doublePrecision("depth_feet"),
  count: integer("count"),
  note: text("note"),
  color: text("color").default("#3b82f6"),
  visible: boolean("visible").notNull().default(true),
  source: measurementSourceEnum("source").notNull().default("USER"),
  status: measurementStatusEnum("status").notNull().default("DRAFT"),
  computedLengthFt: doublePrecision("computed_length_ft"),
  computedAreaFt2: doublePrecision("computed_area_ft2"),
  computedVolumeCy: doublePrecision("computed_volume_cy"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sheetIdx: index("takeoff_measurements_sheet_idx").on(table.sheetId),
  categoryIdx: index("takeoff_measurements_category_idx").on(table.categoryId),
  typeIdx: index("takeoff_measurements_type_idx").on(table.type),
  statusIdx: index("takeoff_measurements_status_idx").on(table.status),
}));

// Project Specs table (uploaded spec books)
export const projectSpecs = pgTable("project_specs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  fileUrl: text("file_url").notNull(),
  originalFileName: text("original_file_name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Project Spec Index table (AI-generated index of specs)
export const projectSpecIndex = pgTable("project_spec_index", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Settings table (global cost settings and rates)
export const estimateSettings = pgTable("estimate_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  defaultMaterialPrices: text("default_material_prices").notNull().default('{}'),
  defaultLaborRates: text("default_labor_rates").notNull().default('{}'),
  defaultEquipmentRates: text("default_equipment_rates").notNull().default('{}'),
  defaultProductionRates: text("default_production_rates").notNull().default('{}'),
  defaultOverheadPercent: doublePrecision("default_overhead_percent").notNull().default(15),
  defaultProfitMarginPercent: doublePrecision("default_profit_margin_percent").notNull().default(20),
  defaultMarkups: text("default_markups").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Crews table (crew definitions and production rates)
export const estimateCrews = pgTable("estimate_crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  members: text("members").notNull().default('[]'),
  blendedRatePerHour: decimal("blended_rate_per_hour", { precision: 10, scale: 2 }).notNull(),
  productionRateMapping: text("production_rate_mapping").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Estimate Line Items table (detailed cost breakdown per line)
export const estimateLineItems = pgTable("estimate_line_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  category: estimateItemCategoryEnum("category").notNull(),
  description: text("description").notNull(),
  quantity: decimal("quantity", { precision: 12, scale: 2 }).notNull(),
  unit: text("unit").notNull(),
  materialCost: decimal("material_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  laborHours: decimal("labor_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  laborCost: decimal("labor_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  equipmentHours: decimal("equipment_hours", { precision: 10, scale: 2 }).notNull().default('0'),
  equipmentCost: decimal("equipment_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  consumablesCost: decimal("consumables_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  subcontractCost: decimal("subcontract_cost", { precision: 12, scale: 2 }).notNull().default('0'),
  overheadAllocation: decimal("overhead_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  profitAllocation: decimal("profit_allocation", { precision: 12, scale: 2 }).notNull().default('0'),
  totalCost: decimal("total_cost", { precision: 12, scale: 2 }).notNull(),
  userAdjusted: boolean("user_adjusted").notNull().default(false),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_line_items_estimate_idx").on(table.estimateId),
  categoryIdx: index("estimate_line_items_category_idx").on(table.category),
}));

// Estimate Versions table (snapshots of estimates)
export const estimateVersions = pgTable("estimate_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  versionNumber: integer("version_number").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_versions_estimate_idx").on(table.estimateId),
}));

// Estimate Vendor Quotes table (uploaded vendor/material quotes)
export const estimateVendorQuotes = pgTable("estimate_vendor_quotes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  estimateId: varchar("estimate_id").notNull().references(() => estimates.id, { onDelete: "cascade" }),
  vendorName: text("vendor_name").notNull(),
  contactInfo: text("contact_info"),
  scopeDescription: text("scope_description").notNull(),
  quoteAmount: decimal("quote_amount", { precision: 12, scale: 2 }).notNull(),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  linkedLineItemIds: text("linked_line_item_ids").notNull().default('[]'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  estimateIdx: index("estimate_vendor_quotes_estimate_idx").on(table.estimateId),
}));

// Estimate History table (for production rate tracking)
export const estimateHistory = pgTable("estimate_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  estimateId: varchar("estimate_id").references(() => estimates.id, { onDelete: "cascade" }),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Insert and Select Schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  tokenVersion: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProjectSchema = createInsertSchema(projects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBidSchema = createInsertSchema(bids).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertBidSubcontractorQuoteSchema = createInsertSchema(bidSubcontractorQuotes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  fileUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  mimeType: z.string().optional(),
});

export const insertEstimateSchema = createInsertSchema(estimates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertProcurementItemSchema = createInsertSchema(procurementItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertPlanDocumentSchema = createInsertSchema(planDocuments).omit({
  id: true,
  uploadedAt: true,
});

export const insertTimeEntrySchema = createInsertSchema(timeEntries).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  approvedAt: true,
});

export const insertTMDailySheetSchema = createInsertSchema(tmDailySheets).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertReceiptSchema = createInsertSchema(receipts).omit({
  id: true,
  createdAt: true,
});

export const insertProjectNoteSchema = createInsertSchema(projectNotes).omit({
  id: true,
  createdAt: true,
});

export const insertCompanyDailyNoteSchema = createInsertSchema(companyDailyNotes).omit({
  id: true,
  createdAt: true,
});

export const insertAINoteInsightSchema = createInsertSchema(aiNoteInsights).omit({
  id: true,
  createdAt: true,
});

export const insertScopeItemSchema = createInsertSchema(scopeItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDailyScopeProgressSchema = createInsertSchema(dailyScopeProgress).omit({
  id: true,
  billedDate: true,
  billedById: true,
  createdAt: true,
  updatedAt: true,
});

export const insertMediaSchema = createInsertSchema(media).omit({
  id: true,
  uploadedAt: true,
});

export const insertFilePermissionSchema = createInsertSchema(filePermissions).omit({
  id: true,
  grantedAt: true,
});

// Type exports
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type SelectUser = Omit<User, 'passwordHash'>;

export type InsertProject = z.infer<typeof insertProjectSchema>;

============================================================
==== FILE END: shared/schema.ts (TAKEOFF + ESTIMATING TABLES) ====
============================================================


============================================================
==== FILE START: server/routes.ts (TAKEOFF + ESTIMATING + SCOPE + CALIBRATION ROUTES) ====
============================================================


  // ====================
  // TAKEOFF + ESTIMATING ROUTES
  // ====================

  // Get all takeoff sheets for a project
  app.get("/api/projects/:projectId/takeoff/sheets", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { takeoffSheets, projectPlans } = await import("@shared/schema");

      const sheets = await db
        .select({
          id: takeoffSheets.id,
          projectId: takeoffSheets.projectId,
          planId: takeoffSheets.planId,
          imageUrl: takeoffSheets.imageUrl,
          sheetIndex: takeoffSheets.sheetIndex,
          sheetName: takeoffSheets.sheetName,
          scalePxPerFoot: takeoffSheets.scalePxPerFoot,
          units: takeoffSheets.units,
          createdAt: takeoffSheets.createdAt,
          updatedAt: takeoffSheets.updatedAt,
          documentId: projectPlans.documentId,
        })
        .from(takeoffSheets)
        .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
        .where(eq(takeoffSheets.projectId, projectId))
        .orderBy(takeoffSheets.sheetIndex);

      res.json(sheets);
    } catch (error) {
      console.error("Error fetching takeoff sheets:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Stream PDF directly for a takeoff sheet (with authorization)
  app.get("/api/takeoff/sheets/:sheetId/pdf", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffSheets, projectPlans, planDocuments } = await import("@shared/schema");

      // Get the sheet with plan and document info
      const [sheetData] = await db
        .select({
          sheet: takeoffSheets,
          plan: projectPlans,
          document: planDocuments,
        })
        .from(takeoffSheets)
        .leftJoin(projectPlans, eq(takeoffSheets.planId, projectPlans.id))
        .leftJoin(planDocuments, eq(projectPlans.documentId, planDocuments.id))
        .where(eq(takeoffSheets.id, sheetId))
        .limit(1);

      if (!sheetData) {
        res.status(404).json({ error: "Sheet not found" });
        return;
      }

      const { sheet, plan, document } = sheetData;

      // Verify project exists and user has access
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, sheet.projectId))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // Check if user has permission to access this document
      const userRole = req.user!.role;
      const userId = req.user!.id;

      // Admins and Managers have full access
      const hasRoleAccess = userRole === "ADMIN" || userRole === "MANAGER";

      // Check if user uploaded the document or has explicit permission
      let hasDocumentAccess = hasRoleAccess;
      if (!hasDocumentAccess && document) {
        // Check if user uploaded this document
        const isUploader = document.uploadedById === userId;
        
        // Check for explicit file permission
        const [permission] = await db
          .select()
          .from(filePermissions)
          .where(
            and(
              eq(filePermissions.fileId, document.id),
              eq(filePermissions.fileType, "DOCUMENT"),
              eq(filePermissions.userId, userId)
            )
          )
          .limit(1);

        hasDocumentAccess = isUploader || !!permission;
      }

      if (!hasDocumentAccess) {
        res.status(403).json({ error: "You do not have permission to access this document" });
        return;
      }

      // If document exists and has objectKey, stream the file
      if (document?.objectKey) {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        
        try {
          const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
          
          // Stream the file directly to the response with caching
          await objectStorageService.downloadObject(objectFile, res, 3600); // 1 hour cache
          return;
        } catch (error: any) {
          console.error("Error streaming PDF from objectKey:", error);
          
          // If object not found, return 404 instead of 500
          if (error.name === 'ObjectNotFoundError' || error.message?.includes('not found')) {
            res.status(404).json({ error: "PDF file no longer exists. Please re-upload the document." });
            return;
          }
          
          res.status(500).json({ error: "Internal server error" });
          return;
        }
      }

      // No valid document/objectKey available - cannot serve PDF securely
      res.status(404).json({ error: "No PDF file available for this sheet. Please re-import the document." });
    } catch (error: any) {
      console.error("Stream sheet PDF error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Import a plan document to takeoff workspace
  app.post("/api/projects/:projectId/takeoff/import-plan", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { documentId } = req.body;

      if (!documentId) {
        res.status(400).json({ error: "Document ID is required" });
        return;
      }

      const { planDocuments, projectPlans, takeoffSheets } = await import("@shared/schema");

      // Get the document
      const [document] = await db
        .select()
        .from(planDocuments)
        .where(eq(planDocuments.id, documentId))
        .limit(1);

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      if (document.projectId !== projectId) {
        res.status(403).json({ error: "Document does not belong to this project" });
        return;
      }

      // Check if this document is already imported by checking if a plan exists with this documentId
      const [existingPlan] = await db
        .select()
        .from(projectPlans)
        .where(and(
          eq(projectPlans.projectId, projectId),
          eq(projectPlans.documentId, documentId)
        ))
        .limit(1);

      if (existingPlan) {
        res.status(400).json({ error: "This document is already imported to takeoff workspace" });
        return;
      }

      // Validate PDF and get page count BEFORE creating any database records
      let pageCount = 1;
      if (!document.objectKey) {
        res.status(400).json({ error: "Document has no file attached. Please re-upload the document." });
        return;
      }

      try {
        const { ObjectStorageService } = await import("./objectStorage");
        const objectStorageService = new ObjectStorageService();
        const objectFile = await objectStorageService.getObjectEntityFile(document.objectKey);
        
        // Download PDF to buffer using GCS File.download() method
        const [pdfBuffer] = await objectFile.download();
        
        // Load PDF with pdfjs-dist
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(pdfBuffer),
          useSystemFonts: true,
        });
        const pdfDoc = await loadingTask.promise;
        pageCount = pdfDoc.numPages;
      } catch (error: any) {
        console.error("Error processing PDF:", error);
        res.status(400).json({ 
          error: "Failed to process PDF file. The file may be corrupted or not a valid PDF document." 
        });
        return;
      }

      // Import plan to takeoff (sequential operations with compensating cleanup)
      // Create project plan record
      const [plan] = await db.insert(projectPlans).values({
        projectId,
        documentId: documentId,
        originalPdfUrl: document.fileUrl,
        fileName: document.fileName,
      }).returning();

      // Prepare all sheets for batch insert
      const baseSheetName = document.title || document.fileName.replace(/\.[^/.]+$/, ''); // Remove extension
      const sheetValues = [];
      
      for (let i = 0; i < pageCount; i++) {
        const sheetName = pageCount > 1 
          ? `${baseSheetName} - Page ${i + 1}`
          : baseSheetName;
        
        sheetValues.push({
          projectId,
          planId: plan.id,
          imageUrl: document.fileUrl,
          sheetIndex: i,
          sheetName,
        });
      }

      // Batch insert all sheets with compensating cleanup on failure
      let sheets;
      try {
        sheets = await db.insert(takeoffSheets).values(sheetValues).returning();
      } catch (sheetError) {
        // Compensating cleanup: delete the orphaned plan
        await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
        throw sheetError; // Re-throw to trigger outer catch
      }

      // Audit log (pass raw object, not JSON.stringify)
      await logCreate(req.user!.id, "project_plans", plan.id, {
        projectId,
        fileName: document.fileName,
        documentId,
        pageCount,
      }, req);

      res.status(201).json({ plan, sheets });
    } catch (error) {
      console.error("Error importing plan to takeoff:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Upload a plan PDF and create sheets
  app.post("/api/projects/:projectId/takeoff/plans", requireAuth, requireRole("ADMIN", "MANAGER", "ESTIMATOR"), async (req: AuthRequest, res) => {
    try {
      const { projectId } = req.params;
      const { fileUrl, fileName } = req.body;

      if (!fileUrl || !fileName) {
        res.status(400).json({ error: "File URL and name are required" });
        return;
      }

      const { projectPlans, takeoffSheets, insertProjectPlanSchema, insertTakeoffSheetSchema } = await import("@shared/schema");

      // Upload plan (sequential operations with compensating cleanup)
      // Create project plan record
      const [plan] = await db.insert(projectPlans).values({
        projectId,
        originalPdfUrl: fileUrl,
        fileName,
      }).returning();

      // TODO: In a production system, you would use a PDF processing service here
      // For now, we'll create a single sheet placeholder
      // The frontend will handle PDF rendering with pdf.js
      let sheet;
      try {
        [sheet] = await db.insert(takeoffSheets).values({
          projectId,
          planId: plan.id,
          imageUrl: fileUrl, // Using PDF URL as placeholder
          sheetIndex: 0,
          sheetName: fileName,
        }).returning();
      } catch (sheetError) {
        // Compensating cleanup: delete the orphaned plan
        await db.delete(projectPlans).where(eq(projectPlans.id, plan.id));
        throw sheetError; // Re-throw to trigger outer catch
      }

      // Audit log
      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "project_plan",
        entityId: plan.id,
        newValue: `Uploaded plan: ${fileName}`,
      }, req);

      res.status(201).json({ plan, sheets: [sheet] });
    } catch (error) {
      console.error("Error uploading plan:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get measurements for a sheet
  app.get("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffMeasurements } = await import("@shared/schema");

      const measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.sheetId, sheetId))
        .orderBy(takeoffMeasurements.createdAt);

      // Parse points JSON string to array for frontend
      const parsedMeasurements = measurements.map(m => ({
        ...m,
        points: JSON.parse(m.points),
      }));

      res.json(parsedMeasurements);
    } catch (error) {
      console.error("Error fetching measurements:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new measurement
  app.post("/api/takeoff/sheets/:sheetId/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { sheetId } = req.params;
      const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      const validated = insertTakeoffMeasurementSchema.parse({
        ...sanitizedBody,
        sheetId,
      });

      const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();

      res.status(201).json(measurement);
    } catch (error: any) {
      console.error("Error creating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update a measurement
  app.patch("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { takeoffMeasurements, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      const validated = insertTakeoffMeasurementSchema.partial().parse(sanitizedBody);

      const [updated] = await db
        .update(takeoffMeasurements)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(takeoffMeasurements.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Measurement not found" });
        return;
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Create a new measurement (with sheetId in body)
  app.post("/api/takeoff/measurements", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { takeoffMeasurements, takeoffSheets, projects, crewProjectAssignments, crewMembers, insertTakeoffMeasurementSchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        label: req.body.label ? sanitizeShortText(req.body.label) : undefined,
      };

      // Convert points array to JSON string if it's an array
      const bodyWithStringifiedPoints = {
        ...sanitizedBody,
        points: Array.isArray(sanitizedBody.points) ? JSON.stringify(sanitizedBody.points) : sanitizedBody.points,
      };

      const validated = insertTakeoffMeasurementSchema.parse(bodyWithStringifiedPoints);

      // Validate that the sheet exists and belongs to a valid project
      const sheetWithProject = await db
        .select({
          sheetId: takeoffSheets.id,
          projectId: takeoffSheets.projectId,
          projectCode: projects.code,
        })
        .from(takeoffSheets)
        .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
        .where(eq(takeoffSheets.id, validated.sheetId))
        .limit(1);

      if (!sheetWithProject || sheetWithProject.length === 0) {
        res.status(404).json({ error: "Sheet not found or does not belong to a valid project" });
        return;
      }

      // Authorization check: Only ADMIN/MANAGER or users assigned to the project can create measurements
      const userRole = req.user!.role;
      if (userRole !== "ADMIN" && userRole !== "MANAGER") {
        // Check if user is assigned to this project via crew assignments
        const userAssignment = await db
          .select({ id: crewProjectAssignments.id })
          .from(crewProjectAssignments)
          .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
          .where(
            and(
              eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
              eq(crewMembers.userId, req.user!.id)
            )
          )
          .limit(1);

        if (!userAssignment || userAssignment.length === 0) {
          res.status(403).json({ error: "You do not have access to this project" });
          return;
        }
      }

      const [measurement] = await db.insert(takeoffMeasurements).values(validated).returning();

      res.status(201).json(measurement);
    } catch (error: any) {
      console.error("Error creating measurement:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid measurement data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete a measurement
  app.delete("/api/takeoff/measurements/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { takeoffMeasurements } = await import("@shared/schema");

      const [deleted] = await db
        .delete(takeoffMeasurements)
        .where(eq(takeoffMeasurements.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Measurement not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting measurement:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update sheet calibration
  app.patch("/api/takeoff/sheets/:id/calibration", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { scalePxPerFoot, units } = req.body;
      const { takeoffSheets, projects, crewProjectAssignments, crewMembers } = await import("@shared/schema");

      if (!scalePxPerFoot || !Number.isFinite(scalePxPerFoot) || scalePxPerFoot <= 0) {
        res.status(400).json({ error: "Valid scale is required" });
        return;
      }

      // Validate that the sheet exists and belongs to a valid project
      const sheetWithProject = await db
        .select({
          sheetId: takeoffSheets.id,
          projectId: takeoffSheets.projectId,
        })
        .from(takeoffSheets)
        .innerJoin(projects, eq(takeoffSheets.projectId, projects.id))
        .where(eq(takeoffSheets.id, id))
        .limit(1);

      if (!sheetWithProject || sheetWithProject.length === 0) {
        res.status(404).json({ error: "Sheet not found or does not belong to a valid project" });
        return;
      }

      // Authorization check: Only ADMIN/MANAGER or users assigned to the project can calibrate
      const userRole = req.user!.role;
      if (userRole !== "ADMIN" && userRole !== "MANAGER") {
        // Check if user is assigned to this project via crew assignments
        const userAssignment = await db
          .select({ id: crewProjectAssignments.id })
          .from(crewProjectAssignments)
          .innerJoin(crewMembers, eq(crewProjectAssignments.crewId, crewMembers.crewId))
          .where(
            and(
              eq(crewProjectAssignments.projectId, sheetWithProject[0].projectId),
              eq(crewMembers.userId, req.user!.id)
            )
          )
          .limit(1);

        if (!userAssignment || userAssignment.length === 0) {
          res.status(403).json({ error: "You do not have access to this project" });
          return;
        }
      }

      // Update the calibration
      const [updated] = await db
        .update(takeoffSheets)
        .set({ 
          scalePxPerFoot, 
          units: units || "ft",
          updatedAt: new Date() 
        })
        .where(eq(takeoffSheets.id, id))
        .returning();

      res.json(updated);
    } catch (error) {
      console.error("Error updating calibration:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // QUANTITY CATEGORY ROUTES
  // ====================

  // Get all quantity categories for a project
  app.get("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;
      const { quantityCategories } = await import("@shared/schema");

      // Get the project to find its internal ID
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const categories = await db
        .select()
        .from(quantityCategories)
        .where(eq(quantityCategories.projectId, project.id))
        .orderBy(quantityCategories.displayOrder);

      res.json(categories);
    } catch (error) {
      console.error("Error fetching quantity categories:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new quantity category
  app.post("/api/projects/:code/quantity-categories", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { code } = req.params;
      const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

      // Get the project to find its internal ID
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.code, code))
        .limit(1);

      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: sanitizeShortText(req.body.name),
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validated = insertQuantityCategorySchema.parse({
        projectId: project.id,  // Use the internal UUID, not the code
        ...sanitizedBody,
      });

      const [category] = await db
        .insert(quantityCategories)
        .values(validated)
        .returning();

      res.status(201).json(category);
    } catch (error: any) {
      console.error("Error creating quantity category:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid category data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Update a quantity category
  app.patch("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { quantityCategories, insertQuantityCategorySchema } = await import("@shared/schema");

      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        name: req.body.name ? sanitizeShortText(req.body.name) : undefined,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validated = insertQuantityCategorySchema.partial().parse(sanitizedBody);

      const [updated] = await db
        .update(quantityCategories)
        .set({ ...validated, updatedAt: new Date() })
        .where(eq(quantityCategories.id, id))
        .returning();

      if (!updated) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      res.json(updated);
    } catch (error: any) {
      console.error("Error updating quantity category:", error);
      if (error.name === "ZodError") {
        res.status(400).json({ error: "Invalid category data", details: error.errors });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  // Delete a quantity category
  app.delete("/api/quantity-categories/:id", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { id } = req.params;
      const { quantityCategories } = await import("@shared/schema");

      const [deleted] = await db
        .delete(quantityCategories)
        .where(eq(quantityCategories.id, id))
        .returning();

      if (!deleted) {
        res.status(404).json({ error: "Category not found" });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting quantity category:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

============================================================
==== FILE END: server/routes.ts (TAKEOFF + ESTIMATING ROUTES) ====
============================================================


============================================================
==== SCOPE ITEM BACKEND ROUTES ====
============================================================

      if (req.user!.id !== req.params.userId && 
          req.user!.role !== "ADMIN" && 
          req.user!.role !== "MANAGER") {
        res.status(403).json({ error: "Forbidden" });
        return;
      }

      const permissions = await db
        .select()
        .from(filePermissions)
        .where(eq(filePermissions.userId, req.params.userId))
        .orderBy(desc(filePermissions.grantedAt));

      res.json(permissions);
    } catch (error) {
      console.error("Get user file permissions error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ====================
  // Change Orders Routes
  // ====================

  // Get change orders for a project
  app.get("/api/projects/:code/change-orders", requireAuth, async (req: AuthRequest, res) => {
    try {
      const [project] = await db.select().from(projects).where(eq(projects.code, req.params.code)).limit(1);
      
      if (!project) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const orders = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.projectId, project.id))
        .orderBy(desc(changeOrders.createdAt));

      res.json(orders);
    } catch (error) {
      console.error("Get change orders error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create change order (Admin/Manager/Superintendent)
  app.post("/api/change-orders", requireAuth, requireRole("ADMIN", "MANAGER", "SUPERINTENDENT"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        description: sanitizeText(req.body.description),
      };

      const validationResult = insertChangeOrderSchema.extend({
        requestedById: z.string().optional(),
      }).safeParse({
        ...sanitizedBody,
        requestedById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Validate change order amount (allows positive additions or negative deductions)
      const amountCheck = validateChangeOrderAmount(validationResult.data.amount, "Change order amount");
      if (!amountCheck.valid) {
        res.status(400).json({ error: amountCheck.error });
        return;
      }

      // BUSINESS VALIDATION: Validate JSON fields and normalize empty strings to null
      if (validationResult.data.attachmentsJson !== null && validationResult.data.attachmentsJson !== undefined) {
        const jsonCheck = validateJSONField(validationResult.data.attachmentsJson, "Attachments JSON");
        if (!jsonCheck.valid) {
          res.status(400).json({ error: jsonCheck.error });
          return;
        }
        // Normalize empty strings to null
        if (validationResult.data.attachmentsJson === "" || jsonCheck.parsed === null) {
          validationResult.data.attachmentsJson = null;
        }
      }

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, requestedById: req.user!.id };
      const [newOrder] = await db.insert(changeOrders).values([insertData]).returning();
      
      // Create notification for managers/admins about pending change order
      const adminsAndManagers = await db
        .select()
        .from(users)
        .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
      
      const notificationsToCreate = adminsAndManagers.map(user => ({
        userId: user.id,
        type: "CHANGE_ORDER_PENDING" as const,
        title: "New Change Order Pending",
        message: `Change order ${newOrder.changeOrderNumber} requires approval`,
        relatedEntityId: newOrder.id,
        relatedEntityType: "changeOrder",
      }));

      if (notificationsToCreate.length > 0) {
        await db.insert(notifications).values(notificationsToCreate);
      }

      res.status(201).json(newOrder);
    } catch (error: any) {
      console.error("Create change order error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update change order schema
  const updateChangeOrderSchema = insertChangeOrderSchema.omit({ requestedById: true }).partial();

  // Update change order (Admin/Manager only)
  app.patch("/api/change-orders/:id", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = updateChangeOrderSchema.safeParse(sanitizedBody);
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // BUSINESS VALIDATION: Validate change order amount if being updated (allows positive additions or negative deductions)
      if (validationResult.data.amount !== undefined && validationResult.data.amount !== null) {
        const amountCheck = validateChangeOrderAmount(validationResult.data.amount, "Change order amount");
        if (!amountCheck.valid) {
          res.status(400).json({ error: amountCheck.error });
          return;
        }
      }

      const updateData: any = { ...validationResult.data, updatedAt: new Date() };
      
      const [updatedOrder] = await db
        .update(changeOrders)
        .set(updateData)
        .where(eq(changeOrders.id, req.params.id))
        .returning();

      if (!updatedOrder) {
        res.status(404).json({ error: "Change order not found" });
        return;
      }

      res.json(updatedOrder);
    } catch (error: any) {
      console.error("Update change order error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve/reject endpoints moved to changeOrderRoutes.ts for state machine logic

  // ====================
  // Calendar Events Routes
  // ====================

  // Get all calendar events
  app.get("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const { startDate, endDate, eventType } = req.query;
      
      let query = db.select().from(calendarEvents);
      
      const conditions = [];
      if (startDate) {
        conditions.push(sql`${calendarEvents.startDate} >= ${startDate as string}`);
      }
      if (endDate) {
        conditions.push(sql`${calendarEvents.endDate} <= ${endDate as string}`);
      }
      if (eventType) {
        conditions.push(eq(calendarEvents.eventType, eventType as any));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as any;
      }
      
      const events = await query.orderBy(calendarEvents.startDate);

      res.json(events);
    } catch (error) {
      console.error("Get calendar events error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get user's calendar events
  app.get("/api/calendar/my-events", requireAuth, async (req: AuthRequest, res) => {
    try {
      const events = await db
        .select()
        .from(calendarEvents)
        .where(eq(calendarEvents.userId, req.user!.id))
        .orderBy(calendarEvents.startDate);

      res.json(events);
    } catch (error) {
      console.error("Get user calendar events error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create calendar event (All authenticated users)
  app.post("/api/calendar/events", requireAuth, async (req: AuthRequest, res) => {
    try {
      // SECURITY: Sanitize text inputs for data integrity
      const sanitizedBody = {
        ...req.body,
        title: sanitizeShortText(req.body.title),
        description: req.body.description ? sanitizeText(req.body.description) : undefined,
      };

      const validationResult = insertCalendarEventSchema.extend({
        createdById: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date().optional(),
      }).safeParse({
        ...sanitizedBody,
        createdById: req.user!.id,
      });
      
      if (!validationResult.success) {
        res.status(400).json({ error: "Invalid input", details: validationResult.error.errors });
        return;
      }

      // Ensure required field is set (TypeScript safety)
      const insertData = { ...validationResult.data, createdById: req.user!.id };
      const [newEvent] = await db.insert(calendarEvents).values([insertData]).returning();
      
      // Create notification for managers if it's a time-off request
      if (newEvent.eventType === "TIME_OFF_REQUEST") {
        const adminsAndManagers = await db
          .select()
          .from(users)
          .where(sql`${users.role} IN ('ADMIN', 'MANAGER')`);
        
        const notificationsToCreate = adminsAndManagers.map(user => ({
          userId: user.id,
          type: "TIME_OFF_REQUEST" as const,
          title: "Time Off Request",
          message: `${req.user!.firstName} ${req.user!.lastName} requested time off: ${newEvent.title}`,
          relatedEntityId: newEvent.id,
          relatedEntityType: "calendarEvent",
        }));

        if (notificationsToCreate.length > 0) {
          await db.insert(notifications).values(notificationsToCreate);
        }
      }

      res.status(201).json(newEvent);
    } catch (error: any) {
      console.error("Create calendar event error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Approve time-off request (Admin/Manager only)
  app.post("/api/calendar/events/:id/approve", requireAuth, requireRole("ADMIN", "MANAGER"), async (req: AuthRequest, res) => {
    try {
      // Approve time-off request (sequential operations - Neon HTTP driver doesn't support transactions)
      const [event] = await db
        .update(calendarEvents)
        .set({
          eventType: "TIME_OFF_APPROVED",
          approvedById: req.user!.id,
          approvedAt: new Date(),
        })
        .where(eq(calendarEvents.id, req.params.id))
        .returning();

      if (!event) {
        res.status(404).json({ error: "Calendar event not found" });
        return;
      }

      // Notify the requester
      if (event.userId) {
        await db.insert(notifications).values([{
          userId: event.userId,
          type: "GENERAL",
          title: "Time Off Approved",
          message: `Your time off request has been approved: ${event.title}`,

============================================================
==== FILE END: SCOPE ITEM ROUTES ====
============================================================


## TECHNICAL DOCUMENTATION

### CALIBRATION SYSTEM
- **Manual Calibration**: Two-point system - user clicks two known points, enters real-world distance
- **Validation**: Minimum distance thresholds (0.5ft or 0.15m) prevent unrealistic scales
- **Preset Scales**: Common architectural (1/16"=1'-0" to 3"=1'-0"), civil (1"=10' to 1"=100'), structural scales at 96 DPI
- **Storage**: scalePxPerFoot field in takeoffSheets table

### PDF PROCESSING
- **Validation**: pdfjs-dist validates PDFs before database insertion (server-side)
- **Streaming**: GCS-backed presigned URLs with 1-hour cache, authorization via crew assignments
- **Multi-page**: Automatic sheet creation per page with sheetIndex tracking
- **Rendering**: Frontend uses pdfjs-dist with canvas rendering at 1.5x scale

### AUTHORIZATION PATTERN
- **Project-level**: Non-admin users validated via crewProjectAssignments + crewMembers tables
- **Document-level**: filePermissions table for explicit access grants
- **Role-based**: ADMIN/MANAGER have unrestricted access

### MEASUREMENT TYPES
- LINEAR: Distance in linear feet (LF)
- AREA: Surface area in square feet (SF)
- VOLUME: Cubic volume in cubic yards (CY) - requires depthInches field
- COUNT: Simple marker count
- NOTE: Text annotations with coordinates

### QUANTITY CATEGORIES
- Color-coded organization system for measurements
- Auto-selection after creation for immediate use
- Display order for custom sorting
- Linked to measurements via categoryId foreign key

### BILLING WORKFLOW
- Field workers record quantities with NOT_READY status
- Superintendents verify and mark READY_TO_BILL → triggers notification to office
- Office Managers update to BILLED → auto-fills billedDate and billedById
- Strict RBAC: only SUPERINTENDENT, OFFICE_MANAGER, ADMIN, MANAGER can update status

### DATABASE TABLES (10+ Takeoff/Estimating Tables)
1. **projectPlans**: PDF documents imported to takeoff workspace
2. **takeoffSheets**: Individual pages with sheetIndex, scalePxPerFoot, units
3. **takeoffMeasurements**: Drawings with points (JSON), computed quantities, categoryId
4. **quantityCategories**: Color-coded grouping with displayOrder
5. **planDocuments**: Uploaded PDFs with objectKey references
6. **projectSpecs**: Project specifications
7. **projectSpecIndex**: Searchable spec index
8. **estimateSettings**: Project-level estimate configuration
9. **estimateCrews**: Labor crew composition
10. **estimateLineItems**: Detailed estimate line items
11. **estimateVersions**: Version control for estimates
12. **estimateVendorQuotes**: Vendor pricing
13. **estimateHistory**: Audit trail

---

