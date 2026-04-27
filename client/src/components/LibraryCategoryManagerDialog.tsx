import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowUp, ArrowDown, Pencil, Trash2, Check, X, Plus, Layers,
} from "lucide-react";
import type { LibraryCategory, LibraryItem } from "@shared/schema";
import { VALID_TRADE_TYPES, getTradeDisplayName, type TradeType } from "@shared/tradeTypeUtils";

interface LibraryCategoryManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  libraryId?: string;
  initialTradeType?: string;
}

const ALL_TRADES = "all";
const NO_TRADE = "__no_trade__";
const MOVE_UNCATEGORIZED = "__uncategorized__";

export default function LibraryCategoryManagerDialog({
  open,
  onOpenChange,
  libraryId,
  initialTradeType,
}: LibraryCategoryManagerDialogProps) {
  const { toast } = useToast();
  const libraryParam = libraryId && libraryId !== "all" ? libraryId : "all";

  const [selectedTrade, setSelectedTrade] = useState<string>(initialTradeType || ALL_TRADES);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<LibraryCategory | null>(null);
  const [moveTarget, setMoveTarget] = useState<string>(MOVE_UNCATEGORIZED);

  useEffect(() => {
    if (open) {
      setSelectedTrade(initialTradeType || ALL_TRADES);
      setEditingId(null);
      setNewName("");
      setPendingDelete(null);
    }
  }, [open, initialTradeType]);

  const categoriesUrl = `/api/library-categories?libraryId=${libraryParam}`;
  const { data: categories = [], isLoading } = useQuery<LibraryCategory[]>({
    queryKey: [categoriesUrl],
    enabled: open,
  });

  const itemsUrl = `/api/library-items?libraryId=${libraryParam}`;
  const { data: items = [] } = useQuery<LibraryItem[]>({
    queryKey: [itemsUrl],
    enabled: open,
  });

  const itemCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of items) {
      if (it.categoryId) {
        map.set(it.categoryId, (map.get(it.categoryId) || 0) + 1);
      }
    }
    return map;
  }, [items]);

  const visibleCategories = useMemo(() => {
    const filtered = categories.filter((c) => {
      if (selectedTrade === ALL_TRADES) return true;
      if (selectedTrade === NO_TRADE) return !c.tradeType;
      return c.tradeType === selectedTrade;
    });
    return [...filtered].sort((a, b) => {
      const ao = a.displayOrder ?? 0;
      const bo = b.displayOrder ?? 0;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name);
    });
  }, [categories, selectedTrade]);

  const tradeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of categories) {
      const key = c.tradeType || NO_TRADE;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const opts: { value: string; label: string; count: number }[] = [];
    for (const t of VALID_TRADE_TYPES) {
      opts.push({
        value: t,
        label: getTradeDisplayName(t as TradeType),
        count: counts.get(t) || 0,
      });
    }
    opts.push({ value: NO_TRADE, label: "No trade", count: counts.get(NO_TRADE) || 0 });
    return opts;
  }, [categories]);

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return typeof k === "string" && (k.startsWith("/api/library-categories") || k.startsWith("/api/library-items"));
      },
    });
  };

  const createMutation = useMutation({
    mutationFn: async (payload: { name: string; tradeType?: string | null; displayOrder: number }) => {
      const body: Record<string, unknown> = {
        name: payload.name,
        displayOrder: payload.displayOrder,
      };
      if (libraryId && libraryId !== "all") body.libraryId = libraryId;
      if (payload.tradeType) body.tradeType = payload.tradeType;
      const res = await apiRequest("POST", "/api/library-categories", body);
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setNewName("");
      toast({ title: "Category created" });
    },
    onError: (err: any) => {
      toast({ title: "Could not create category", description: err.message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest("PATCH", `/api/library-categories/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      invalidateAll();
      setEditingId(null);
      toast({ title: "Category renamed" });
    },
    onError: (err: any) => {
      toast({ title: "Could not rename", description: err.message, variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (updates: { id: string; displayOrder: number }[]) => {
      await Promise.all(
        updates.map((u) =>
          apiRequest("PATCH", `/api/library-categories/${u.id}`, { displayOrder: u.displayOrder })
        )
      );
    },
    onSuccess: () => {
      invalidateAll();
    },
    onError: (err: any) => {
      toast({ title: "Could not reorder", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, moveItemsTo }: { id: string; moveItemsTo: string | null }) => {
      const itemsToMove = items.filter((i) => i.categoryId === id);
      if (itemsToMove.length > 0) {
        await Promise.all(
          itemsToMove.map((i) =>
            apiRequest("PATCH", `/api/library-items/${i.id}`, { categoryId: moveItemsTo })
          )
        );
      }
      await apiRequest("DELETE", `/api/library-categories/${id}`);
    },
    onSuccess: () => {
      invalidateAll();
      setPendingDelete(null);
      setMoveTarget(MOVE_UNCATEGORIZED);
      toast({ title: "Category deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Could not delete", description: err.message, variant: "destructive" });
    },
  });

  const handleStartEdit = (cat: LibraryCategory) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const handleSaveEdit = () => {
    if (!editingId || !editingName.trim()) return;
    renameMutation.mutate({ id: editingId, name: editingName.trim() });
  };

  const handleMove = (idx: number, direction: -1 | 1) => {
    const target = idx + direction;
    if (target < 0 || target >= visibleCategories.length) return;
    const a = visibleCategories[idx];
    const b = visibleCategories[target];
    const aOrder = a.displayOrder ?? idx;
    const bOrder = b.displayOrder ?? target;
    // If both share the same displayOrder we still produce a deterministic swap.
    const newAOrder = bOrder === aOrder ? aOrder + direction : bOrder;
    const newBOrder = bOrder === aOrder ? aOrder : aOrder;
    reorderMutation.mutate([
      { id: a.id, displayOrder: newAOrder },
      { id: b.id, displayOrder: newBOrder },
    ]);
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    const tradeType =
      selectedTrade === ALL_TRADES || selectedTrade === NO_TRADE ? null : selectedTrade;
    const nextOrder = visibleCategories.length
      ? Math.max(...visibleCategories.map((c) => c.displayOrder ?? 0)) + 1
      : 0;
    createMutation.mutate({ name: newName.trim(), tradeType, displayOrder: nextOrder });
  };

  const moveTargetOptions = useMemo(() => {
    if (!pendingDelete) return [];
    return categories.filter(
      (c) =>
        c.id !== pendingDelete.id &&
        (c.tradeType || null) === (pendingDelete.tradeType || null)
    );
  }, [categories, pendingDelete]);

  const pendingDeleteItemCount = pendingDelete
    ? itemCountByCategory.get(pendingDelete.id) || 0
    : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg" data-testid="dialog-manage-categories">
          <DialogHeader>
            <DialogTitle>Manage Categories</DialogTitle>
            <DialogDescription>
              Rename, reorder, or remove categories. Items in a deleted category can be moved to
              another category first.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label className="text-xs">Trade</Label>
              <Select value={selectedTrade} onValueChange={setSelectedTrade}>
                <SelectTrigger className="h-8 text-sm" data-testid="select-manage-trade">
                  <SelectValue placeholder="All trades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TRADES}>All trades</SelectItem>
                  {tradeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                      {opt.count > 0 ? ` (${opt.count})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">New category name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={
                    selectedTrade === ALL_TRADES
                      ? "Pick a trade above to add a category"
                      : "e.g. Concrete forms"
                  }
                  disabled={selectedTrade === ALL_TRADES}
                  className="h-8 text-sm"
                  data-testid="input-new-category-name"
                />
              </div>
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={
                  selectedTrade === ALL_TRADES ||
                  !newName.trim() ||
                  createMutation.isPending
                }
                data-testid="btn-create-category"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Add
              </Button>
            </div>

            {selectedTrade === ALL_TRADES && (
              <p className="text-[11px] text-muted-foreground">
                Showing categories from all trades. Pick a trade above to reorder
                within it.
              </p>
            )}

            <ScrollArea className="h-[320px] border rounded-md">
              <div className="p-2 space-y-1">
                {isLoading && (
                  <p className="text-xs text-muted-foreground text-center py-6">Loading…</p>
                )}
                {!isLoading && visibleCategories.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    No categories yet for this trade.
                  </p>
                )}
                {visibleCategories.map((cat, idx) => {
                  const count = itemCountByCategory.get(cat.id) || 0;
                  const isEditing = editingId === cat.id;
                  return (
                    <div
                      key={cat.id}
                      className="flex items-center gap-1 p-2 rounded hover:bg-accent/40 group"
                      data-testid={`row-category-${cat.id}`}
                    >
                      <Layers className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <Input
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveEdit();
                              } else if (e.key === "Escape") {
                                setEditingId(null);
                              }
                            }}
                            autoFocus
                            className="h-7 text-sm"
                            data-testid={`input-edit-category-${cat.id}`}
                          />
                        ) : (
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm truncate" data-testid={`text-category-name-${cat.id}`}>
                              {cat.name}
                            </span>
                            {selectedTrade === ALL_TRADES && cat.tradeType && (
                              <Badge variant="outline" className="text-[10px] h-4 px-1">
                                {getTradeDisplayName(cat.tradeType as TradeType)}
                              </Badge>
                            )}
                            <Badge variant="secondary" className="text-[10px] h-4 px-1">
                              {count} item{count === 1 ? "" : "s"}
                            </Badge>
                          </div>
                        )}
                      </div>
                      {isEditing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={handleSaveEdit}
                            disabled={!editingName.trim() || renameMutation.isPending}
                            data-testid={`btn-save-category-${cat.id}`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditingId(null)}
                            data-testid={`btn-cancel-category-${cat.id}`}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleMove(idx, -1)}
                            disabled={
                              selectedTrade === ALL_TRADES ||
                              idx === 0 ||
                              reorderMutation.isPending
                            }
                            title={
                              selectedTrade === ALL_TRADES
                                ? "Pick a trade to reorder"
                                : "Move up"
                            }
                            data-testid={`btn-move-up-${cat.id}`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleMove(idx, 1)}
                            disabled={
                              selectedTrade === ALL_TRADES ||
                              idx === visibleCategories.length - 1 ||
                              reorderMutation.isPending
                            }
                            title={
                              selectedTrade === ALL_TRADES
                                ? "Pick a trade to reorder"
                                : "Move down"
                            }
                            data-testid={`btn-move-down-${cat.id}`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleStartEdit(cat)}
                            title="Rename"
                            data-testid={`btn-rename-category-${cat.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive"
                            onClick={() => {
                              setPendingDelete(cat);
                              setMoveTarget(MOVE_UNCATEGORIZED);
                            }}
                            title="Delete"
                            data-testid={`btn-delete-category-${cat.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-close-category-manager">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o) {
            setPendingDelete(null);
            setMoveTarget(MOVE_UNCATEGORIZED);
          }
        }}
      >
        <AlertDialogContent data-testid="dialog-confirm-delete-category">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete category {pendingDelete ? `“${pendingDelete.name}”` : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {pendingDeleteItemCount > 0 ? (
                  <>
                    <p>
                      This category has {pendingDeleteItemCount} item
                      {pendingDeleteItemCount === 1 ? "" : "s"}. Choose where to move them
                      first.
                    </p>
                    <div>
                      <Label className="text-xs">Move items to</Label>
                      <Select value={moveTarget} onValueChange={setMoveTarget}>
                        <SelectTrigger className="h-8 text-sm" data-testid="select-move-target">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={MOVE_UNCATEGORIZED}>Uncategorized</SelectItem>
                          {moveTargetOptions.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : (
                  <p>This category is empty. It will be permanently removed.</p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="btn-cancel-delete-category">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingDelete) return;
                deleteMutation.mutate({
                  id: pendingDelete.id,
                  moveItemsTo: moveTarget === MOVE_UNCATEGORIZED ? null : moveTarget,
                });
              }}
              disabled={deleteMutation.isPending}
              data-testid="btn-confirm-delete-category"
            >
              {pendingDeleteItemCount > 0 ? "Move items & delete" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
