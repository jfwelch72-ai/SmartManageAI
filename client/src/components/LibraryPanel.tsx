import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search, Plus, ChevronDown, ChevronRight, Package, Layers, Ruler,
  MoreVertical, Pencil, Trash2, Settings, Download, Sparkles, BookOpen, FolderOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import LibraryItemDialog from "./LibraryItemDialog";
import LibraryAssemblyDialog from "./LibraryAssemblyDialog";
import type { LibraryItem, LibraryAssembly, CustomLibrary, SavedTakeoff, LibraryCategory } from "@shared/schema";
import { getTradeDisplayName, type TradeType } from "@shared/tradeTypeUtils";

const UNCATEGORIZED_KEY = "__uncategorized__";
const NO_TRADE_KEY = "__no_trade__";

interface LibraryPanelProps {
  projectId?: number;
  sheetId?: string;
  measurements?: any[];
}

export default function LibraryPanel({ projectId, sheetId, measurements }: LibraryPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("all");
  const [itemsOpen, setItemsOpen] = useState(true);
  const [assembliesOpen, setAssembliesOpen] = useState(true);
  const [takeoffsOpen, setTakeoffsOpen] = useState(false);

  const [editItem, setEditItem] = useState<LibraryItem | null>(null);
  const [showItemDialog, setShowItemDialog] = useState(false);
  const [editAssembly, setEditAssembly] = useState<any>(null);
  const [showAssemblyDialog, setShowAssemblyDialog] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState<string | null>(null);
  const [deleteAssemblyId, setDeleteAssemblyId] = useState<string | null>(null);
  const [deleteTakeoffId, setDeleteTakeoffId] = useState<string | null>(null);

  const [showLibraryManager, setShowLibraryManager] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryDesc, setNewLibraryDesc] = useState("");
  const [editLibrary, setEditLibrary] = useState<CustomLibrary | null>(null);
  const [deleteLibraryId, setDeleteLibraryId] = useState<string | null>(null);

  const [saveTakeoffName, setSaveTakeoffName] = useState("");
  const [showSaveTakeoffDialog, setShowSaveTakeoffDialog] = useState(false);

  const { data: libraries = [] } = useQuery<CustomLibrary[]>({
    queryKey: ["/api/custom-libraries"],
  });

  const itemsQueryUrl = `/api/library-items?libraryId=${selectedLibraryId}${searchQuery ? `&search=${encodeURIComponent(searchQuery)}` : ""}`;
  const { data: items = [], isLoading: itemsLoading } = useQuery<LibraryItem[]>({
    queryKey: [itemsQueryUrl],
  });

  // Task #2068 — fetch the per-org category list so we can label the middle
  // tier of the Trade > Category > Item tree below.
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
      invalidateItems();
      invalidateAssemblies();
      if (data.seeded) {
        toast({ title: "Library Populated", description: `Created ${data.itemsCreated} items and ${data.assembliesCreated} assemblies from your trade library.` });
      } else {
        toast({ title: "Already Populated", description: "Your library has already been seeded with prebuilt items." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const invalidateItems = () => queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-items") });
  const invalidateAssemblies = () => queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-assemblies") });
  const invalidateTakeoffs = () => queryClient.invalidateQueries({ predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/saved-takeoffs") });
  const invalidateLibraries = () => queryClient.invalidateQueries({ queryKey: ["/api/custom-libraries"] });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/library-items/${id}`);
    },
    onSuccess: () => {
      invalidateItems();
      toast({ title: "Item deleted" });
    },
  });

  const deleteAssemblyMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/library-assemblies/${id}`);
    },
    onSuccess: () => {
      invalidateAssemblies();
      toast({ title: "Assembly deleted" });
    },
  });

  const createLibraryMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string }) => {
      const res = await apiRequest("POST", "/api/custom-libraries", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateLibraries();
      setNewLibraryName("");
      setNewLibraryDesc("");
      toast({ title: "Library created" });
    },
  });

  const updateLibraryMutation = useMutation({
    mutationFn: async ({ id, ...data }: { id: string; name: string; description?: string }) => {
      const res = await apiRequest("PATCH", `/api/custom-libraries/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      invalidateLibraries();
      setEditLibrary(null);
      toast({ title: "Library updated" });
    },
  });

  const deleteLibraryMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/custom-libraries/${id}`);
    },
    onSuccess: () => {
      invalidateLibraries();
      if (selectedLibraryId === deleteLibraryId) setSelectedLibraryId("all");
      setDeleteLibraryId(null);
      toast({ title: "Library deleted" });
    },
  });

  const saveTakeoffMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/saved-takeoffs", data);
      return res.json();
    },
    onSuccess: () => {
      invalidateTakeoffs();
      setShowSaveTakeoffDialog(false);
      setSaveTakeoffName("");
      toast({ title: "Takeoff saved" });
    },
  });

  const deleteTakeoffMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/saved-takeoffs/${id}`);
    },
    onSuccess: () => {
      invalidateTakeoffs();
      toast({ title: "Takeoff deleted" });
    },
  });

  const filteredItems = useMemo(() => {
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(i =>
      i.name.toLowerCase().includes(q) ||
      i.itemNumber?.toLowerCase().includes(q) ||
      i.unitOfMeasure?.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  // Task #2068 — Build a Trade > Category > Items tree for the new three-tier
  // navigation. Items without a trade collapse under "Other Items"; items
  // without a category land under their trade's "Uncategorized" bucket.
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

  // Auto-expand all trade/category buckets while the user is searching so
  // matches stay visible across the tree.
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

  const isEmpty = items.length === 0 && assemblies.length === 0 && takeoffs.length === 0;

  return (
    <div className="flex flex-col h-full bg-card" data-testid="library-panel">
      <div className="p-2 border-b space-y-2 shrink-0">
        <div className="flex items-center gap-1">
          <Select value={selectedLibraryId} onValueChange={setSelectedLibraryId}>
            <SelectTrigger className="h-8 text-sm flex-1" data-testid="select-library">
              <SelectValue placeholder="All Libraries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Libraries</SelectItem>
              {libraries.map((lib) => (
                <SelectItem key={lib.id} value={lib.id}>{lib.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setShowLibraryManager(true)}
            data-testid="btn-manage-libraries"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search libraries... (Ctrl+S)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-7 text-sm"
            data-testid="input-library-search"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-1">
          {isEmpty && !itemsLoading && !assembliesLoading && (
            <div className="p-4 text-center space-y-3">
              <BookOpen className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Your library is empty</p>
              <Button
                size="sm"
                onClick={() => seedMutation.mutate()}
                disabled={seedMutation.isPending}
                data-testid="btn-seed-library"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {seedMutation.isPending ? "Populating..." : "Populate from Trade Library"}
              </Button>
            </div>
          )}

          <Collapsible open={takeoffsOpen} onOpenChange={setTakeoffsOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-1.5 text-sm font-medium hover:bg-accent/50 rounded" data-testid="section-takeoffs">
              {takeoffsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Ruler className="h-3.5 w-3.5 text-blue-500" />
              <span>Takeoffs</span>
              <Badge variant="secondary" className="ml-auto text-xs h-5">{takeoffs.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-4 pr-1 space-y-0.5 py-1">
                {measurements && measurements.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs h-7"
                    onClick={() => setShowSaveTakeoffDialog(true)}
                    data-testid="btn-save-takeoff"
                  >
                    <Download className="h-3 w-3 mr-1" /> Save Current Takeoff
                  </Button>
                )}
                {takeoffs.map((t: any) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent/50 group"
                    data-testid={`takeoff-item-${t.id}`}
                  >
                    <Ruler className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{t.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 opacity-0 group-hover:opacity-100"
                      onClick={() => setDeleteTakeoffId(t.id)}
                      data-testid={`btn-delete-takeoff-${t.id}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {takeoffs.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">No saved takeoffs</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Collapsible open={itemsOpen} onOpenChange={setItemsOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-1.5 text-sm font-medium hover:bg-accent/50 rounded" data-testid="section-items">
              {itemsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Package className="h-3.5 w-3.5 text-green-500" />
              <span>Items</span>
              <Badge variant="secondary" className="ml-auto text-xs h-5">{filteredItems.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-4 pr-1 space-y-0.5 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs h-7"
                  onClick={() => { setEditItem(null); setShowItemDialog(true); }}
                  data-testid="btn-add-item"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Item
                </Button>
                {!isEmpty && items.length === 0 && !itemsLoading && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start text-xs h-7 text-primary"
                    onClick={() => seedMutation.mutate()}
                    disabled={seedMutation.isPending}
                    data-testid="btn-seed-items"
                  >
                    <Sparkles className="h-3 w-3 mr-1" /> {seedMutation.isPending ? "Loading..." : "Populate from Trade Library"}
                  </Button>
                )}
                {/* Task #2068 — Trade > Category > Item tree. */}
                {tradeTree.map((trade) => (
                  <Collapsible
                    key={trade.tradeKey}
                    open={isTradeOpen(trade.tradeKey)}
                    onOpenChange={(o) => setExpandedTrades(prev => ({ ...prev, [trade.tradeKey]: o }))}
                  >
                    <CollapsibleTrigger
                      className="flex items-center gap-1.5 w-full px-1.5 py-1 text-xs rounded hover:bg-accent/40"
                      data-testid={`trade-group-${trade.tradeKey}`}
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
                                className="flex items-center gap-1.5 w-full px-1.5 py-1 text-xs rounded hover:bg-accent/40"
                                data-testid={`category-group-${catNodeKey}`}
                              >
                                {isCategoryOpen(catNodeKey) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                <Layers className="h-3 w-3 text-purple-500" />
                                <span className="truncate">{cat.categoryLabel}</span>
                                <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">{cat.items.length}</Badge>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="pl-3 space-y-0.5 py-0.5">
                                  {cat.items.map((item) => (
                                    <div
                                      key={item.id}
                                      className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent/50 group cursor-pointer"
                                      data-testid={`library-item-${item.id}`}
                                    >
                                      <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                                      <div className="flex-1 min-w-0">
                                        <div className="truncate font-medium">{item.name}</div>
                                        <div className="text-muted-foreground truncate">
                                          {item.itemNumber && <span>{item.itemNumber} · </span>}
                                          {item.unitOfMeasure}
                                          {item.unitCosts && typeof item.unitCosts === "object" ? (
                                            <span> · ${Object.values(item.unitCosts as Record<string, number>).reduce<number>((s, v) => s + (Number(v) || 0), 0).toFixed(2)}</span>
                                          ) : null}
                                        </div>
                                      </div>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" data-testid={`btn-item-menu-${item.id}`}>
                                            <MoreVertical className="h-3 w-3" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                          <DropdownMenuItem onClick={() => { setEditItem(item); setShowItemDialog(true); }} data-testid={`btn-edit-item-${item.id}`}>
                                            <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                                          </DropdownMenuItem>
                                          <DropdownMenuItem className="text-destructive" onClick={() => setDeleteItemId(item.id)} data-testid={`btn-delete-item-${item.id}`}>
                                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  ))}
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
            <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-1.5 text-sm font-medium hover:bg-accent/50 rounded" data-testid="section-assemblies">
              {assembliesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Layers className="h-3.5 w-3.5 text-orange-500" />
              <span>Assemblies</span>
              <Badge variant="secondary" className="ml-auto text-xs h-5">{filteredAssemblies.length}</Badge>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pl-4 pr-1 space-y-0.5 py-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-xs h-7"
                  onClick={() => { setEditAssembly(null); setShowAssemblyDialog(true); }}
                  data-testid="btn-add-assembly"
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Assembly
                </Button>
                {filteredAssemblies.map((asm: any) => (
                  <div
                    key={asm.id}
                    className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-accent/50 group cursor-pointer"
                    data-testid={`library-assembly-${asm.id}`}
                  >
                    <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{asm.name}</div>
                      <div className="text-muted-foreground truncate">
                        {asm.assemblyNumber && <span>{asm.assemblyNumber} · </span>}
                        {asm.unitOfMeasure}
                        {asm.items && <span> · {asm.items.length} items</span>}
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100" data-testid={`btn-assembly-menu-${asm.id}`}>
                          <MoreVertical className="h-3 w-3" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditAssembly(asm); setShowAssemblyDialog(true); }} data-testid={`btn-edit-assembly-${asm.id}`}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => setDeleteAssemblyId(asm.id)} data-testid={`btn-delete-assembly-${asm.id}`}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>

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

      <AlertDialog open={!!deleteItemId} onOpenChange={() => setDeleteItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this library item. This action cannot be undone.</AlertDialogDescription>
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
            <AlertDialogDescription>This will permanently delete this assembly and all its items. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteAssemblyId) deleteAssemblyMutation.mutate(deleteAssemblyId); setDeleteAssemblyId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteTakeoffId} onOpenChange={() => setDeleteTakeoffId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Saved Takeoff</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this saved takeoff.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteTakeoffId) deleteTakeoffMutation.mutate(deleteTakeoffId); setDeleteTakeoffId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showSaveTakeoffDialog} onOpenChange={setShowSaveTakeoffDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Current Takeoff</DialogTitle>
            <DialogDescription>Save the current measurements as a reusable takeoff template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Name</Label>
              <Input
                value={saveTakeoffName}
                onChange={(e) => setSaveTakeoffName(e.target.value)}
                placeholder="e.g., Foundation Takeoff Template"
                data-testid="input-takeoff-name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveTakeoffDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                saveTakeoffMutation.mutate({
                  name: saveTakeoffName,
                  projectId,
                  sheetId,
                  measurementData: measurements,
                  libraryId: selectedLibraryId !== "all" ? selectedLibraryId : null,
                });
              }}
              disabled={!saveTakeoffName.trim() || saveTakeoffMutation.isPending}
              data-testid="btn-confirm-save-takeoff"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLibraryManager} onOpenChange={setShowLibraryManager}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Libraries</DialogTitle>
            <DialogDescription>Create and organize custom libraries to group your items and assemblies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-2">
              <Input
                value={newLibraryName}
                onChange={(e) => setNewLibraryName(e.target.value)}
                placeholder="New library name"
                className="flex-1"
                data-testid="input-new-library-name"
              />
              <Button
                size="sm"
                onClick={() => {
                  if (newLibraryName.trim()) {
                    createLibraryMutation.mutate({ name: newLibraryName, description: newLibraryDesc || undefined });
                  }
                }}
                disabled={!newLibraryName.trim() || createLibraryMutation.isPending}
                data-testid="btn-create-library"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>
            <Separator />
            <div className="space-y-1 max-h-60 overflow-auto">
              {libraries.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No custom libraries yet</p>
              )}
              {libraries.map((lib) => (
                <div key={lib.id} className="flex items-center gap-2 p-2 rounded hover:bg-accent/50 group">
                  <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    {editLibrary?.id === lib.id ? (
                      <Input
                        value={editLibrary.name}
                        onChange={(e) => setEditLibrary({ ...editLibrary, name: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            updateLibraryMutation.mutate({ id: editLibrary.id, name: editLibrary.name, description: editLibrary.description || undefined });
                          }
                        }}
                        className="h-7 text-sm"
                        autoFocus
                        data-testid={`input-edit-library-${lib.id}`}
                      />
                    ) : (
                      <span className="text-sm truncate">{lib.name}</span>
                    )}
                  </div>
                  {editLibrary?.id === lib.id ? (
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => updateLibraryMutation.mutate({ id: editLibrary.id, name: editLibrary.name, description: editLibrary.description || undefined })}>
                      Save
                    </Button>
                  ) : (
                    <>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => setEditLibrary(lib)} data-testid={`btn-edit-library-${lib.id}`}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => setDeleteLibraryId(lib.id)} data-testid={`btn-delete-library-${lib.id}`}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteLibraryId} onOpenChange={() => setDeleteLibraryId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Library</AlertDialogTitle>
            <AlertDialogDescription>Items and assemblies in this library will be moved to "All Libraries". This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (deleteLibraryId) deleteLibraryMutation.mutate(deleteLibraryId); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
