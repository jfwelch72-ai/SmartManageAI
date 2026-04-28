// Task #2139 — Tool Chest UI
//
// Single source of truth for the takeoff tool chest:
//   - the (kind, refId) pointer protocol used by drag/drop
//   - the React-Query hooks that read & mutate /api/takeoff/tool-chest
//
// The chest is the only consumer of takeoffToolChestRoutes; everything
// in the UI funnels through this module so the API surface lives in
// exactly one place.
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { TakeoffToolChestItem } from "@shared/schema";

export const CHEST_QUERY_KEY = ["/api/takeoff/tool-chest"] as const;

export const CHEST_DRAG_MIME = "application/x-takeoff-chest-item+json";

export type ChestItemKind = "tool" | "condition" | "assembly";

/** Payload written to dataTransfer when dragging a chest item onto
 *  the canvas. Identity is `(kind, refId)` per the architectural
 *  constraint: never snapshot the source. */
export interface ChestItemDragPayload {
  kind: ChestItemKind;
  refId: string;
  color?: string | null;
  label?: string | null;
  /** Originating chest row id — purely for telemetry / lastUsedAt. */
  chestId?: string | null;
}

export function readChestPayload(dt: DataTransfer | null): ChestItemDragPayload | null {
  if (!dt) return null;
  const raw = dt.getData(CHEST_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ChestItemDragPayload;
    if (parsed && typeof parsed.kind === "string" && typeof parsed.refId === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

export function writeChestPayload(dt: DataTransfer, payload: ChestItemDragPayload) {
  dt.setData(CHEST_DRAG_MIME, JSON.stringify(payload));
  dt.effectAllowed = "copy";
}

export function useChestItems(enabled: boolean = true) {
  return useQuery<TakeoffToolChestItem[]>({
    queryKey: CHEST_QUERY_KEY,
    enabled,
  });
}

export interface PinToChestInput {
  kind: ChestItemKind;
  refId: string;
  label?: string | null;
  color?: string | null;
  shortcut?: string | null;
}

export function usePinToChest(opts?: {
  onSuccess?: (item: TakeoffToolChestItem, input: PinToChestInput) => void;
  onError?: (err: unknown, input: PinToChestInput) => void;
}) {
  return useMutation<TakeoffToolChestItem, Error, PinToChestInput>({
    mutationFn: async (input) => {
      const res = await apiRequest("POST", "/api/takeoff/tool-chest", {
        itemKind: input.kind,
        itemId: input.refId,
        label: input.label ?? null,
        color: input.color ?? null,
        shortcut: input.shortcut ?? null,
        sortOrder: 0,
        isShared: false,
      });
      return res.json();
    },
    onSuccess: (item, input) => {
      queryClient.invalidateQueries({ queryKey: CHEST_QUERY_KEY });
      opts?.onSuccess?.(item, input);
    },
    onError: (err, input) => {
      opts?.onError?.(err, input);
    },
  });
}

export interface UpdateChestItemInput {
  id: string;
  patch: Partial<{
    label: string | null;
    color: string | null;
    shortcut: string | null;
    isShared: boolean;
    sortOrder: number;
    lastUsedAt: string;
  }>;
}

export function useUpdateChestItem() {
  return useMutation<TakeoffToolChestItem, Error, UpdateChestItemInput, { previous?: TakeoffToolChestItem[] }>({
    mutationFn: async ({ id, patch }) => {
      const res = await apiRequest("PATCH", `/api/takeoff/tool-chest/${id}`, patch);
      return res.json();
    },
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: CHEST_QUERY_KEY });
      const previous = queryClient.getQueryData<TakeoffToolChestItem[]>(CHEST_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<TakeoffToolChestItem[]>(
          CHEST_QUERY_KEY,
          previous.map((item) =>
            item.id === id ? { ...item, ...patch } as TakeoffToolChestItem : item,
          ),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(CHEST_QUERY_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CHEST_QUERY_KEY });
    },
  });
}

export function useUnpinFromChest() {
  return useMutation<void, Error, { id: string }, { previous?: TakeoffToolChestItem[] }>({
    mutationFn: async ({ id }) => {
      await apiRequest("DELETE", `/api/takeoff/tool-chest/${id}`);
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: CHEST_QUERY_KEY });
      const previous = queryClient.getQueryData<TakeoffToolChestItem[]>(CHEST_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<TakeoffToolChestItem[]>(
          CHEST_QUERY_KEY,
          previous.filter((i) => i.id !== id),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(CHEST_QUERY_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CHEST_QUERY_KEY });
    },
  });
}

export interface ReorderChestInput {
  /** Final ordered list of item ids belonging to the *current user*.
   *  Shared-by-org items (owned by other users) cannot be reordered. */
  orderedIds: string[];
}

export function useReorderChest() {
  return useMutation<{ updated: number }, Error, ReorderChestInput, { previous?: TakeoffToolChestItem[] }>({
    mutationFn: async ({ orderedIds }) => {
      const items = orderedIds.map((id, idx) => ({ id, sortOrder: idx }));
      const res = await apiRequest("POST", "/api/takeoff/tool-chest/reorder", { items });
      return res.json();
    },
    onMutate: async ({ orderedIds }) => {
      await queryClient.cancelQueries({ queryKey: CHEST_QUERY_KEY });
      const previous = queryClient.getQueryData<TakeoffToolChestItem[]>(CHEST_QUERY_KEY);
      if (previous) {
        const orderMap = new Map(orderedIds.map((id, idx) => [id, idx]));
        // Reorder owned items locally; leave shared/non-owned items
        // where they are (they sort by their own sortOrder + createdAt).
        const sorted = [...previous].sort((a, b) => {
          const ai = orderMap.get(a.id);
          const bi = orderMap.get(b.id);
          if (ai !== undefined && bi !== undefined) return ai - bi;
          if (ai !== undefined) return -1;
          if (bi !== undefined) return 1;
          return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
        });
        queryClient.setQueryData<TakeoffToolChestItem[]>(
          CHEST_QUERY_KEY,
          sorted.map((item) => {
            const idx = orderMap.get(item.id);
            return idx === undefined ? item : { ...item, sortOrder: idx };
          }),
        );
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(CHEST_QUERY_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: CHEST_QUERY_KEY });
    },
  });
}

/** Helper: filter items for a section. Shared items by other users
 *  surface only in the per-section "Shared by org" subsection. */
export function partitionChestItems(
  items: TakeoffToolChestItem[],
  currentUserId: string | null | undefined,
): {
  byKind: Record<ChestItemKind, { mine: TakeoffToolChestItem[]; shared: TakeoffToolChestItem[] }>;
  total: number;
} {
  const byKind: Record<ChestItemKind, { mine: TakeoffToolChestItem[]; shared: TakeoffToolChestItem[] }> = {
    tool: { mine: [], shared: [] },
    condition: { mine: [], shared: [] },
    assembly: { mine: [], shared: [] },
  };
  for (const item of items) {
    const kind = (item.itemKind as ChestItemKind);
    if (!byKind[kind]) continue;
    const ownedByMe = currentUserId && item.userId === currentUserId;
    if (ownedByMe) {
      byKind[kind].mine.push(item);
    } else {
      // Items returned by the API are either owned by me OR shared
      // with my org (server filters by user OR isShared). Anything
      // not mine here is by definition org-shared.
      byKind[kind].shared.push(item);
    }
  }
  // Sort each bucket by sortOrder asc.
  for (const kind of Object.keys(byKind) as ChestItemKind[]) {
    byKind[kind].mine.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    byKind[kind].shared.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  }
  return { byKind, total: items.length };
}
