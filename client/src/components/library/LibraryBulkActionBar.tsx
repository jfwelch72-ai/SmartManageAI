import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, FolderInput, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LibraryBulkActionBarProps {
  selectedCount: number;
  isAllSelected: boolean;
  onToggleAll: (checked: boolean) => void;
  onMove: () => void;
  /** Task #2113 — when provided, render a Duplicate button beside Move. */
  onDuplicate?: () => void;
  isDuplicatePending?: boolean;
  /** Task #2113 — when provided, render a Delete button. Caller owns the confirm dialog. */
  onDelete?: () => void;
  testIdPrefix: string;
  /** Compact variant matches the bid sidebar's tighter spacing. */
  compact?: boolean;
  moveLabel?: string;
}

export function LibraryBulkActionBar({
  selectedCount,
  isAllSelected,
  onToggleAll,
  onMove,
  onDuplicate,
  isDuplicatePending,
  onDelete,
  testIdPrefix,
  compact,
  moveLabel,
}: LibraryBulkActionBarProps) {
  const label = moveLabel ?? (compact ? "Move…" : "Move to category…");
  const btnSize = compact ? "h-5 text-[11px] px-1.5" : "h-6 text-xs px-2";
  const duplicateLabel = compact ? (isDuplicatePending ? "…" : "Duplicate") : isDuplicatePending ? "Duplicating…" : "Duplicate";
  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded bg-accent/60 border border-border/60",
        compact ? "px-1.5 py-1" : "px-2 py-1",
      )}
      data-testid={`${testIdPrefix}bulk-action-bar`}
    >
      <Checkbox
        checked={isAllSelected}
        onCheckedChange={(v) => onToggleAll(!!v)}
        className={compact ? "h-3.5 w-3.5" : undefined}
        data-testid={`checkbox-${testIdPrefix}select-all-items`}
      />
      <span
        className={cn("flex-1", compact ? "text-[11px]" : "text-xs")}
        data-testid={`text-${testIdPrefix}selected-count`}
      >
        {selectedCount} selected
      </span>
      <Button
        variant="default"
        size="sm"
        className={btnSize}
        disabled={selectedCount === 0}
        onClick={onMove}
        data-testid={`btn-${testIdPrefix}bulk-move`}
      >
        <FolderInput className="h-3 w-3 mr-1" /> {label}
      </Button>
      {onDuplicate && (
        <Button
          variant="secondary"
          size="sm"
          className={btnSize}
          disabled={selectedCount === 0 || !!isDuplicatePending}
          onClick={onDuplicate}
          data-testid={`btn-${testIdPrefix}bulk-duplicate`}
        >
          <Copy className="h-3 w-3 mr-1" />
          {duplicateLabel}
        </Button>
      )}
      {onDelete && (
        <Button
          variant="destructive"
          size="sm"
          className={btnSize}
          disabled={selectedCount === 0}
          onClick={onDelete}
          data-testid={`btn-${testIdPrefix}bulk-delete`}
        >
          <Trash2 className="h-3 w-3 mr-1" /> Delete
        </Button>
      )}
    </div>
  );
}
