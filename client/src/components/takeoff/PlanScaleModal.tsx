import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sparkles, Check, Search } from "lucide-react";
import { COMMON_SCALES } from "./types";
import { cn } from "@/lib/utils";

interface PlanScaleModalProps {
  open: boolean;
  onClose: () => void;
  onApplyScale: (pxPerFoot: number, units: string, label: string) => void;
  currentScalePxPerFoot: number | null;
  /**
   * Task #2067 — When true, renders the dialog as a near-fullscreen sheet so
   * the standard scales list and custom-ratio inputs fit comfortably in the
   * standalone Takeoff workspace (Bluebeam-style). The default sm:max-w-lg
   * sizing is preserved when this is false so the existing embedded callers
   * keep their compact modal.
   */
  fullscreen?: boolean;
}

const RECOMMENDED_SCALE = '1/4" = 1\'-0"';

type ScaleCategory = "all" | "architectural" | "civil" | "structural";

export function PlanScaleModal({ open, onClose, onApplyScale, currentScalePxPerFoot, fullscreen = false }: PlanScaleModalProps) {
  const [activeTab, setActiveTab] = useState("standard");
  const [category, setCategory] = useState<ScaleCategory>("all");
  const [selectedScale, setSelectedScale] = useState<{ label: string; pxPerFoot: number; category: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState<"inches" | "feet">("inches");
  const [customFeet, setCustomFeet] = useState("");

  const allScales = useMemo(() => {
    const scales: Array<{ label: string; pxPerFoot: number; description: string; category: string }> = [];
    for (const [cat, items] of Object.entries(COMMON_SCALES)) {
      for (const item of items) {
        if (!scales.find(s => s.label === item.label && s.pxPerFoot === item.pxPerFoot)) {
          scales.push({ ...item, category: cat });
        }
      }
    }
    return scales;
  }, []);

  const filteredScales = useMemo(() => {
    let scales = category === "all" ? allScales : allScales.filter(s => s.category === category);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      scales = scales.filter(s => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
    }
    return scales;
  }, [allScales, category, searchQuery]);

  const currentScaleLabel = useMemo(() => {
    if (!currentScalePxPerFoot) return null;
    const match = allScales.find(s => Math.abs(s.pxPerFoot - currentScalePxPerFoot) < 0.01);
    return match?.label || null;
  }, [currentScalePxPerFoot, allScales]);

  const handleDone = () => {
    if (activeTab === "standard" && selectedScale) {
      onApplyScale(selectedScale.pxPerFoot, "ft", selectedScale.label);
      resetAndClose();
    } else if (activeTab === "custom") {
      const drawingVal = parseFloat(customValue);
      const realVal = parseFloat(customFeet);
      if (!Number.isFinite(drawingVal) || drawingVal <= 0 || !Number.isFinite(realVal) || realVal <= 0) return;
      const drawingInches = customUnit === "inches" ? drawingVal : drawingVal * 12;
      const pxPerInch = 96;
      const pxPerFoot = (drawingInches * pxPerInch) / (realVal * 12);
      const label = `Custom: ${customValue} ${customUnit === "inches" ? 'in' : 'ft'} = ${customFeet}'`;
      onApplyScale(pxPerFoot, "ft", label);
      resetAndClose();
    }
  };

  const resetAndClose = () => {
    setSelectedScale(null);
    setSearchQuery("");
    setCustomValue("");
    setCustomFeet("");
    setActiveTab("standard");
    setCategory("all");
    onClose();
  };

  const isCurrentScale = (s: { pxPerFoot: number }) => {
    return currentScalePxPerFoot !== null && Math.abs(s.pxPerFoot - currentScalePxPerFoot) < 0.01;
  };

  // Task #2067 — In fullscreen mode the dialog covers most of the viewport so
  // the standards list and calibration instructions get more room. The
  // standard-scales `<ScrollArea>` height also grows so users can browse the
  // full COMMON_SCALES list without paging.
  // Task #2206 follow-up — clamp the non-fullscreen dialog to 90% of the
  // dynamic viewport height (`dvh` so iOS Safari's URL bar doesn't push
  // the footer off-screen) and lay it out as a flex column. The standards
  // ScrollArea then takes `flex-1 min-h-0` so the Cancel / Done footer is
  // always pinned to the bottom even on small phones / iPad portrait.
  const dialogClass = fullscreen
    ? "max-w-[95vw] w-[95vw] sm:max-w-[1100px] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col"
    : "sm:max-w-lg max-h-[90dvh] p-0 gap-0 overflow-hidden flex flex-col";
  const scrollAreaHeight = fullscreen ? "h-[calc(90vh-280px)]" : "flex-1 min-h-0";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && resetAndClose()}>
      <DialogContent className={dialogClass} data-testid={fullscreen ? "dialog-plan-scale-fullscreen" : "dialog-plan-scale"}>
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle data-testid="text-plan-scale-title">Plan Scale</DialogTitle>
          <DialogDescription>
            {currentScaleLabel
              ? <>Current scale: <span className="font-medium text-foreground">{currentScaleLabel}</span></>
              : "Select a standard scale or enter a custom ratio. To calibrate from a known dimension on the plan, press T to open the inline calibration drawer."}
          </DialogDescription>
        </DialogHeader>

        {/*
          Task #2140 — The "Calibrate" tab + Start Calibration button
          previously lived in this modal. Two-point calibration has
          moved to `InlineCalibrationDrawer` (opened via T or the
          sidebar) so this modal is now strictly Standard Scales +
          Custom ratio. See the modal's DialogDescription for the
          handoff hint and the "Use Standard Scale instead" link in
          the drawer for the reverse handoff.
        */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full flex-1 min-h-0 flex flex-col">
          <div className="px-6">
            <TabsList className="w-full grid grid-cols-2">
              <TabsTrigger value="standard" data-testid="tab-standard-scales">Standard Scales</TabsTrigger>
              <TabsTrigger value="custom" data-testid="tab-custom">Custom</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="standard" className="mt-0 px-6 pb-2 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 my-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search scales..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                  data-testid="input-search-scales"
                />
              </div>
              <Select value={category} onValueChange={(v) => setCategory(v as ScaleCategory)}>
                <SelectTrigger className="w-36 h-9" data-testid="select-scale-category-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Scales</SelectItem>
                  <SelectItem value="architectural">Architectural</SelectItem>
                  <SelectItem value="civil">Civil/Site</SelectItem>
                  <SelectItem value="structural">Structural</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <ScrollArea className={scrollAreaHeight}>
              <div className="space-y-1 pr-3">
                {filteredScales.map((scale) => {
                  const isSelected = selectedScale?.label === scale.label && selectedScale?.pxPerFoot === scale.pxPerFoot;
                  const isCurrent = isCurrentScale(scale);
                  const isRecommended = scale.label === RECOMMENDED_SCALE && scale.category === "architectural";

                  return (
                    <button
                      key={`${scale.category}-${scale.label}`}
                      onClick={() => setSelectedScale(scale)}
                      className={cn(
                        "w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-left transition-colors",
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                          : "border-transparent hover:bg-muted/60",
                        isCurrent && !isSelected && "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/20"
                      )}
                      data-testid={`button-scale-${scale.category}-${scale.pxPerFoot}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                        <div className="min-w-0">
                          <span className="text-sm font-medium block">{scale.label}</span>
                          <span className="text-xs text-muted-foreground">{scale.description}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {isCurrent && (
                          <Badge variant="outline" className="text-xs border-green-300 text-green-700 dark:border-green-700 dark:text-green-400" data-testid="badge-current-scale">
                            Current
                          </Badge>
                        )}
                        {isRecommended && (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 text-xs gap-1" data-testid="badge-recommended">
                            <Sparkles className="h-3 w-3" />
                            Recommended
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
                {filteredScales.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-8">No scales match your search</p>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="custom" className="mt-0 px-6 pb-2">
            <div className="py-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter a custom scale ratio. Specify how many pixels on the drawing correspond to feet in the real world.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="custom-drawing">Drawing measurement</Label>
                  <div className="flex gap-2">
                    <Input
                      id="custom-drawing"
                      type="number"
                      placeholder="1"
                      value={customValue}
                      onChange={(e) => setCustomValue(e.target.value)}
                      data-testid="input-custom-drawing"
                    />
                    <Select value={customUnit} onValueChange={(v) => setCustomUnit(v as "inches" | "feet")}>
                      <SelectTrigger className="w-24" data-testid="select-custom-unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inches">inch</SelectItem>
                        <SelectItem value="feet">ft</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custom-real">Real-world (feet)</Label>
                  <Input
                    id="custom-real"
                    type="number"
                    placeholder="1"
                    value={customFeet}
                    onChange={(e) => setCustomFeet(e.target.value)}
                    data-testid="input-custom-feet"
                  />
                </div>
              </div>
              {customValue && customFeet && parseFloat(customValue) > 0 && parseFloat(customFeet) > 0 && (
                <div className="p-3 rounded-md bg-muted/50 text-sm">
                  Scale: <span className="font-medium">{customValue} {customUnit === "inches" ? 'inch' : 'ft'} on drawing = {customFeet} feet real-world</span>
                  <br />
                  <span className="text-xs text-muted-foreground">
                    ({((customUnit === "inches" ? parseFloat(customValue) : parseFloat(customValue) * 12) * 96 / (parseFloat(customFeet) * 12)).toFixed(2)} px/ft)
                  </span>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t bg-muted/20">
          <Button variant="outline" onClick={resetAndClose} data-testid="button-scale-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleDone}
            disabled={
              (activeTab === "standard" && !selectedScale) ||
              (activeTab === "custom" && (!customValue || !customFeet || parseFloat(customValue) <= 0 || parseFloat(customFeet) <= 0))
            }
            data-testid="button-scale-done"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
