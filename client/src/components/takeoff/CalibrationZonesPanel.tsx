// Task #2780 — Calibration zones panel for multi-region calibration.
// Shows zones for the current sheet with inline rename + scale editing and delete.
// Task #2785 — Accepts `activeZoneId` to highlight the zone the cursor is currently in.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Trash2, MapPin, ChevronDown, ChevronUp, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface CalibrationZone {
  id: string;
  sheet_id: string;
  name: string;
  polygon_points: Array<{ x: number; y: number }>;
  px_per_foot: number;
  created_at: string;
}

interface CalibrationZonesPanelProps {
  sheetId: string | null | undefined;
  className?: string;
  /** Task #2781 — ID of the zone currently selected on the canvas. */
  selectedZoneId?: string | null;
  /** Task #2781 — Called when a zone row is clicked so the canvas can highlight it. */
  onSelectZone?: (id: string | null) => void;
  /**
   * Task #2785 — ID of the zone the cursor is currently inside. The panel
   * highlights this row with a live "cursor here" indicator so the estimator
   * can see which zone scale is being applied while drawing. Unlike
   * `selectedZoneId` (which is click-driven and persistent), `activeZoneId`
   * follows the cursor in real time and updates on every mouse move.
   */
  activeZoneId?: string | null;
}

interface EditState {
  name: string;
  pxPerFoot: string;
}

function ZoneRow({
  zone,
  sheetId,
  onDelete,
  isDeleting,
  isSelected,
  isActive,
  onSelect,
}: {
  zone: CalibrationZone;
  sheetId: string;
  onDelete: (id: string) => void;
  isDeleting: boolean;
  isSelected?: boolean;
  /** Task #2785 — true when the cursor is currently inside this zone's polygon. */
  isActive?: boolean;
  onSelect?: (id: string | null) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editState, setEditState] = useState<EditState>({
    name: zone.name,
    pxPerFoot: zone.px_per_foot.toFixed(4),
  });

  const patchMutation = useMutation({
    mutationFn: (data: { name: string; px_per_foot: number }) =>
      apiRequest("PATCH", `/api/takeoff/calibration-zones/${zone.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/takeoff/sheets/${sheetId}/calibration-zones`],
      });
      toast({ title: "Zone updated" });
      setEditing(false);
    },
    onError: () => {
      toast({ title: "Failed to update zone", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const pxPerFoot = parseFloat(editState.pxPerFoot);
    if (!editState.name.trim()) {
      toast({ title: "Name is required", variant: "destructive" });
      return;
    }
    if (!Number.isFinite(pxPerFoot) || pxPerFoot <= 0) {
      toast({ title: "px/ft must be a positive number", variant: "destructive" });
      return;
    }
    patchMutation.mutate({ name: editState.name.trim(), px_per_foot: pxPerFoot });
  };

  const handleCancel = () => {
    setEditState({ name: zone.name, pxPerFoot: zone.px_per_foot.toFixed(4) });
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className="flex flex-col gap-1 rounded px-2 py-1.5 bg-muted/30 border border-border/60"
        data-testid={`calibration-zone-edit-row-${zone.id}`}
      >
        <Input
          value={editState.name}
          onChange={e => setEditState(s => ({ ...s, name: e.target.value }))}
          className="h-6 text-xs px-2"
          placeholder="Zone name"
          data-testid={`input-zone-name-${zone.id}`}
          onKeyDown={e => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") handleCancel();
          }}
          autoFocus
        />
        <div className="flex items-center gap-1">
          <Input
            value={editState.pxPerFoot}
            onChange={e => setEditState(s => ({ ...s, pxPerFoot: e.target.value }))}
            className="h-6 text-xs px-2 flex-1"
            placeholder="px/ft"
            data-testid={`input-zone-pxperfoot-${zone.id}`}
            onKeyDown={e => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">px/ft</span>
        </div>
        <div className="flex items-center gap-1 justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={handleCancel}
            disabled={patchMutation.isPending}
            data-testid={`button-cancel-zone-edit-${zone.id}`}
          >
            <X className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-green-600 hover:text-green-700"
            onClick={handleSave}
            disabled={patchMutation.isPending}
            data-testid={`button-save-zone-edit-${zone.id}`}
          >
            <Check className="w-3 h-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-muted/40 group cursor-pointer",
        isSelected && "bg-cyan-50 dark:bg-cyan-950/30 ring-1 ring-cyan-400/60",
        isActive && !isSelected && "bg-cyan-50/60 dark:bg-cyan-950/20 ring-1 ring-cyan-300/40"
      )}
      data-testid={`calibration-zone-row-${zone.id}`}
      data-active-zone={isActive || undefined}
      onClick={() => !editing && onSelect?.(isSelected ? null : zone.id)}
    >
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1 min-w-0">
          <span className="font-medium truncate" data-testid={`text-zone-name-${zone.id}`}>
            {zone.name}
          </span>
          {/* Task #2785 — Live "cursor here" indicator. A small pulsing dot
              next to the zone name tells the estimator the cursor is currently
              inside this zone and that its scale is being applied. */}
          {isActive && (
            <span
              className="inline-flex items-center gap-0.5 shrink-0 text-[9px] font-semibold text-cyan-600 dark:text-cyan-400 bg-cyan-100 dark:bg-cyan-900/50 rounded px-1 py-0"
              data-testid={`badge-zone-active-${zone.id}`}
              title="Cursor is inside this zone"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse inline-block" aria-hidden="true" />
              active
            </span>
          )}
        </div>
        <span className="text-muted-foreground text-[10px]" data-testid={`text-zone-scale-${zone.id}`}>
          {zone.px_per_foot.toFixed(2)} px/ft
        </span>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setEditState({ name: zone.name, pxPerFoot: zone.px_per_foot.toFixed(4) });
            setEditing(true);
          }}
          disabled={isDeleting}
          data-testid={`button-edit-zone-${zone.id}`}
        >
          <Pencil className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-destructive hover:text-destructive"
          onClick={(e) => { e.stopPropagation(); onDelete(zone.id); }}
          disabled={isDeleting}
          data-testid={`button-delete-zone-${zone.id}`}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}

export function CalibrationZonesPanel({ sheetId, className, selectedZoneId, onSelectZone, activeZoneId }: CalibrationZonesPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);

  const { data: zones = [], isLoading } = useQuery<CalibrationZone[]>({
    queryKey: [`/api/takeoff/sheets/${sheetId}/calibration-zones`],
    enabled: !!sheetId,
  });

  const deleteMutation = useMutation({
    mutationFn: (zoneId: string) =>
      apiRequest("DELETE", `/api/takeoff/calibration-zones/${zoneId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/takeoff/sheets/${sheetId}/calibration-zones`] });
      toast({ title: "Zone deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete zone", variant: "destructive" });
    },
  });

  if (!sheetId) return null;

  return (
    <div className={cn("flex flex-col text-xs", className)}>
      <button
        className="flex items-center justify-between w-full px-3 py-2 hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed(c => !c)}
        data-testid="button-calibration-zones-toggle"
      >
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground uppercase tracking-wide text-[10px]">
          <MapPin className="w-3 h-3" />
          Calibration Zones
          {zones.length > 0 && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
              {zones.length}
            </Badge>
          )}
        </div>
        {collapsed ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronUp className="w-3 h-3 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <>
          <Separator />
          <div className="flex flex-col gap-1 px-3 py-2 min-h-0">
            {isLoading && (
              <div className="text-muted-foreground text-[10px] py-1">Loading…</div>
            )}
            {!isLoading && zones.length === 0 && (
              <div className="text-muted-foreground text-[10px] py-1">
                No zones yet. Calibrate a region, then click "Save as Zone" to create one.
              </div>
            )}
            {zones.map(zone => (
              <ZoneRow
                key={zone.id}
                zone={zone}
                sheetId={sheetId}
                onDelete={id => deleteMutation.mutate(id)}
                isDeleting={deleteMutation.isPending}
                isSelected={selectedZoneId === zone.id}
                isActive={activeZoneId === zone.id}
                onSelect={onSelectZone}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
