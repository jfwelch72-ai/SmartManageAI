import { useState, useRef, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { 
  MousePointer2, Hand, ZoomIn, Ruler, Square, Circle as CircleIcon, 
  Box, MapPin, StickyNote, Upload, Trash2, Save, Download, Sparkles, Maximize, Minimize, Plus, Pencil 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
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

export default function TakeoffWorkspace({ projectId }: TakeoffWorkspaceProps) {
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
      return await apiRequest({
        url: `/api/takeoff/measurements`,
        method: "POST",
        body: data,
      });
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
      return await apiRequest({
        url: `/api/takeoff/measurements/${measurementId}`,
        method: "DELETE",
      });
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
    queryKey: ["/api/projects", projectId, "quantity-categories"],
  });

  // Mutation for creating/updating categories
  const saveCategoryMutation = useMutation({
    mutationFn: async (data: { id?: string; name: string; color: string; displayOrder?: number }) => {
      if (data.id) {
        return await apiRequest({
          url: `/api/quantity-categories/${data.id}`,
          method: "PATCH",
          body: { name: data.name, color: data.color },
        });
      } else {
        return await apiRequest({
          url: `/api/projects/${projectId}/quantity-categories`,
          method: "POST",
          body: { name: data.name, color: data.color, displayOrder: categories.length },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "quantity-categories"] });
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
      return await apiRequest({
        url: `/api/quantity-categories/${categoryId}`,
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "quantity-categories"] });
      toast({ title: "Success", description: "Category deleted" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to delete category", variant: "destructive" });
    },
  });

  const currentSheet = sheets.find(s => s.id === selectedSheet);

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

    const pixelDistance = Math.sqrt(
      Math.pow(calibrationPoints[1].x - calibrationPoints[0].x, 2) + 
      Math.pow(calibrationPoints[1].y - calibrationPoints[0].y, 2)
    );

    const scalePxPerFoot = units === "ft" 
      ? pixelDistance / parseFloat(calibrationDistance)
      : pixelDistance / (parseFloat(calibrationDistance) * 3.28084);

    try {
      await apiRequest({
        url: `/api/takeoff/sheets/${selectedSheet}/calibration`,
        method: "PATCH",
        body: { scalePxPerFoot, units },
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
      toast({ title: "Success", description: "Calibration saved" });
      setCalibrationMode("idle");
      setCalibrationPoints([]);
      setCalibrationDistance("");
      setActiveTool("select");
    } catch (error) {
      toast({ title: "Error", description: "Failed to save calibration", variant: "destructive" });
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

    try {
      await apiRequest({
        url: `/api/takeoff/sheets/${selectedSheet}/calibration`,
        method: "PATCH",
        body: { scalePxPerFoot: scale.pxPerFoot, units: "ft" },
      });
      
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "takeoff", "sheets"] });
      toast({ 
        title: "Success", 
        description: `Applied scale: ${scale.label}` 
      });
      setScaleCategory("");
      setSelectedPresetScale("");
    } catch (error) {
      toast({ title: "Error", description: "Failed to apply scale", variant: "destructive" });
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

  return (
    <div ref={workspaceRef} className="flex h-screen">
      {/* Left Toolbar */}
      <div className="w-20 bg-card border-r flex flex-col items-center py-4 gap-2">
        {TOOL_CONFIG.map((tool) => {
          const Icon = tool.icon;
          return (
            <Button
              key={tool.id}
              variant={activeTool === tool.id ? tool.color as any : "ghost"}
              size="icon"
              onClick={() => handleToolSelect(tool.id as Tool)}
              data-testid={`button-tool-${tool.id}`}
              className="toggle-elevate"
            >
              <Icon className="w-5 h-5" />
            </Button>
          );
        })}
        <Separator className="my-2 w-12" />
        <Button variant="ghost" size="icon" data-testid="button-upload-plan">
          <Upload className="w-5 h-5" />
        </Button>
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
              width={containerRef.current?.clientWidth || 800}
              height={containerRef.current?.clientHeight || 600}
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
                        stroke={isSelected ? "#3b82f6" : "#2563eb"}
                        strokeWidth={isSelected ? 5 : 3}
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
                        stroke={isSelected ? "#22c55e" : "#16a34a"}
                        strokeWidth={isSelected ? 5 : 3}
                        fill={isSelected ? "rgba(34, 197, 94, 0.2)" : "rgba(22, 163, 74, 0.1)"}
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
                        stroke={isSelected ? "#fb923c" : "#ea580c"}
                        strokeWidth={isSelected ? 5 : 3}
                        fill={isSelected ? "rgba(251, 146, 60, 0.2)" : "rgba(234, 88, 12, 0.1)"}
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
                        fill="#dc2626"
                        stroke={isSelected ? "#3b82f6" : "white"}
                        strokeWidth={isSelected ? 3 : 2}
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
                          fill="#f59e0b"
                          stroke={isSelected ? "#3b82f6" : "white"}
                          strokeWidth={isSelected ? 3 : 2}
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
                          fill={isSelected ? "#3b82f6" : "#f59e0b"}
                          fontStyle="bold"
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
                    {/* Polygon lines for area/volume tools */}
                    {(activeTool === "area" || activeTool === "volume") && drawingPoints.length >= 2 && (
                      <Line
                        points={drawingPoints.flatMap(p => [p.x, p.y])}
                        stroke={activeTool === "area" ? "#16a34a" : "#ea580c"}
                        strokeWidth={2}
                        dash={[5, 5]}
                      />
                    )}
                    
                    {/* Draw points */}
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
                      value={selectedCategoryId || ""}
                      onValueChange={(value) => setSelectedCategoryId(value || null)}
                    >
                      <SelectTrigger id="category-select" data-testid="select-category">
                        <SelectValue placeholder="Select category (optional)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">None</SelectItem>
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
                              ? `${m.computedLengthFt.toFixed(2)} LF`
                              : m.type === "AREA" && m.computedAreaFt2
                              ? `${m.computedAreaFt2.toFixed(2)} SF`
                              : m.type === "VOLUME" && m.computedVolumeCy
                              ? `${m.computedVolumeCy.toFixed(2)} CY`
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

            {/* Quantity Summary */}
            <Card>
              <CardContent className="pt-6">
                <h3 className="font-semibold mb-4">Quantity Summary</h3>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Linear:</span>
                    <span className="font-medium">
                      {measurements
                        .filter(m => m.type === "LINEAR")
                        .reduce((sum, m) => sum + (m.computedLengthFt || 0), 0)
                        .toFixed(2)} LF
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Area:</span>
                    <span className="font-medium">
                      {measurements
                        .filter(m => m.type === "AREA")
                        .reduce((sum, m) => sum + (m.computedAreaFt2 || 0), 0)
                        .toFixed(2)} SF
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Volume:</span>
                    <span className="font-medium">
                      {measurements
                        .filter(m => m.type === "VOLUME")
                        .reduce((sum, m) => sum + (m.computedVolumeCy || 0), 0)
                        .toFixed(2)} CY
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Count Items:</span>
                    <span className="font-medium">
                      {measurements.filter(m => m.type === "COUNT").length}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      </div>

      {/* Note Dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
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
      </Dialog>

      {/* Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={(open) => {
        setCategoryDialogOpen(open);
        if (!open) {
          setEditingCategory(null);
        }
      }}>
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
      </Dialog>
    </div>
  );
}
