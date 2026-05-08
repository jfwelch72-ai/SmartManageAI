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
import { X, Building2, Truck, MapPin, CheckCircle2, Tag, DollarSign, Ruler, Square, Box, GitBranch, FileText, Pencil } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  /**
   * Task #2587 — Base-bid vs change-order scope tagging. When provided,
   * the panel renders the same BASE/CO chip the measurement table row
   * shows and a small dropdown that moves the measurement to base bid
   * or any active change order. Reuses the workspace's
   * `moveScopeMutation` (via `onMoveScope`) so the underlying
   * `POST /api/takeoff/measurements/:id/scope` call, cache
   * invalidation, and toasts stay centralized. Both props are
   * optional so embedded callers (e.g. bid-context) that have no
   * change-order list keep rendering the panel unchanged.
   */
  changeOrders?: Array<{ id: string; changeOrderNumber: string; description?: string | null; status?: string | null }>;
  onMoveScope?: (
    measurementId: string,
    payload: { scopeTag: "BASE" | "CO"; changeOrderId: string | null },
  ) => void;
  isMovingScope?: boolean;
  /**
   * Task #2657 — Live "X is editing this measurement" presence
   * surfaced from the collab WebSocket. The workspace filters the
   * per-peer focus map to peers focused on the currently-selected
   * measurement and passes the de-duped list here. Renders a small
   * cluster of avatars at the top of the panel so the user sees a
   * potential edit conflict BEFORE they start typing — instead of
   * discovering it from a failed PATCH after they hit Save.
   */
  focusedBy?: Array<{ userId: string; userName: string; userColor: string }>;
}

export function TakeoffPropertiesPanel({
  measurement,
  selectedSheet,
  onClose,
  variant = "inline",
  changeOrders,
  onMoveScope,
  isMovingScope,
  focusedBy,
}: TakeoffPropertiesPanelProps) {
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

  // Task #2587 — Scope chip + picker. Mirrors the
  // MeasurementTable row chip so users see the same BASE/CO
  // signal in both surfaces. The picker is rendered as a
  // simple Select inside the panel (no dialog needed — the
  // panel itself is the surface) with a "Base bid" entry plus
  // one entry per active change order.
  const scopeEnabled = !!onMoveScope;
  const currentScopeTag = (measurement.scopeTag ?? "BASE") as "BASE" | "CO";
  const currentChangeOrderId = measurement.changeOrderId;
  const currentCo = currentChangeOrderId
    ? (changeOrders ?? []).find((c) => c.id === currentChangeOrderId) ?? null
    : null;
  const scopeSelectValue =
    currentScopeTag === "CO" && currentChangeOrderId ? currentChangeOrderId : "__base__";

  const handleScopeChange = (value: string) => {
    if (!onMoveScope) return;
    if (value === "__base__") {
      if (currentScopeTag === "BASE") return;
      onMoveScope(measurement.id, { scopeTag: "BASE", changeOrderId: null });
    } else {
      if (currentScopeTag === "CO" && value === currentChangeOrderId) return;
      onMoveScope(measurement.id, { scopeTag: "CO", changeOrderId: value });
    }
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
      <div className="flex items-center justify-between px-3 py-2 border-b gap-2">
        <h3 className="text-sm font-semibold">Properties</h3>
        <div className="flex items-center gap-2">
          {/* Task #2657 — Live "X is editing this measurement" presence
           *  badge. Renders only when at least one peer has the same
           *  measurement focused. Designed to mirror the look of the
           *  workspace-level collaborator avatars so users recognize
           *  the metaphor instantly. */}
          {focusedBy && focusedBy.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 px-1.5 py-0.5"
                  data-testid="indicator-measurement-focused-by"
                >
                  <Pencil className="w-3 h-3" />
                  <div className="flex items-center -space-x-1.5">
                    {focusedBy.slice(0, 3).map((u) => (
                      <div
                        key={u.userId}
                        className="w-5 h-5 rounded-full border border-background flex items-center justify-center text-[9px] font-bold text-white"
                        style={{ backgroundColor: u.userColor }}
                        data-testid={`avatar-measurement-focused-by-${u.userId}`}
                      >
                        {u.userName.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)}
                      </div>
                    ))}
                    {focusedBy.length > 3 && (
                      <div className="w-5 h-5 rounded-full border border-background bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground">
                        +{focusedBy.length - 3}
                      </div>
                    )}
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                {focusedBy.length === 1 ? (
                  <p>{focusedBy[0].userName} is editing this measurement</p>
                ) : (
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {focusedBy.length} people are editing this measurement
                    </p>
                    {focusedBy.map((u) => (
                      <p key={u.userId} className="text-xs text-muted-foreground">
                        {u.userName}
                      </p>
                    ))}
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          )}
          {!isDrawer && (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={onClose} data-testid="button-close-properties">
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: measurement.color || "#3b82f6" }} />
            <p className="text-sm font-medium truncate" data-testid="text-measurement-label">{measurement.label}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <Badge variant="outline" className="text-xs py-0 h-5" data-testid="badge-measurement-type">
              {measurement.type}
            </Badge>
            <span data-testid="text-measurement-quantity">{getMeasurementQuantity()}</span>
            {scopeEnabled && (
              currentScopeTag === "CO" ? (
                <span
                  className="inline-flex items-center gap-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-300 text-[10px] font-medium px-1.5 py-0.5"
                  data-testid="badge-properties-scope"
                  data-scope="CO"
                  title={
                    currentCo?.description
                      ? `CO ${currentCo.changeOrderNumber} — ${currentCo.description}`
                      : currentCo
                        ? `CO ${currentCo.changeOrderNumber}`
                        : "Change order"
                  }
                >
                  <GitBranch className="w-3 h-3" />
                  {currentCo ? `CO ${currentCo.changeOrderNumber}` : "CO"}
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-0.5 rounded bg-slate-500/15 text-slate-700 dark:text-slate-300 text-[10px] font-medium px-1.5 py-0.5"
                  data-testid="badge-properties-scope"
                  data-scope="BASE"
                  title="Base bid scope"
                >
                  <FileText className="w-3 h-3" />
                  Base
                </span>
              )
            )}
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
          {scopeEnabled && (
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <GitBranch className="w-3.5 h-3.5" />
                Scope
              </Label>
              <Select
                value={scopeSelectValue}
                onValueChange={handleScopeChange}
                disabled={isMovingScope}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="select-properties-scope">
                  <SelectValue placeholder="Select scope" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__base__" data-testid="option-properties-scope-base">
                    Base bid
                  </SelectItem>
                  {(changeOrders ?? []).length === 0 ? (
                    <SelectItem value="__no_cos__" disabled>
                      No change orders on this project
                    </SelectItem>
                  ) : (
                    (changeOrders ?? []).map((co) => (
                      <SelectItem
                        key={co.id}
                        value={co.id}
                        data-testid={`option-properties-scope-co-${co.id}`}
                      >
                        CO {co.changeOrderNumber}
                        {co.description ? ` — ${co.description.slice(0, 40)}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
          )}

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
            <Select value={installationStatus} onValueChange={(v: string) => setInstallationStatus(v as typeof installationStatus)}>
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
