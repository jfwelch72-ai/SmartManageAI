import { Button } from "@/components/ui/button";
import { CheckSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface LibraryBulkSelectToggleProps {
  selectionMode: boolean;
  onToggle: () => void;
  testId: string;
  /** Compact variant matches the bid sidebar's tighter spacing. */
  compact?: boolean;
}

export function LibraryBulkSelectToggle({
  selectionMode,
  onToggle,
  testId,
  compact,
}: LibraryBulkSelectToggleProps) {
  return (
    <Button
      variant={selectionMode ? "secondary" : "ghost"}
      size="sm"
      className={cn(
        compact ? "text-[11px] h-6 px-1.5" : "text-xs h-7 px-2",
      )}
      onClick={onToggle}
      title={selectionMode ? "Exit selection mode" : "Select items to bulk-edit"}
      data-testid={testId}
    >
      {selectionMode ? (
        <X className="h-3 w-3 mr-1" />
      ) : (
        <CheckSquare className="h-3 w-3 mr-1" />
      )}
      {selectionMode ? "Done" : "Select"}
    </Button>
  );
}
