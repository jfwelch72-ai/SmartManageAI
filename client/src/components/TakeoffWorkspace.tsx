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
  Box, MapPin, StickyNote, Upload, Trash2, Save, Download, Sparkles, Maximize, Minimize 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TakeoffSheet, TakeoffMeasurement } from "@shared/schema";
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

        // Get presigned URL for this sheet (required for security)
        const response = await fetch(`/api/takeoff/sheets/${currentSheet.id}/pdf-url`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: 'Failed to load PDF' }));
          throw new Error(error.error || 'Failed to get PDF URL');
        }
        
        const { url: pdfUrl } = await response.json();
        if (!pdfUrl) {
          throw new Error('No PDF URL available for this sheet');
        }

        // Load the PDF document
        const loadingTask = pdfjsLib.getDocument(pdfUrl);
        const pdf = await loadingTask.promise;

        // Get the first page
        const page = await pdf.getPage(1);

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
          viewport: viewport
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
    </div>
  );
}
