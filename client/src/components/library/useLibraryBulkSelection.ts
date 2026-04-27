import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SelectableItem {
  id: string;
}

interface UseLibraryBulkSelectionOptions<T extends SelectableItem> {
  filteredItems: T[];
  onMoveSuccess?: () => void;
  invalidateItems?: () => void;
}

const defaultInvalidateItems = () =>
  queryClient.invalidateQueries({
    predicate: (q) => (q.queryKey[0] as string)?.startsWith("/api/library-items"),
  });

export function useLibraryBulkSelection<T extends SelectableItem>({
  filteredItems,
  onMoveSuccess,
  invalidateItems,
}: UseLibraryBulkSelectionOptions<T>) {
  const { toast } = useToast();
  const runInvalidate = invalidateItems ?? defaultInvalidateItems;

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [bulkMoveTargetCategoryId, setBulkMoveTargetCategoryId] = useState<string>("");
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
  }, []);

  const toggleItemSelected = useCallback((id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isAllSelected = useMemo(
    () => selectedItemIds.size > 0 && selectedItemIds.size === filteredItems.length,
    [selectedItemIds, filteredItems],
  );

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) setSelectedItemIds(new Set(filteredItems.map((i) => i.id)));
      else setSelectedItemIds(new Set());
    },
    [filteredItems],
  );

  const closeBulkMoveDialog = useCallback(() => {
    setShowBulkMoveDialog(false);
    setBulkMoveTargetCategoryId("");
  }, []);

  const openBulkMoveDialog = useCallback(() => {
    setBulkMoveTargetCategoryId("");
    setShowBulkMoveDialog(true);
  }, []);

  const openBulkDeleteConfirm = useCallback(() => {
    setShowBulkDeleteConfirm(true);
  }, []);

  const closeBulkDeleteConfirm = useCallback(() => {
    setShowBulkDeleteConfirm(false);
  }, []);

  const bulkMoveMutation = useMutation({
    mutationFn: async (payload: { ids: string[]; categoryId: string | null }) => {
      const res = await apiRequest("PATCH", "/api/library-items/bulk", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      runInvalidate();
      closeBulkMoveDialog();
      exitSelectionMode();
      onMoveSuccess?.();
      toast({
        title: "Items moved",
        description: `Re-bucketed ${data?.updated ?? 0} items.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Move failed",
        description: err?.message || "Could not move items",
        variant: "destructive",
      });
    },
  });

  // Task #2113 — bulk delete selected library items in a single round-trip.
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("DELETE", "/api/library-items/bulk", { ids });
      return res.json();
    },
    onSuccess: (data: any) => {
      runInvalidate();
      setShowBulkDeleteConfirm(false);
      exitSelectionMode();
      toast({
        title: "Items deleted",
        description: `Deleted ${data?.deleted ?? 0} items.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Delete failed",
        description: err?.message || "Could not delete items",
        variant: "destructive",
      });
    },
  });

  // Task #2113 — bulk duplicate selected library items as custom (non-prebuilt)
  // copies so estimators can edit them.
  const bulkDuplicateMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await apiRequest("POST", "/api/library-items/bulk-duplicate", { ids });
      return res.json();
    },
    onSuccess: (data: any) => {
      runInvalidate();
      exitSelectionMode();
      toast({
        title: "Items duplicated",
        description: `Created ${data?.duplicated ?? 0} copies.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Duplicate failed",
        description: err?.message || "Could not duplicate items",
        variant: "destructive",
      });
    },
  });

  const submitBulkMove = useCallback(() => {
    if (!bulkMoveTargetCategoryId || selectedItemIds.size === 0) return;
    bulkMoveMutation.mutate({
      ids: Array.from(selectedItemIds),
      categoryId:
        bulkMoveTargetCategoryId === "__uncategorized__" ? null : bulkMoveTargetCategoryId,
    });
  }, [bulkMoveMutation, bulkMoveTargetCategoryId, selectedItemIds]);

  const submitBulkDelete = useCallback(() => {
    if (selectedItemIds.size === 0) return;
    bulkDeleteMutation.mutate(Array.from(selectedItemIds));
  }, [bulkDeleteMutation, selectedItemIds]);

  const submitBulkDuplicate = useCallback(() => {
    if (selectedItemIds.size === 0) return;
    bulkDuplicateMutation.mutate(Array.from(selectedItemIds));
  }, [bulkDuplicateMutation, selectedItemIds]);

  return {
    selectionMode,
    setSelectionMode,
    exitSelectionMode,
    selectedItemIds,
    setSelectedItemIds,
    toggleItemSelected,
    isAllSelected,
    toggleSelectAll,
    showBulkMoveDialog,
    setShowBulkMoveDialog,
    openBulkMoveDialog,
    closeBulkMoveDialog,
    bulkMoveTargetCategoryId,
    setBulkMoveTargetCategoryId,
    bulkMoveMutation,
    submitBulkMove,
    showBulkDeleteConfirm,
    openBulkDeleteConfirm,
    closeBulkDeleteConfirm,
    bulkDeleteMutation,
    submitBulkDelete,
    bulkDuplicateMutation,
    submitBulkDuplicate,
  };
}

export type LibraryBulkSelection<T extends SelectableItem = SelectableItem> = ReturnType<
  typeof useLibraryBulkSelection<T>
>;
