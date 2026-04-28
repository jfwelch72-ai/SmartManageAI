// Task #2139 — Tool Chest panel UI
//
// Per-user pinned shelf of frequently-used tools, conditions, and
// assemblies. The panel slots into PanelHost and is toggled from the
// View ribbon group. Items can be:
//   - dragged onto the canvas to activate a tool/condition (canvas
//     accepts the `application/x-takeoff-chest-item+json` MIME).
//   - clicked to activate immediately.
//   - right-clicked / kebab-menu'd for rename / color / share / unpin.
//   - reordered by drag handle (local-first → server reorder).
import { useEffect, useRef, useState } from "react";
import {
  X,
  Grip,
  MoreHorizontal,
  Users,
  PackageOpen,
  Layers,
  Wrench,
  Plus,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import type { TakeoffToolChestItem, TakeoffCondition } from "@shared/schema";
import { TOOL_CONFIG } from "./types";
import {
  type ChestItemKind,
  type ChestItemDragPayload,
  partitionChestItems,
  useChestItems,
  useReorderChest,
  useUnpinFromChest,
  useUpdateChestItem,
  writeChestPayload,
} from "./toolChest";

const COLOR_PRESETS = [
  "#2563eb", "#16a34a", "#dc2626", "#f59e0b",
  "#a855f7", "#0891b2", "#db2777", "#475569",
];

interface AssemblyLite {
  id: string;
  name: string;
  description?: string | null;
}

export interface ToolChestPanelProps {
  open: boolean;
  onClose: () => void;
  currentUserId: string | null | undefined;
  /** Conditions catalogue — used to render swatch / label for chest
   *  items whose `itemId` references a saved condition. */
  conditions: TakeoffCondition[];
  /** Library assemblies catalogue — same role as conditions, for
   *  assembly-kind chest items. */
  assemblies?: AssemblyLite[];
  /** Click-to-activate handlers. The optional `options.color` carries
   *  the chest item's per-row color override so the workspace can
   *  pre-apply it to draw state before entering the tool — that's the
   *  "style pre-applied" behaviour required by Task #2139. The drag
   *  path delivers the same color via `ChestItemDragPayload.color`. */
  onActivateTool: (toolId: string, options?: { color?: string | null }) => void;
  onActivateCondition: (cond: TakeoffCondition, options?: { color?: string | null }) => void;
  onActivateAssembly?: (assemblyId: string, options?: { color?: string | null }) => void;
}

interface ResolvedChestItem {
  row: TakeoffToolChestItem;
  /** Display label (override → resolved name → refId fallback). */
  label: string;
  /** Display color (override → resolved color → kind default). */
  color: string;
  /** Whether the underlying source still resolves (false → "missing"
   *  badge, click is disabled). */
  resolved: boolean;
}

function resolveChestItem(
  row: TakeoffToolChestItem,
  conditions: TakeoffCondition[],
  assemblies: AssemblyLite[],
): ResolvedChestItem {
  const kind = row.itemKind as ChestItemKind;
  if (kind === "tool") {
    const cfg = TOOL_CONFIG.find((t) => t.id === row.itemId);
    return {
      row,
      label: row.label || cfg?.label || row.itemId,
      color: row.color || "#475569",
      resolved: !!cfg,
    };
  }
  if (kind === "condition") {
    const cond = conditions.find((c) => c.id === row.itemId);
    return {
      row,
      label: row.label || cond?.name || "Condition",
      color: row.color || cond?.color || "#2563eb",
      resolved: !!cond,
    };
  }
  // assembly
  const assembly = assemblies.find((a) => a.id === row.itemId);
  return {
    row,
    label: row.label || assembly?.name || "Assembly",
    color: row.color || "#a855f7",
    resolved: !!assembly,
  };
}

function ChestSwatch({ kind, color }: { kind: ChestItemKind; color: string }) {
  if (kind === "tool") {
    return (
      <div
        className="w-6 h-6 rounded shrink-0 border flex items-center justify-center"
        style={{ backgroundColor: `${color}22`, borderColor: color }}
        aria-hidden="true"
      >
        <div className="w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
      </div>
    );
  }
  if (kind === "condition") {
    return (
      <div
        className="w-6 h-6 rounded-full shrink-0 border-2"
        style={{ backgroundColor: color, borderColor: color }}
        aria-hidden="true"
      />
    );
  }
  // assembly — trade-icon style square
  return (
    <div
      className="w-6 h-6 rounded shrink-0 border flex items-center justify-center"
      style={{ backgroundColor: `${color}22`, borderColor: color }}
      aria-hidden="true"
    >
      <Layers className="w-3 h-3" style={{ color }} />
    </div>
  );
}

interface ItemRowProps {
  item: ResolvedChestItem;
  index: number;
  ownedByMe: boolean;
  draggable: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  onActivate: () => void;
  onDragStart: (idx: number, e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (idx: number, e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onUnpin: () => void;
  onRename: (next: string) => void;
  onColorChange: (next: string) => void;
  onToggleShared: () => void;
}

function ItemRow(props: ItemRowProps) {
  const {
    item, index, ownedByMe, draggable, isDragging, isDropTarget,
    onActivate, onDragStart, onDragOver, onDragEnd, onDrop,
    onUnpin, onRename, onColorChange, onToggleShared,
  } = props;
  const kind = item.row.itemKind as ChestItemKind;
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(item.label);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    const payload: ChestItemDragPayload = {
      kind,
      refId: item.row.itemId,
      color: item.color,
      label: item.label,
      chestId: item.row.id,
    };
    writeChestPayload(e.dataTransfer, payload);
    onDragStart(index, e);
  };

  const commitRename = () => {
    const trimmed = draftLabel.trim();
    if (trimmed && trimmed !== item.label) {
      onRename(trimmed);
    }
    setRenaming(false);
  };

  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragOver={(e) => onDragOver(index, e)}
      onDragEnd={onDragEnd}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onClick={() => { if (!renaming && item.resolved) onActivate(); }}
      className={cn(
        "group flex items-center gap-2 px-2 py-1.5 rounded-md border bg-background hover-elevate transition-colors",
        "cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-50",
        isDropTarget && "ring-2 ring-primary",
        !item.resolved && "opacity-60",
      )}
      data-testid={`chest-item-${item.row.id}`}
      data-kind={kind}
      data-shared={item.row.isShared ? "true" : "false"}
    >
      {ownedByMe ? (
        <Grip className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
      ) : (
        <span className="w-3 shrink-0" aria-hidden="true" />
      )}
      <ChestSwatch kind={kind} color={item.color} />
      <div className="flex-1 min-w-0">
        {renaming ? (
          <Input
            ref={inputRef}
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") { e.preventDefault(); setRenaming(false); setDraftLabel(item.label); }
            }}
            className="h-6 text-xs"
            data-testid={`input-rename-chest-item-${item.row.id}`}
          />
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{item.label}</span>
            {!item.resolved && (
              <Badge variant="outline" className="text-[9px] px-1 h-3.5 text-muted-foreground">missing</Badge>
            )}
          </div>
        )}
      </div>
      {item.row.isShared && (
        <Badge variant="secondary" className="text-[9px] px-1 h-3.5 gap-0.5" data-testid={`badge-shared-${item.row.id}`}>
          <Users className="w-2.5 h-2.5" />
          org
        </Badge>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
            onClick={(e) => e.stopPropagation()}
            data-testid={`button-chest-item-menu-${item.row.id}`}
          >
            <MoreHorizontal className="w-3 h-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" onClick={(e) => e.stopPropagation()}>
          {ownedByMe ? (
            <>
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); setRenaming(true); }}
                data-testid={`menu-rename-chest-item-${item.row.id}`}
              >
                Rename
              </DropdownMenuItem>
              <Popover>
                <PopoverTrigger asChild>
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    data-testid={`menu-color-chest-item-${item.row.id}`}
                  >
                    Change color
                  </DropdownMenuItem>
                </PopoverTrigger>
                <PopoverContent side="left" className="w-40 p-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {COLOR_PRESETS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={cn(
                          "w-7 h-7 rounded-full border-2 hover:scale-110 transition-transform",
                          c === item.color ? "border-foreground" : "border-transparent",
                        )}
                        style={{ backgroundColor: c }}
                        onClick={() => onColorChange(c)}
                        aria-label={`Set color ${c}`}
                        data-testid={`color-preset-${item.row.id}-${c.replace("#", "")}`}
                      />
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); onToggleShared(); }}
                data-testid={`menu-share-chest-item-${item.row.id}`}
              >
                {item.row.isShared ? "Make private" : "Share with org"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => { e.preventDefault(); onUnpin(); }}
                className="text-destructive focus:text-destructive"
                data-testid={`menu-unpin-chest-item-${item.row.id}`}
              >
                Unpin
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem disabled data-testid={`menu-readonly-chest-item-${item.row.id}`}>
              Shared by org · read-only
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

interface SectionProps {
  kind: ChestItemKind;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  mine: ResolvedChestItem[];
  shared: ResolvedChestItem[];
  currentUserId: string | null | undefined;
  onActivate: (item: ResolvedChestItem) => void;
  onCommitOrder: (orderedIds: string[]) => void;
  onUpdate: (id: string, patch: { label?: string | null; color?: string | null; isShared?: boolean }) => void;
  onUnpin: (id: string) => void;
}

function ChestSection(props: SectionProps) {
  const {
    kind, title, icon: Icon, mine, shared, currentUserId,
    onActivate, onCommitOrder, onUpdate, onUnpin,
  } = props;

  // Local working order — applied immediately on drop, then persisted
  // on the next tick. This is the "local-first" reorder per the spec.
  const [draft, setDraft] = useState<ResolvedChestItem[] | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const items = draft ?? mine;

  // Reset local draft whenever upstream items change identity (length
  // or any id list change) — but only if we aren't mid-drag.
  useEffect(() => {
    if (dragIndexRef.current !== null) return;
    setDraft(null);
  }, [mine]);

  const handleDragStart = (idx: number) => {
    dragIndexRef.current = idx;
    setDraft([...items]);
  };
  const handleDragOver = (idx: number, e: React.DragEvent<HTMLDivElement>) => {
    if (dragIndexRef.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setHoverIndex(idx);
  };
  const handleDragEnd = () => {
    dragIndexRef.current = null;
    setHoverIndex(null);
  };
  const handleDrop = () => {
    if (dragIndexRef.current === null || hoverIndex === null) {
      handleDragEnd();
      return;
    }
    const from = dragIndexRef.current;
    const to = hoverIndex;
    if (from === to) {
      handleDragEnd();
      return;
    }
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setDraft(next);
    onCommitOrder(next.map((r) => r.row.id));
    handleDragEnd();
  };

  const isEmpty = items.length === 0 && shared.length === 0;
  if (isEmpty) return null;

  return (
    <section
      className="space-y-1.5"
      data-testid={`chest-section-${kind}`}
    >
      <div className="flex items-center gap-1.5 px-1">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        <Badge variant="secondary" className="text-[9px] px-1 h-3.5">{items.length + shared.length}</Badge>
      </div>
      {items.length > 0 && (
        <div className="space-y-1" data-testid={`chest-section-mine-${kind}`}>
          {items.map((item, idx) => (
            <ItemRow
              key={item.row.id}
              item={item}
              index={idx}
              ownedByMe={true}
              draggable={true}
              isDragging={dragIndexRef.current === idx}
              isDropTarget={hoverIndex === idx && dragIndexRef.current !== null && dragIndexRef.current !== idx}
              onActivate={() => onActivate(item)}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDrop={handleDrop}
              onUnpin={() => onUnpin(item.row.id)}
              onRename={(label) => onUpdate(item.row.id, { label })}
              onColorChange={(color) => onUpdate(item.row.id, { color })}
              onToggleShared={() => onUpdate(item.row.id, { isShared: !item.row.isShared })}
            />
          ))}
        </div>
      )}
      {shared.length > 0 && (
        <div className="pt-1 space-y-1" data-testid={`chest-section-shared-${kind}`}>
          <div className="flex items-center gap-1 px-1">
            <Users className="w-2.5 h-2.5 text-muted-foreground" />
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground">Shared by org</span>
          </div>
          {shared.map((item) => (
            <ItemRow
              key={item.row.id}
              item={item}
              index={-1}
              ownedByMe={false}
              draggable={true}
              isDragging={false}
              isDropTarget={false}
              onActivate={() => onActivate(item)}
              onDragStart={() => {}}
              onDragOver={() => {}}
              onDragEnd={() => {}}
              onDrop={() => {}}
              onUnpin={() => {}}
              onRename={() => {}}
              onColorChange={() => {}}
              onToggleShared={() => {}}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ToolChestPanel(props: ToolChestPanelProps) {
  const {
    open,
    onClose,
    currentUserId,
    conditions,
    assemblies = [],
    onActivateTool,
    onActivateCondition,
    onActivateAssembly,
  } = props;
  const { toast } = useToast();
  const { data: items = [], isLoading } = useChestItems(open);
  const reorderMutation = useReorderChest();
  const updateMutation = useUpdateChestItem();
  const unpinMutation = useUnpinFromChest();

  if (!open) return null;

  const { byKind, total } = partitionChestItems(items, currentUserId);

  const resolveSection = (kind: ChestItemKind) => ({
    mine: byKind[kind].mine.map((r) => resolveChestItem(r, conditions, assemblies)),
    shared: byKind[kind].shared.map((r) => resolveChestItem(r, conditions, assemblies)),
  });

  const tools = resolveSection("tool");
  const conds = resolveSection("condition");
  const asms = resolveSection("assembly");

  const handleActivate = (item: ResolvedChestItem) => {
    if (!item.resolved) {
      toast({ title: "Source not found", description: "This pin's underlying item no longer exists.", variant: "destructive" });
      return;
    }
    const kind = item.row.itemKind as ChestItemKind;
    // Forward the resolved color so the workspace can pre-apply it
    // before entering the tool. `item.color` already merges the
    // override → source → kind-default precedence from `resolveChestItem`.
    const colorOpt = { color: item.color ?? null };
    if (kind === "tool") {
      onActivateTool(item.row.itemId, colorOpt);
    } else if (kind === "condition") {
      const cond = conditions.find((c) => c.id === item.row.itemId);
      if (cond) onActivateCondition(cond, colorOpt);
    } else if (kind === "assembly") {
      onActivateAssembly?.(item.row.itemId, colorOpt);
    }
    // Bump lastUsedAt fire-and-forget so the chest can MRU-sort one day.
    updateMutation.mutate({
      id: item.row.id,
      patch: { lastUsedAt: new Date().toISOString() },
    });
  };

  const handleCommitOrder = (orderedIds: string[]) => {
    reorderMutation.mutate(
      { orderedIds },
      {
        onError: () => {
          toast({
            title: "Reorder failed",
            description: "Couldn't save the new order — reverted.",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleUpdate = (id: string, patch: { label?: string | null; color?: string | null; isShared?: boolean }) => {
    updateMutation.mutate(
      { id, patch },
      {
        onError: () => {
          toast({ title: "Update failed", description: "Couldn't save changes.", variant: "destructive" });
        },
      },
    );
  };

  const handleUnpin = (id: string) => {
    unpinMutation.mutate(
      { id },
      {
        onError: () => {
          toast({ title: "Unpin failed", description: "Couldn't remove this pin.", variant: "destructive" });
        },
      },
    );
  };

  return (
    <div
      className="absolute top-0 left-0 h-full w-full sm:w-72 max-w-full border-r bg-card shadow-2xl z-30 flex flex-col"
      data-testid="panel-tool-chest"
      role="region"
      aria-label="Tool Chest"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <PackageOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Tool Chest</h2>
          <Badge variant="secondary" className="text-[10px]">{total}</Badge>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onClose}
          data-testid="button-close-tool-chest"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
        </div>
      ) : total === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center space-y-3" data-testid="chest-empty-state">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
            <PackageOpen className="w-6 h-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold">Your chest is empty</p>
            <p className="text-xs text-muted-foreground">
              Pin your favourite tools, conditions, and assemblies for one-click access.
            </p>
          </div>
          <div className="text-xs text-muted-foreground space-y-1.5 pt-2">
            <div className="flex items-center gap-2">
              <Plus className="w-3 h-3" />
              <span>Right-click a ribbon tool → Pin to Tool Chest</span>
            </div>
            <div className="flex items-center gap-2">
              <Plus className="w-3 h-3" />
              <span>Pin button next to any condition or assembly</span>
            </div>
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 px-2 py-2">
          <div className="space-y-3">
            <ChestSection
              kind="tool"
              title="Tools"
              icon={Wrench}
              mine={tools.mine}
              shared={tools.shared}
              currentUserId={currentUserId}
              onActivate={handleActivate}
              onCommitOrder={handleCommitOrder}
              onUpdate={handleUpdate}
              onUnpin={handleUnpin}
            />
            {tools.mine.length + tools.shared.length > 0 &&
              conds.mine.length + conds.shared.length > 0 && <Separator />}
            <ChestSection
              kind="condition"
              title="Conditions"
              icon={PackageOpen}
              mine={conds.mine}
              shared={conds.shared}
              currentUserId={currentUserId}
              onActivate={handleActivate}
              onCommitOrder={handleCommitOrder}
              onUpdate={handleUpdate}
              onUnpin={handleUnpin}
            />
            {(conds.mine.length + conds.shared.length > 0) &&
              (asms.mine.length + asms.shared.length > 0) && <Separator />}
            <ChestSection
              kind="assembly"
              title="Assemblies"
              icon={Layers}
              mine={asms.mine}
              shared={asms.shared}
              currentUserId={currentUserId}
              onActivate={handleActivate}
              onCommitOrder={handleCommitOrder}
              onUpdate={handleUpdate}
              onUnpin={handleUnpin}
            />
          </div>
        </ScrollArea>
      )}
      <div className="px-3 py-1.5 border-t bg-muted/30">
        <p className="text-[10px] text-muted-foreground">
          Drag any item onto the canvas to start drawing.
        </p>
      </div>
    </div>
  );
}

ToolChestPanel.displayName = "ToolChestPanel";

// Re-exports kept here for convenience so consumers can import everything
// chest-related from a single barrel.
export type { ChestItemDragPayload, ChestItemKind } from "./toolChest";
export { CHEST_DRAG_MIME, readChestPayload, usePinToChest } from "./toolChest";
