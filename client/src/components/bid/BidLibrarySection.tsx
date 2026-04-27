import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Search, Plus, ChevronDown, ChevronRight, Package, Layers, Ruler,
  MoreVertical, Pencil, Trash2, Sparkles, BookOpen, ArrowRight
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import LibraryItemDialog from "@/components/LibraryItemDialog";
import LibraryAssemblyDialog from "@/components/LibraryAssemblyDialog";
import LibraryCategoryManagerDialog from "@/components/LibraryCategoryManagerDialog";
import { dispatchLibraryEvent } from "@/lib/libraryEvents";
import { cn } from "@/lib/utils";
import { CheckSquare, X, FolderInput } from "lucide-react";
import { FolderOpen } from "lucide-react";
import type { LibraryItem, LibraryAssembly, CustomLibrary, SavedTakeoff, LibraryCategory } from "@shared/schema";
import { getTradeDisplayName, type TradeType } from "@shared/tradeTypeUtils";

const UNCATEGORIZED_KEY = "__uncategorized__";
const NO_TRADE_KEY = "__no_trade__";

interface BidLibrarySectionProps {
  bidId: string;
}

export default function BidLibrarySection({ bidId }: BidLibrarySectionProps) {
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("all");
  const [costTypeFilter, setCostTypeFilter] = useState<string>("all");
  const [itemsOpen, setItemsOpen] = useState(true);
  const [assembliesOpen, setAssembliesOpen] = useState(false);
  const [takeoffsOpen, setTakeoffsOpen] = useState(false);

  const [editItem, setEditItem] = useState<LibraryItem | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editAssembly, setEditAssembly] = useState<any>(null);
  const [showAssemblyDialog, setShowAssemblyDialog] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deleteAssemblyId, setDeleteAssemblyId] = useState<string | null>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  // Task #2086 — multi-select & bulk re-bucket from the bid sidebar.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [bulkMoveTargetCategoryId, setBulkMoveTargetCategoryId] = useState<string>("");

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
  };

  const toggleItemSelected = (id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: libraries = [] } = useQuery<CustomLibrary[]>({
    queryKey: ["/api/custom-libraries"],
  });

  const itemsQueryUrl = `/api/library-items?libraryId=${selectedLibraryId}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ""}`;
  const { data: items = [], isLoading: itemsLoading } = useQuery<LibraryItem[]>({
    queryKey: [itemsQueryUrl],
  });

  // Task #2068 — fetch categories so the bid item picker can render the
  // Trade > Category > Item tree.
  const categoriesQueryUrl = `/api/library-categories?libraryId=${selectedLibraryId}`;
  const { data: categories = [] } = useQuery<LibraryCategory[]>({
    queryKey: [categoriesQueryUrl],
  });

  const assembliesQueryUrl = `/api/library-assemblies?libraryId=${selectedLibraryId}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ""}`;
  const { data: assemblies = [], isLoading: assembliesLoading } = useQuery<any[]>({
    queryKey: [assembliesQueryUrl],
  });

  const takeoffsQueryUrl = `/api/saved-takeoffs?libraryId=${selectedLibraryId}`;
  const { data: takeoffs = [] } = useQuery<SavedTakeoff[]>({
    queryKey: [takeoffsQueryUrl],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/library-items/seed-from-onboarding");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-items") });
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-assemblies") });
      if (data.seeded) {
        toast({ title: "Library Populated", description: `Created ${data.itemsCreated} items and ${data.assembliesCreated} assemblies.` });
      } else {
        toast({ title: "Already Populated", description: "Library has already been seeded." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/library-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-items") });
      toast({ title: "Item deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to delete item", variant: "destructive" });
    },
  });

  const deleteAssemblyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/library-assemblies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-assemblies") });
      toast({ title: "Assembly deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to delete assembly", variant: "destructive" });
    },
  });

  // Task #2086 — bulk re-bucket selected items via the new PATCH endpoint.
  const bulkMoveMutation = useMutation({
    mutationFn: async (payload: { ids: string[]; categoryId: string | null }) => {
      const res = await apiRequest("PATCH", "/api/library-items/bulk", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-items") });
      setShowBulkMoveDialog(false);
      setBulkMoveTargetCategoryId("");
      exitSelectionMode();
      toast({ title: "Items moved", description: `Re-bucketed ${data?.updated ?? 0} items.` });
    },
    onError: (err: any) => {
      toast({ title: "Move failed", description: err?.message || "Could not move items", variant: "destructive" });
    },
  });

  const filteredItems = useMemo(() => {
    let result = items;
    if (costTypeFilter !== "all") {
      result = result.filter(i => i.costTypes?.includes(costTypeFilter));
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.itemNumber?.toLowerCase().includes(q) ||
        i.unitOfMeasure?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, searchQuery, costTypeFilter]);

  // Task #2068 — Trade > Category > Item grouping for the picker.
  const tradeTree = useMemo(() => {
    const categoryNameById = new Map(categories.map(c => [c.id, c.name] as const));
    const tradesMap = new Map<string, {
      tradeKey: string;
      tradeLabel: string;
      categoriesMap: Map<string, { categoryKey: string; categoryLabel: string; items: LibraryItem[] }>;
    }>();
    for (const it of filteredItems) {
      const tradeKey = it.tradeType || NO_TRADE_KEY;
      const tradeLabel = it.tradeType
        ? getTradeDisplayName(it.tradeType as TradeType)
        : "Other Items";
      let trade = tradesMap.get(tradeKey);
      if (!trade) {
        trade = { tradeKey, tradeLabel, categoriesMap: new Map() };
        tradesMap.set(tradeKey, trade);
      }
      const catKey = it.categoryId || UNCATEGORIZED_KEY;
      const catLabel = it.categoryId
        ? (categoryNameById.get(it.categoryId) ?? "Uncategorized")
        : "Uncategorized";
      let cat = trade.categoriesMap.get(catKey);
      if (!cat) {
        cat = { categoryKey: catKey, categoryLabel: catLabel, items: [] };
        trade.categoriesMap.set(catKey, cat);
      }
      cat.items.push(it);
    }
    return Array.from(tradesMap.values())
      .map(t => ({
        ...t,
        categoryList: Array.from(t.categoriesMap.values()).sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel)),
      }))
      .sort((a, b) => {
        if (a.tradeKey === NO_TRADE_KEY) return 1;
        if (b.tradeKey === NO_TRADE_KEY) return -1;
        return a.tradeLabel.localeCompare(b.tradeLabel);
      });
  }, [filteredItems, categories]);

  const [expandedTrades, setExpandedTrades] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const isTradeOpen = (k: string) => (searchQuery ? true : (expandedTrades[k] ?? true));
  const isCategoryOpen = (k: string) => (searchQuery ? true : (expandedCategories[k] ?? true));

  const filteredAssemblies = useMemo(() => {
    if (!searchQuery) return assemblies;
    const q = searchQuery.toLowerCase();
    return assemblies.filter((a: any) =>
      a.name.toLowerCase().includes(q) ||
      a.assemblyNumber?.toLowerCase().includes(q)
    );
  }, [assemblies, searchQuery]);

  const handleApplyItem = (item: LibraryItem) => {
    const totalCost = item.unitCosts
      ? Object.values(item.unitCosts as Record<string, number>).reduce((s, v) => s + (Number(v) || 0), 0)
      : 0;
    dispatchLibraryEvent({
      type: "APPLY_LIBRARY_ITEM",
      item: {
        name: item.name,
        itemNumber: item.itemNumber || undefined,
        unitOfMeasure: item.unitOfMeasure,
        unitCost: totalCost > 0 ? totalCost : undefined,
        costTypes: item.costTypes || undefined,
      },
    });
  };

  const handleApplyAssembly = (asm: any) => {
    dispatchLibraryEvent({
      type: "APPLY_LIBRARY_ASSEMBLY",
      assembly: {
        id: asm.id,
        name: asm.name,
        assemblyNumber: asm.assemblyNumber,
        unitOfMeasure: asm.unitOfMeasure,
        items: (asm.items || []).map((i: any) => ({
          name: i.name,
          formula: i.formula || "1",
          wasteFactor: i.wasteFactor || 0,
          unitCost: i.unitCost || undefined,
          unit: i.unit || undefined,
          itemId: i.itemId || null,
        })),
      },
    });
  
  };

  const handleLoadTakeoff = (takeoff: SavedTakeoff) => {
    dispatchLibraryEvent({
      type: "LOAD_SAVED_TAKEOFF",
      takeoff: {
        id: takeoff.id,
        name: takeoff.name,
        measurementData: takeoff.measurementData,
      },
    });
  
  };

  const isEmpty = items.length === 0 && assemblies.length === 0 && takeoffs.length === 0;

  return (
    <>
      <div className="px-2 py-1 space-y-1.5">
        <div className="flex items-center gap-1">
          <Select value={selectedLibraryId} onValueChange={setSelectedLibraryId}>
            <SelectTrigger className="h-6 text-[11px] flex-1" data-testid="select-bid-library">
              <SelectValue placeholder="All Libraries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Libraries</SelectItem>
              {libraries.map((lib) => (
                <SelectItem key={lib.id} value={lib.id}>{lib.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <Input
            placeholder="Search libraries..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 pl-6 text-[11px]"
            data-testid="input-bid-library-search"
          />
        </div>
        <Select value={costTypeFilter} onValueChange={setCostTypeFilter}>
          <SelectTrigger className="h-6 text-[11px]" data-testid="select-bid-cost-type-filter">
            <SelectValue placeholder="All Cost Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Cost Types</SelectItem>
            <SelectItem value="material">Material</SelectItem>
            <SelectItem value="labor">Labor</SelectItem>
            <SelectItem value="equipment">Equipment</SelectItem>
            <SelectItem value="subcontractor">Subcontractor</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isEmpty && !itemsLoading && !assembliesLoading && (
        <div className="px-3 py-2 text-center space-y-2">
          <BookOpen className="h-6 w-6 mx-auto text-muted-foreground" />
          <p className="text-[11px] text-muted-foreground">Your library is empty</p>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px]"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            data-testid="btn-bid-seed-library"
          >
            <Sparkles className="h-3 w-3 mr-1" />
            {seedMutation.isPending ? "Populating..." : "Populate from Trade Library"}
          </Button>
        </div>
      )}

      <Collapsible open={itemsOpen} onOpenChange={setItemsOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-accent/50" data-testid="bid-section-items">
          {itemsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Package className="h-3 w-3 text-green-500" />
          <span className="text-xs font-medium">Items</span>
          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">{filteredItems.length}</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pl-3 pr-1 space-y-0.5 py-0.5">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="flex-1 justify-start text-[11px] h-6"
                onClick={() => { setEditItem(null); setShowItemDialog(true); }}
                data-testid="btn-bid-add-item"
              >
                <Plus className="h-3 w-3 mr-1" /> New Item
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-[11px] h-6 px-1.5"
                onClick={() => setShowCategoryManager(true)}
                title="Manage categories"
                data-testid="btn-bid-manage-categories"
              >
                <Layers className="h-3 w-3 mr-1" /> Categories
              </Button>
              {/* Task #2086 — bulk-edit toggle. */}
              <Button
                variant={selectionMode ? "secondary" : "ghost"}
                size="sm"
                className="text-[11px] h-6 px-1.5"
                onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
                title={selectionMode ? "Exit selection mode" : "Select items to bulk-edit"}
                data-testid="btn-bid-toggle-bulk-select"
              >
                {selectionMode ? <X className="h-3 w-3 mr-1" /> : <CheckSquare className="h-3 w-3 mr-1" />}
                {selectionMode ? "Done" : "Select"}
              </Button>
            </div>
            {/* Task #2086 — bulk action bar in the bid sidebar. */}
            {selectionMode && (
              <div
                className="flex items-center gap-1 px-1.5 py-1 rounded bg-accent/60 border border-border/60"
                data-testid="bid-bulk-action-bar"
              >
                <Checkbox
                  checked={selectedItemIds.size > 0 && selectedItemIds.size === filteredItems.length}
                  onCheckedChange={(v) => {
                    if (v) setSelectedItemIds(new Set(filteredItems.map((i) => i.id)));
                    else setSelectedItemIds(new Set());
                  }}
                  className="h-3.5 w-3.5"
                  data-testid="checkbox-bid-select-all-items"
                />
                <span className="text-[11px] flex-1" data-testid="text-bid-selected-count">
                  {selectedItemIds.size} selected
                </span>
                <Button
                  variant="default"
                  size="sm"
                  className="h-5 text-[11px] px-1.5"
                  disabled={selectedItemIds.size === 0}
                  onClick={() => {
                    setBulkMoveTargetCategoryId("");
                    setShowBulkMoveDialog(true);
                  }}
                  data-testid="btn-bid-bulk-move"
                >
                  <FolderInput className="h-3 w-3 mr-1" /> Move…
                </Button>
              </div>
            )}
            {/* Task #2068 — Trade > Category > Item tree. */}
            {tradeTree.map((trade) => (
              <Collapsible
                key={trade.tradeKey}
                open={isTradeOpen(trade.tradeKey)}
                onOpenChange={(o) => setExpandedTrades(prev => ({ ...prev, [trade.tradeKey]: o }))}
              >
                <CollapsibleTrigger
                  className="flex items-center gap-1.5 w-full px-1.5 py-1 text-[11px] rounded hover:bg-accent/40"
                  data-testid={`bid-trade-group-${trade.tradeKey}`}
                >
                  {isTradeOpen(trade.tradeKey) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <FolderOpen className="h-3 w-3 text-amber-500" />
                  <span className="font-medium truncate">{trade.tradeLabel}</span>
                  <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                    {trade.categoryList.reduce((s, c) => s + c.items.length, 0)}
                  </Badge>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pl-3 space-y-0.5 py-0.5">
                    {trade.categoryList.map((cat) => {
                      const catNodeKey = `${trade.tradeKey}::${cat.categoryKey}`;
                      return (
                        <Collapsible
                          key={catNodeKey}
                          open={isCategoryOpen(catNodeKey)}
                          onOpenChange={(o) => setExpandedCategories(prev => ({ ...prev, [catNodeKey]: o }))}
                        >
                          <CollapsibleTrigger
                            className="flex items-center gap-1.5 w-full px-1.5 py-1 text-[11px] rounded hover:bg-accent/40"
                            data-testid={`bid-category-group-${catNodeKey}`}
                          >
                            {isCategoryOpen(catNodeKey) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            <Layers className="h-3 w-3 text-purple-500" />
                            <span className="truncate">{cat.categoryLabel}</span>
                            <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">{cat.items.length}</Badge>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="pl-3 space-y-0.5 py-0.5">
                              {cat.items.map((item) => {
                                const isSelected = selectedItemIds.has(item.id);
                                return (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      "flex items-center gap-1 px-1.5 py-1 text-[11px] rounded hover:bg-accent/50 group cursor-pointer",
                                      isSelected && "bg-accent/70"
                                    )}
                                    onClick={selectionMode ? () => toggleItemSelected(item.id) : undefined}
                                    data-testid={`bid-library-item-${item.id}`}
                                  >
                                    {selectionMode ? (
                                      <Checkbox
                                        checked={isSelected}
                                        onCheckedChange={() => toggleItemSelected(item.id)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="h-3.5 w-3.5"
                                        data-testid={`checkbox-bid-item-${item.id}`}
                                      />
                                    ) : (
                                      <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="truncate font-medium">{item.name}</div>
                                      <div className="text-muted-foreground truncate text-[10px]">
                                        {item.itemNumber && <span>{item.itemNumber} · </span>}
                                        {item.unitOfMeasure}
                                        {item.unitCosts && typeof item.unitCosts === "object" ? (
                                          <span> · ${Object.values(item.unitCosts as Record<string, number>).reduce<number>((s, v) => s + (Number(v) || 0), 0).toFixed(2)}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                    {!selectionMode && (
                                      <>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                                          onClick={(e) => { e.stopPropagation(); handleApplyItem(item); }}
                                          title="Apply to takeoff"
                                          data-testid={`btn-apply-item-${item.id}`}
                                        >
                                          <ArrowRight className="h-3 w-3" />
                                        </Button>
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0" data-testid={`btn-bid-item-menu-${item.id}`}>
                                              <MoreVertical className="h-3 w-3" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent align="end">
                                            <DropdownMenuItem onClick={() => { setEditItem(item); setShowItemDialog(true); }} data-testid={`btn-bid-edit-item-${item.id}`}>
                                              <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem className="text-destructive" onClick={() => setDeleteItemId(item.id)} data-testid={`btn-bid-delete-item-${item.id}`}>
                                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={assembliesOpen} onOpenChange={setAssembliesOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-accent/50" data-testid="bid-section-assemblies">
          {assembliesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Layers className="h-3 w-3 text-orange-500" />
          <span className="text-xs font-medium">Assemblies</span>
          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">{filteredAssemblies.length}</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pl-3 pr-1 space-y-0.5 py-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-[11px] h-6"
              onClick={() => { setEditAssembly(null); setShowAssemblyDialog(true); }}
              data-testid="btn-bid-add-assembly"
            >
              <Plus className="h-3 w-3 mr-1" /> New Assembly
            </Button>
            {filteredAssemblies.map((asm: any) => (
              <div
                key={asm.id}
                className="flex items-center gap-1 px-1.5 py-1 text-[11px] rounded hover:bg-accent/50 group cursor-pointer"
                data-testid={`bid-library-assembly-${asm.id}`}
              >
                <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{asm.name}</div>
                  <div className="text-muted-foreground truncate text-[10px]">
                    {asm.assemblyNumber && <span>{asm.assemblyNumber} · </span>}
                    {asm.unitOfMeasure}
                    {asm.items && <span> · {asm.items.length} items</span>}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={(e) => { e.stopPropagation(); handleApplyAssembly(asm); }}
                  title="Apply to takeoff"
                  data-testid={`btn-apply-assembly-${asm.id}`}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0" data-testid={`btn-bid-assembly-menu-${asm.id}`}>
                      <MoreVertical className="h-3 w-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditAssembly(asm); setShowAssemblyDialog(true); }} data-testid={`btn-bid-edit-assembly-${asm.id}`}>
                      <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteAssemblyId(asm.id)} data-testid={`btn-bid-delete-assembly-${asm.id}`}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible open={takeoffsOpen} onOpenChange={setTakeoffsOpen}>
        <CollapsibleTrigger className="flex items-center gap-1.5 w-full px-2 py-1 text-sm hover:bg-accent/50" data-testid="bid-section-takeoffs">
          {takeoffsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <Ruler className="h-3 w-3 text-blue-500" />
          <span className="text-xs font-medium">Saved Takeoffs</span>
          <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">{takeoffs.length}</Badge>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pl-3 pr-1 space-y-0.5 py-0.5">
            {takeoffs.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center gap-1 px-1.5 py-1 text-[11px] rounded hover:bg-accent/50 group"
                data-testid={`bid-takeoff-item-${t.id}`}
              >
                <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="truncate flex-1">{t.name}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                  onClick={() => handleLoadTakeoff(t)}
                  title="Load to current sheet"
                  data-testid={`btn-load-takeoff-${t.id}`}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            ))}
            {takeoffs.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-1.5 py-1">No saved takeoffs</p>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {showItemDialog && (
        <LibraryItemDialog
          open={showItemDialog}
          onOpenChange={setShowItemDialog}
          item={editItem}
          libraryId={selectedLibraryId !== "all" ? selectedLibraryId : undefined}
        />
      )}

      {showAssemblyDialog && (
        <LibraryAssemblyDialog
          open={showAssemblyDialog}
          onOpenChange={setShowAssemblyDialog}
          assembly={editAssembly}
          libraryId={selectedLibraryId !== "all" ? selectedLibraryId : undefined}
          allItems={items}
        />
      )}

      {showCategoryManager && (
        <LibraryCategoryManagerDialog
          open={showCategoryManager}
          onOpenChange={setShowCategoryManager}
          libraryId={selectedLibraryId}
        />
      )}

      <AlertDialog open={!!deleteItemId} onOpenChange={() => setDeleteItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this library item.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteItemId) deleteItemMutation.mutate(deleteItemId); setDeleteItemId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteAssemblyId} onOpenChange={() => setDeleteAssemblyId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Assembly</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this assembly.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteAssemblyId) deleteAssemblyMutation.mutate(deleteAssemblyId); setDeleteAssemblyId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Task #2086 — bulk move dialog. */}
      <Dialog open={showBulkMoveDialog} onOpenChange={(o) => { if (!o) { setShowBulkMoveDialog(false); setBulkMoveTargetCategoryId(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move items to category</DialogTitle>
            <DialogDescription>
              Re-bucket {selectedItemIds.size} selected {selectedItemIds.size === 1 ? "item" : "items"} into a different category.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Destination category</Label>
            <Select value={bulkMoveTargetCategoryId} onValueChange={setBulkMoveTargetCategoryId}>
              <SelectTrigger data-testid="select-bid-bulk-move-target">
                <SelectValue placeholder="Select a category…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__uncategorized__">Uncategorized</SelectItem>
                {categories
                  .slice()
                  .sort((a, b) => {
                    const ta = a.tradeType || "";
                    const tb = b.tradeType || "";
                    if (ta !== tb) return ta.localeCompare(tb);
                    return a.name.localeCompare(b.name);
                  })
                  .map((c) => {
                    const tradeLabel = c.tradeType ? getTradeDisplayName(c.tradeType as TradeType) : "Other";
                    return (
                      <SelectItem key={c.id} value={c.id} data-testid={`option-bid-bulk-move-${c.id}`}>
                        {tradeLabel} · {c.name}
                      </SelectItem>
                    );
                  })}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowBulkMoveDialog(false); setBulkMoveTargetCategoryId(""); }}>
              Cancel
            </Button>
            <Button
              disabled={!bulkMoveTargetCategoryId || bulkMoveMutation.isPending || selectedItemIds.size === 0}
              onClick={() => {
                bulkMoveMutation.mutate({
                  ids: Array.from(selectedItemIds),
                  categoryId: bulkMoveTargetCategoryId === "__uncategorized__" ? null : bulkMoveTargetCategoryId,
                });
              }}
              data-testid="btn-confirm-bid-bulk-move"
            >
              {bulkMoveMutation.isPending ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
