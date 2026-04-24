/**
 * Task #1845 — Trash panel for soft-deleted plan-document markups.
 *
 * The toolbar's one-click "Undo delete" button (Task #1775) only knows
 * about the *most recent* delete batch on the current sheet, and its
 * banner auto-dismisses after a few seconds. Soft-deleted rows live
 * forever in `plan_document_markups` (the DELETE handler stamps
 * `deleted_at` rather than removing the row), but until now there was
 * no way for a user to browse, filter, or restore older deletions —
 * for example a markup deleted yesterday or by a teammate.
 *
 * This panel opens as a dialog from a "Trash" button next to the
 * MarkupLayersPanel. It:
 *   - Lists every soft-deleted markup for the current document,
 *     grouped by author and the day it was deleted.
 *   - Renders a tool icon + color swatch preview per row, the page
 *     number, and how long ago it was deleted.
 *   - Lets the user multi-select rows (with a per-group "select all"
 *     checkbox for the common "restore everything I deleted today" path).
 *   - Bulk-restores the selected rows via the new
 *     `POST /api/plan-documents/:docId/markups/restore-bulk` endpoint
 *     in a single round-trip; on success it invalidates both the live
 *     markups query and the trash query so the canvas re-paints
 *     without a manual refresh.
 *   - Shows a friendly empty state when nothing is in the trash.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  Trash2,
  Undo2,
  Square,
  Type as TypeIcon,
  Highlighter,
  ArrowRight,
  Cloud as CloudIcon,
  Pencil as PencilIcon,
} from "lucide-react";

import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";

/** Shape returned by `GET /api/plan-documents/:docId/markups/trash`. */
export interface TrashedMarkup {
  id: string;
  pageNumber: number;
  tool: string;
  color: string;
  thickness: number;
  text: string | null;
  createdBy: string | null;
  createdAt: string;
  deletedAt: string;
  layerId: string | null;
  groupId: string | null;
  authorFirstName: string | null;
  authorLastName: string | null;
  authorAvatarUrl: string | null;
}

/** Bucket of trash items sharing the same author + the same calendar
 *  day they were deleted. Drives the per-group header in the dialog. */
export interface TrashGroup {
  key: string;
  authorId: string | null;
  authorLabel: string;
  dateLabel: string;
  /** YYYY-MM-DD calendar day the deletes happened, used as the
   *  secondary sort key so groups appear newest-day-first. */
  dateKey: string;
  items: TrashedMarkup[];
}

export interface MarkupTrashPanelProps {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Map a markup tool to its toolbar icon so the trash row preview
 *  matches what the user drew on the sheet. Anything we don't
 *  recognise falls back to the generic pencil so an unknown future
 *  tool still renders something sensible instead of a broken icon. */
function ToolIcon({ tool, className }: { tool: string; className?: string }) {
  switch (tool) {
    case "ARROW":
      return <ArrowRight className={className} aria-hidden />;
    case "TEXT":
      return <TypeIcon className={className} aria-hidden />;
    case "RECTANGLE":
      return <Square className={className} aria-hidden />;
    case "HIGHLIGHT":
      return <Highlighter className={className} aria-hidden />;
    case "CLOUD":
      return <CloudIcon className={className} aria-hidden />;
    case "FREEHAND":
    default:
      return <PencilIcon className={className} aria-hidden />;
  }
}

/** Build the author display label. Falls back to the createdBy uuid
 *  (truncated) so a deleted user account still surfaces an identifier
 *  the admin can look up rather than rendering a blank "Unknown". */
function authorLabel(m: TrashedMarkup): string {
  const first = (m.authorFirstName ?? "").trim();
  const last = (m.authorLastName ?? "").trim();
  if (first || last) return `${first} ${last}`.trim();
  if (m.createdBy) return `User ${m.createdBy.slice(0, 8)}`;
  return "Unknown user";
}

/**
 * Group trash items by (author, calendar day they were deleted) and
 * sort newest-first. Exported so the panel test can assert grouping
 * without rendering the whole React tree.
 */
export function groupTrashedMarkups(items: TrashedMarkup[]): TrashGroup[] {
  const buckets = new Map<string, TrashGroup>();
  for (const it of items) {
    const date = new Date(it.deletedAt);
    if (Number.isNaN(date.getTime())) continue;
    // Calendar-day bucket in the user's local TZ; matches what they
    // see in "deleted N hours ago" so two deletes from the same
    // session always sit in the same group even if one happened a
    // few seconds before midnight.
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const authorId = it.createdBy ?? null;
    const key = `${authorId ?? "unknown"}::${dateKey}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.items.push(it);
    } else {
      buckets.set(key, {
        key,
        authorId,
        authorLabel: authorLabel(it),
        dateLabel: date.toLocaleDateString(undefined, {
          weekday: "long",
          month: "short",
          day: "numeric",
        }),
        dateKey,
        items: [it],
      });
    }
  }
  // Newest day first; within a day, newest delete first so the most
  // recent mistake is always at the top of the list.
  const groups = Array.from(buckets.values()).sort((a, b) =>
    b.dateKey.localeCompare(a.dateKey),
  );
  for (const g of groups) {
    g.items.sort(
      (a, b) =>
        new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime(),
    );
  }
  return groups;
}

export default function MarkupTrashPanel({
  documentId,
  open,
  onOpenChange,
}: MarkupTrashPanelProps) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const trashQueryKey = [
    "/api/plan-documents",
    documentId,
    "markups",
    "trash",
  ] as const;

  const { data: items = [], isLoading, isError, error } = useQuery<
    TrashedMarkup[]
  >({
    queryKey: trashQueryKey,
    queryFn: async () => {
      const r = await fetch(
        `/api/plan-documents/${encodeURIComponent(documentId)}/markups/trash`,
        { credentials: "include" },
      );
      // Surface non-OK responses as a query error so the panel can
      // distinguish "trash is empty" from "the request failed" (e.g. a
      // 401 / 403 / 5xx). Without this, both cases collapse to the
      // empty state and silently mask backend or auth failures.
      if (!r.ok) {
        let message = `Failed to load trash (${r.status})`;
        try {
          const body = await r.json();
          if (body && typeof body.error === "string") message = body.error;
        } catch {
          // ignore non-JSON error bodies
        }
        throw new Error(message);
      }
      return r.json();
    },
    // Only fetch when the dialog is actually open so closing the
    // panel doesn't leave a polling query in flight on the canvas.
    enabled: open && !!documentId,
  });

  const groups = useMemo(() => groupTrashedMarkups(items), [items]);

  const restoreMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const r = await apiRequest(
        "POST",
        `/api/plan-documents/${encodeURIComponent(documentId)}/markups/restore-bulk`,
        { ids },
      );
      return r.json() as Promise<{ ok: boolean; count: number }>;
    },
    onSuccess: (data, ids) => {
      // Refresh the trash list (rows we just restored should disappear)
      // AND the live markup list per page (so the canvas re-paints
      // them) without forcing the user to refresh.
      queryClient.invalidateQueries({ queryKey: trashQueryKey });
      queryClient.invalidateQueries({
        queryKey: ["/api/plan-documents", documentId, "markups"],
      });
      setSelectedIds(new Set());
      toast({
        title:
          data.count === 1
            ? "Restored 1 markup"
            : `Restored ${data.count} markups`,
        description:
          ids.length !== data.count
            ? `${ids.length - data.count} could not be restored.`
            : undefined,
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Could not restore markups",
        description: e.message,
        variant: "destructive",
      }),
  });

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleGroup = (group: TrashGroup, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const it of group.items) {
        if (checked) next.add(it.id);
        else next.delete(it.id);
      }
      return next;
    });
  };

  const isGroupAllSelected = (group: TrashGroup) =>
    group.items.length > 0 && group.items.every((it) => selectedIds.has(it.id));
  const isGroupSomeSelected = (group: TrashGroup) =>
    !isGroupAllSelected(group) && group.items.some((it) => selectedIds.has(it.id));

  const handleRestore = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    restoreMutation.mutate(ids);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl"
        data-testid="dialog-markup-trash"
      >
        <DialogHeader>
          <DialogTitle>Trash</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Markups deleted from this sheet. Select any number of items
            and choose Restore to bring them back to the canvas with
            their original layer, group, and shape intact.
          </p>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="pr-3">
            {isLoading && (
              <div
                className="px-2 py-6 text-sm text-muted-foreground"
                data-testid="text-markup-trash-loading"
              >
                Loading…
              </div>
            )}

            {!isLoading && isError && (
              <div
                className="px-2 py-6 text-sm text-destructive"
                data-testid="error-markup-trash"
              >
                {error instanceof Error
                  ? error.message
                  : "Could not load trash."}
              </div>
            )}

            {!isLoading && !isError && groups.length === 0 && (
              <div
                className="px-2 py-10 text-center"
                data-testid="empty-markup-trash"
              >
                <Trash2 className="w-8 h-8 mx-auto text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium">Trash is empty</p>
                <p className="text-xs text-muted-foreground">
                  Markups you delete from this sheet will show up here so
                  you can restore them later.
                </p>
              </div>
            )}

            {!isLoading &&
              groups.map((group) => {
                const allSelected = isGroupAllSelected(group);
                const someSelected = isGroupSomeSelected(group);
                return (
                  <div
                    key={group.key}
                    className="mb-4 last:mb-0"
                    data-testid={`group-markup-trash-${group.key}`}
                  >
                    <div className="flex items-center gap-2 px-2 py-1 bg-muted/40 rounded-sm">
                      <Checkbox
                        checked={
                          allSelected ? true : someSelected ? "indeterminate" : false
                        }
                        onCheckedChange={(v) =>
                          toggleGroup(group, v === true)
                        }
                        aria-label={`Select all markups deleted by ${group.authorLabel} on ${group.dateLabel}`}
                        data-testid={`checkbox-markup-trash-group-${group.key}`}
                      />
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="font-medium truncate">
                          {group.authorLabel}
                        </div>
                        <div className="text-muted-foreground truncate">
                          Deleted {group.dateLabel} · {group.items.length}{" "}
                          {group.items.length === 1 ? "markup" : "markups"}
                        </div>
                      </div>
                    </div>

                    <ul className="divide-y border-l ml-3 mt-1">
                      {group.items.map((it) => {
                        const checked = selectedIds.has(it.id);
                        const deletedAgo = (() => {
                          const t = new Date(it.deletedAt);
                          if (Number.isNaN(t.getTime())) return "";
                          return formatDistanceToNow(t, { addSuffix: true });
                        })();
                        return (
                          <li
                            key={it.id}
                            className="flex items-center gap-2 px-2 py-1.5"
                            data-testid={`row-markup-trash-${it.id}`}
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(v) =>
                                toggleOne(it.id, v === true)
                              }
                              aria-label={`Select ${it.tool.toLowerCase()} markup on page ${it.pageNumber}`}
                              data-testid={`checkbox-markup-trash-${it.id}`}
                            />
                            <span
                              className="inline-block w-3 h-3 rounded-sm border shrink-0"
                              style={{ background: it.color }}
                              aria-hidden
                              data-testid={`swatch-markup-trash-${it.id}`}
                            />
                            <ToolIcon
                              tool={it.tool}
                              className="w-4 h-4 text-muted-foreground shrink-0"
                            />
                            <div className="flex-1 min-w-0 text-xs">
                              <div
                                className="font-medium capitalize truncate"
                                data-testid={`text-markup-trash-tool-${it.id}`}
                              >
                                {it.tool.toLowerCase()}
                                {it.text ? ` — “${it.text}”` : ""}
                              </div>
                              <div className="text-muted-foreground truncate">
                                Page {it.pageNumber} · deleted {deletedAgo}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
          </div>
        </ScrollArea>

        <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
          <span
            className="text-xs text-muted-foreground"
            data-testid="text-markup-trash-selected-count"
          >
            {selectedIds.size === 0
              ? "No items selected"
              : selectedIds.size === 1
                ? "1 item selected"
                : `${selectedIds.size} items selected`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              data-testid="button-markup-trash-close"
            >
              Close
            </Button>
            <Button
              onClick={handleRestore}
              disabled={selectedIds.size === 0 || restoreMutation.isPending}
              data-testid="button-markup-trash-restore"
            >
              <Undo2 className="w-4 h-4 mr-1" />
              {restoreMutation.isPending
                ? "Restoring…"
                : `Restore selected${selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
