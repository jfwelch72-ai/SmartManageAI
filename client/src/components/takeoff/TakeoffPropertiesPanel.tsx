import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { X, Building2, Truck, MapPin, CheckCircle2, Tag, DollarSign, Ruler, Square, Box } from "lucide-react";
import type { TakeoffMeasurement } from "@shared/schema";

interface TakeoffPropertiesPanelProps {
  measurement: TakeoffMeasurement;
  selectedSheet: string | null;
  onClose: () => void;
  /** Task #2312 — Layout variant. `inline` (default) renders the
   *  pinned right-side panel used at lg:+ desktop. `drawer` strips
   *  the fixed `w-72`/`border-l` so the panel content fills a
   *  Sheet wrapper full-width on tablet/phone, and hides the
   *  internal close-X (Sheet provides its own). */
  variant?: "inline" | "drawer";
}

export function TakeoffPropertiesPanel({ measurement, selectedSheet, onClose, variant = "inline" }: TakeoffPropertiesPanelProps) {
  const { toast } = useToast();
  const [subcontractorId, setSubcontractorId] = useState(measurement.subcontractorId || "");
  const [supplierId, setSupplierId] = useState(measurement.supplierId || "");
  const [locationTag, setLocationTag] = useState(measurement.locationTag || "");
  const [installationStatus, setInstallationStatus] = useState(measurement.installationStatus || "NOT_STARTED");
  const [costCodeId, setCostCodeId] = useState(measurement.costCodeId || "");

  useEffect(() => {
    setSubcontractorId(measurement.subcontractorId || "");
    setSupplierId(measurement.supplierId || "");
    setLocationTag(measurement.locationTag || "");
    setInstallationStatus(measurement.installationStatus || "NOT_STARTED");
    setCostCodeId(measurement.costCodeId || "");
  }, [measurement.id]);

  const { data: subcontractors = [] } = useQuery<{ id: string; companyName: string }[]>({
    queryKey: ["/api/subcontractors"],
  });

  interface MeasurementPropertyUpdate {
    subcontractorId?: string | null;
    supplierId?: string | null;
    locationTag?: string | null;
    installationStatus?: string;
    costCodeId?: string | null;
  }

  const updatePropertiesMutation = useMutation({
    mutationFn: async (data: MeasurementPropertyUpdate) => {
      const res = await apiRequest("PATCH", `/api/takeoff/measurements/${measurement.id}/properties`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/takeoff/sheets", selectedSheet, "measurements"] });
      toast({ title: "Properties updated" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update properties", variant: "destructive" });
    },
  });

  const handleSave = () => {
    updatePropertiesMutation.mutate({
      subcontractorId: subcontractorId || null,
      supplierId: supplierId || null,
      locationTag: locationTag || null,
      installationStatus,
      costCodeId: costCodeId || null,
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "NOT_STARTED": return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
      case "IN_PROGRESS": return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
      case "COMPLETE": return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
      case "ON_HOLD": return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getMeasurementQuantity = () => {
    if (measurement.type === "COUNT") return `${measurement.count || 0} count`;
    if (measurement.computedLengthFt) return `${measurement.computedLengthFt.toFixed(1)} LF`;
    if (measurement.computedAreaFt2) return `${measurement.computedAreaFt2.toFixed(1)} SF`;
    if (measurement.computedVolumeCy) return `${measurement.computedVolumeCy.toFixed(2)} CY`;
    return "—";
  };

  const isDrawer = variant === "drawer";
  return (
    <div
      className={
        isDrawer
          ? "bg-background w-full flex flex-col h-full overflow-hidden"
          : "border-l bg-background w-72 flex flex-col h-full overflow-hidden"
      }
      data-testid="properties-panel"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <h3 className="text-sm font-semibold">Properties</h3>
        {!isDrawer && (
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} data-testid="button-close-properties">
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: measurement.color || "#3b82f6" }} />
            <p className="text-sm font-medium truncate" data-testid="text-measurement-label">{measurement.label}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" className="text-xs py-0 h-5" data-testid="badge-measurement-type">
              {measurement.type}
            </Badge>
            <span data-testid="text-measurement-quantity">{getMeasurementQuantity()}</span>
          </div>
        </div>

        <Separator />

        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Dimensions</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {measurement.computedLengthFt !== null && measurement.computedLengthFt !== undefined && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Length:</span>
                <span className="font-medium">{measurement.computedLengthFt.toFixed(1)} ft</span>
              </div>
            )}
            {measurement.computedAreaFt2 !== null && measurement.computedAreaFt2 !== undefined && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Area:</span>
                <span className="font-medium">{measurement.computedAreaFt2.toFixed(1)} sf</span>
              </div>
            )}
            {measurement.computedVolumeCy !== null && measurement.computedVolumeCy !== undefined && (
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Volume:</span>
                <span className="font-medium">{measurement.computedVolumeCy.toFixed(2)} cy</span>
              </div>
            )}
            {measurement.unitCost !== null && measurement.unitCost !== undefined && (
              <div className="flex items-center gap-1">
                <DollarSign className="w-3 h-3 text-muted-foreground" />
                <span className="font-medium">${measurement.unitCost.toFixed(2)}/unit</span>
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              Cost Code
            </Label>
            <Input
              value={costCodeId}
              onChange={(e) => setCostCodeId(e.target.value)}
              placeholder="e.g. 03-100"
              className="h-8 text-xs"
              data-testid="input-cost-code"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              Subcontractor
            </Label>
            <Select value={subcontractorId || "__none__"} onValueChange={(v) => setSubcontractorId(v === "__none__" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-subcontractor">
                <SelectValue placeholder="Select subcontractor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {subcontractors.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.companyName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Truck className="w-3.5 h-3.5" />
              Supplier
            </Label>
            <Input
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              placeholder="Supplier name or ID"
              className="h-8 text-xs"
              data-testid="input-supplier"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              Location Tag
            </Label>
            <Input
              value={locationTag}
              onChange={(e) => setLocationTag(e.target.value)}
              placeholder="e.g. Building A, Floor 2"
              className="h-8 text-xs"
              data-testid="input-location-tag"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Installation Status
            </Label>
            <Select value={installationStatus} onValueChange={setInstallationStatus}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-installation-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                <SelectItem value="COMPLETE">Complete</SelectItem>
                <SelectItem value="ON_HOLD">On Hold</SelectItem>
              </SelectContent>
            </Select>
            <Badge className={`text-xs ${getStatusColor(installationStatus)}`} data-testid="badge-installation-status">
              {installationStatus.replace(/_/g, " ")}
            </Badge>
          </div>
        </div>

        <Separator />

        <Button
          onClick={handleSave}
          disabled={updatePropertiesMutation.isPending}
          className="w-full h-8 text-xs"
          data-testid="button-save-properties"
        >
          {updatePropertiesMutation.isPending ? "Saving..." : "Save Properties"}
        </Button>
      </div>
    </div>
  );
}
