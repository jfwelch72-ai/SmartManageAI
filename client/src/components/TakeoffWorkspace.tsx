import { useState, useRef, useEffect } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  MousePointer2, Hand, ZoomIn, Ruler, Square, Circle as CircleIcon, 
  Box, MapPin, StickyNote, Upload, Trash2, Save, Download, Sparkles 
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { TakeoffSheet, TakeoffMeasurement } from "@shared/schema";

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
  const { toast } = useToast();
  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch sheets for this project
  const { data: sheets = [], isLoading: sheetsLoading } = useQuery<TakeoffSheet[]>({
    queryKey: ["/api/projects", projectId, "takeoff", "sheets"],
  });

  // Fetch measurements for selected sheet
  const { data: measurements = [], isLoading: measurementsLoading } = useQuery<TakeoffMeasurement[]>({
    queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"],
    enabled: !!selectedSheet,
  });

  const currentSheet = sheets.find(s => s.id === selectedSheet);

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
    if (activeTool === "calibrate") {
      const stage = e.target.getStage();
      const point = stage.getPointerPosition();
      
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

  return (
    <div className="flex h-screen">
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
        <div className="h-14 bg-card border-b px-4 flex items-center gap-4">
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
              onWheel={handleWheel}
              draggable={activeTool === "pan"}
            >
              <Layer>
                {/* Sheet image would go here */}
                <Text text="Canvas: Plan will render here" x={20} y={20} fontSize={16} />
                
                {/* Calibration points */}
                {calibrationPoints.map((point, i) => (
                  <Circle
                    key={i}
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
                        className="p-3 rounded-md bg-muted hover-elevate cursor-pointer"
                        data-testid={`measurement-item-${m.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">{m.label || "Untitled"}</span>
                          <Badge variant="outline">{m.type}</Badge>
                        </div>
                        {(m.computedLengthFt || m.computedAreaFt2 || m.computedVolumeCy) && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {m.type === "LINEAR" && m.computedLengthFt 
                              ? `${m.computedLengthFt.toFixed(2)} LF`
                              : m.type === "AREA" && m.computedAreaFt2
                              ? `${m.computedAreaFt2.toFixed(2)} SF`
                              : m.type === "VOLUME" && m.computedVolumeCy
                              ? `${m.computedVolumeCy.toFixed(2)} CY`
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
    </div>
  );
}
