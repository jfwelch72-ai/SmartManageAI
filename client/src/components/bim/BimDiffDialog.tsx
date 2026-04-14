import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Plus, Minus, ArrowUpDown, Equal } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeExtractionDiff, type BimExtractionResult } from "@/utils/ifc-quantity-parser";

interface BimDiffDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  previousExtraction: BimExtractionResult;
  currentExtraction: BimExtractionResult;
}

export default function BimDiffDialog({
  open,
  onOpenChange,
  previousExtraction,
  currentExtraction,
}: BimDiffDialogProps) {
  const diff = useMemo(
    () => computeExtractionDiff(previousExtraction, currentExtraction),
    [previousExtraction, currentExtraction],
  );

  const hasChanges = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

  const formatDiff = (val: number, unit: string) => {
    if (val === 0) return null;
    const sign = val > 0 ? "+" : "";
    return `${sign}${val.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2" data-testid="text-diff-dialog-title">
            <ArrowUpDown className="w-5 h-5" />
            BIM Extraction Changes
          </DialogTitle>
        </DialogHeader>

        {!hasChanges ? (
          <div className="py-8 text-center">
            <Equal className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground" data-testid="text-no-changes">
              No changes detected between extractions.
            </p>
          </div>
        ) : (
          <ScrollArea className="flex-1 max-h-[500px]">
            <div className="space-y-4">
              {diff.added.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Plus className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-medium">Added ({diff.added.length})</span>
                  </div>
                  <div className="space-y-1">
                    {diff.added.map((group) => (
                      <div
                        key={group.displayName}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800"
                        data-testid={`row-diff-added-${group.ifcType}`}
                      >
                        <span className="font-medium text-sm flex-1">{group.displayName}</span>
                        <Badge variant="secondary">{group.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diff.removed.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Minus className="w-4 h-4 text-red-600" />
                    <span className="text-sm font-medium">Removed ({diff.removed.length})</span>
                  </div>
                  <div className="space-y-1">
                    {diff.removed.map((group) => (
                      <div
                        key={group.displayName}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
                        data-testid={`row-diff-removed-${group.ifcType}`}
                      >
                        <span className="font-medium text-sm flex-1 line-through">{group.displayName}</span>
                        <Badge variant="secondary">{group.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diff.changed.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <ArrowUpDown className="w-4 h-4 text-yellow-600" />
                    <span className="text-sm font-medium">Changed ({diff.changed.length})</span>
                  </div>
                  <div className="space-y-1">
                    {diff.changed.map((change) => (
                      <div
                        key={change.group.displayName}
                        className="flex items-center gap-3 px-3 py-2 rounded-md bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800"
                        data-testid={`row-diff-changed-${change.group.ifcType}`}
                      >
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-sm">{change.group.displayName}</span>
                          <div className="flex gap-3 mt-0.5 text-xs">
                            {change.countDiff !== 0 && (
                              <span className={cn(
                                change.countDiff > 0 ? "text-green-600" : "text-red-600"
                              )}>
                                Count: {change.countDiff > 0 ? "+" : ""}{change.countDiff}
                              </span>
                            )}
                            {change.lengthDiff !== 0 && (
                              <span className={cn(
                                change.lengthDiff > 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {formatDiff(change.lengthDiff, "ft")}
                              </span>
                            )}
                            {change.areaDiff !== 0 && (
                              <span className={cn(
                                change.areaDiff > 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {formatDiff(change.areaDiff, "ft²")}
                              </span>
                            )}
                            {change.volumeDiff !== 0 && (
                              <span className={cn(
                                change.volumeDiff > 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {formatDiff(change.volumeDiff, "ft³")}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground shrink-0">
                          {change.previousGroup.count} → {change.group.count}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diff.unchanged.length > 0 && (
                <div>
                  <Separator className="my-2" />
                  <div className="flex items-center gap-2 mb-2">
                    <Equal className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-muted-foreground">
                      Unchanged ({diff.unchanged.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {diff.unchanged.map((group) => (
                      <div
                        key={group.displayName}
                        className="flex items-center gap-3 px-3 py-1.5 rounded-md text-muted-foreground"
                        data-testid={`row-diff-unchanged-${group.ifcType}`}
                      >
                        <span className="text-sm flex-1">{group.displayName}</span>
                        <Badge variant="outline" className="text-xs">{group.count}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
