import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LibraryCategory } from "@shared/schema";
import { getTradeDisplayName, type TradeType } from "@shared/tradeTypeUtils";

interface MoveToCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: LibraryCategory[];
  selectedCount: number;
  targetCategoryId: string;
  setTargetCategoryId: (id: string) => void;
  onConfirm: () => void;
  isPending: boolean;
  /** Distinguishes the two consumers' option/button test-ids. */
  testIdPrefix?: string;
}

export function MoveToCategoryDialog({
  open,
  onOpenChange,
  categories,
  selectedCount,
  targetCategoryId,
  setTargetCategoryId,
  onConfirm,
  isPending,
  testIdPrefix = "",
}: MoveToCategoryDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onOpenChange(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move items to category</DialogTitle>
          <DialogDescription>
            Re-bucket {selectedCount} selected{" "}
            {selectedCount === 1 ? "item" : "items"} into a different category.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <Label>Destination category</Label>
          <Select value={targetCategoryId} onValueChange={setTargetCategoryId}>
            <SelectTrigger data-testid={`select-${testIdPrefix}bulk-move-target`}>
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
                  const tradeLabel = c.tradeType
                    ? getTradeDisplayName(c.tradeType as TradeType)
                    : "Other";
                  return (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      data-testid={`option-${testIdPrefix}bulk-move-${c.id}`}
                    >
                      {tradeLabel} · {c.name}
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!targetCategoryId || isPending || selectedCount === 0}
            onClick={onConfirm}
            data-testid={`btn-confirm-${testIdPrefix}bulk-move`}
          >
            {isPending ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
