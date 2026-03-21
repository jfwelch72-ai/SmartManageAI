import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { History, ArrowLeftRight, ChevronDown, ChevronUp } from "lucide-react";

interface VersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
  savedByUserId: string;
  totalCost: number;
  lineItemCount: number;
}

interface SnapshotLineItem {
  id: string;
  description: string;
  category: string;
  unit: string;
  quantity: string | number;
  unitCost?: string | number;
  totalCost: string | number;
  laborCost?: string | number;
  materialCost?: string | number;
}

interface VersionDetail {
  id: string;
  versionNumber: number;
  createdAt: string;
  snapshot: string;
  parsed: {
    savedByUserId: string;
    totalCost: number;
    lineItemCount: number;
    lineItems: SnapshotLineItem[];
  };
}

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bidCode: string;
  estimateId: string;
}

function formatCost(val: string | number | undefined): string {
  const n = Number(val || 0);
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function diffVersions(
  olderItems: SnapshotLineItem[],
  newerItems: SnapshotLineItem[],
) {
  const olderMap = new Map(olderItems.map((item) => [item.id, item]));
  const newerMap = new Map(newerItems.map((item) => [item.id, item]));

  const added: SnapshotLineItem[] = [];
  const removed: SnapshotLineItem[] = [];
  const changed: Array<{ older: SnapshotLineItem; newer: SnapshotLineItem }> = [];
  const unchanged: SnapshotLineItem[] = [];

  for (const [id, newerItem] of newerMap) {
    const olderItem = olderMap.get(id);
    if (!olderItem) {
      added.push(newerItem);
    } else {
      const qChanged = Number(olderItem.quantity) !== Number(newerItem.quantity);
      const ucChanged = Number(olderItem.unitCost || 0) !== Number(newerItem.unitCost || 0);
      const tcChanged = Number(olderItem.totalCost) !== Number(newerItem.totalCost);
      if (qChanged || ucChanged || tcChanged) {
        changed.push({ older: olderItem, newer: newerItem });
      } else {
        unchanged.push(newerItem);
      }
    }
  }

  for (const [id, olderItem] of olderMap) {
    if (!newerMap.has(id)) {
      removed.push(olderItem);
    }
  }

  return { added, removed, changed, unchanged };
}

export default function EstimateRevisionHistory({ open, onOpenChange, bidCode, estimateId }: Props) {
  const [compareA, setCompareA] = useState<string>("");
  const [compareB, setCompareB] = useState<string>("");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { data: versions = [], isLoading } = useQuery<VersionSummary[]>({
    queryKey: ["/api/bids", bidCode, "estimates", estimateId, "versions"],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidCode}/estimates/${estimateId}/versions`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch versions");
      return res.json();
    },
    enabled: open && !!estimateId,
  });

  const { data: usersData = [] } = useQuery<UserOption[]>({
    queryKey: ["/api/users"],
    enabled: open,
  });

  const userMap = new Map(usersData.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

  const { data: versionADetail } = useQuery<VersionDetail>({
    queryKey: ["/api/bids", bidCode, "estimates", estimateId, "versions", compareA],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidCode}/estimates/${estimateId}/versions/${compareA}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch version detail");
      return res.json();
    },
    enabled: !!compareA,
  });

  const { data: versionBDetail } = useQuery<VersionDetail>({
    queryKey: ["/api/bids", bidCode, "estimates", estimateId, "versions", compareB],
    queryFn: async () => {
      const res = await fetch(`/api/bids/${bidCode}/estimates/${estimateId}/versions/${compareB}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch version detail");
      return res.json();
    },
    enabled: !!compareB,
  });

  const isComparing = !!compareA && !!compareB && !!versionADetail && !!versionBDetail;
  let diff: ReturnType<typeof diffVersions> | null = null;
  let olderVersion: VersionDetail | null = null;
  let newerVersion: VersionDetail | null = null;
  let costDelta = 0;

  if (isComparing) {
    const aNum = versionADetail.versionNumber;
    const bNum = versionBDetail.versionNumber;
    olderVersion = aNum < bNum ? versionADetail : versionBDetail;
    newerVersion = aNum < bNum ? versionBDetail : versionADetail;
    diff = diffVersions(olderVersion.parsed.lineItems, newerVersion.parsed.lineItems);
    costDelta = newerVersion.parsed.totalCost - olderVersion.parsed.totalCost;
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Revision History
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Loading revision history...
          </div>
        ) : versions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No revisions saved yet. Revisions are created automatically when you add, edit, or delete line items.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">
                {versions.length} revision{versions.length === 1 ? "" : "s"} saved
              </p>
              <div className="space-y-2">
                {versions.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-md border p-3"
                    data-testid={`revision-item-${v.versionNumber}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Badge variant="outline" className="font-mono shrink-0">
                        v{v.versionNumber}
                      </Badge>
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatCost(v.totalCost)}
                          <span className="text-muted-foreground font-normal ml-2 text-xs">
                            ({v.lineItemCount} item{v.lineItemCount === 1 ? "" : "s"})
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {format(new Date(v.createdAt), "MMM d, yyyy h:mm a")}
                          {v.savedByUserId && (
                            <> · {userMap.get(v.savedByUserId) || `User ${v.savedByUserId.slice(0, 8)}`}</>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {versions.length >= 2 && (
              <div className="border rounded-lg p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Compare Revisions</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Version A</label>
                    <Select value={compareA} onValueChange={setCompareA}>
                      <SelectTrigger data-testid="select-compare-version-a">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            v{v.versionNumber} — {formatCost(v.totalCost)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Version B</label>
                    <Select value={compareB} onValueChange={setCompareB}>
                      <SelectTrigger data-testid="select-compare-version-b">
                        <SelectValue placeholder="Select version" />
                      </SelectTrigger>
                      <SelectContent>
                        {versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            v{v.versionNumber} — {formatCost(v.totalCost)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {isComparing && diff && olderVersion && newerVersion && (
                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Comparing <span className="font-mono font-semibold">v{olderVersion.versionNumber}</span> → <span className="font-mono font-semibold">v{newerVersion.versionNumber}</span>
                      </p>
                      <Badge
                        className={costDelta > 0
                          ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                          : costDelta < 0
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-muted text-muted-foreground"
                        }
                        data-testid="text-cost-delta"
                      >
                        {costDelta > 0 ? "+" : ""}{formatCost(Math.abs(costDelta))} {costDelta > 0 ? "increase" : costDelta < 0 ? "decrease" : "no change"}
                      </Badge>
                    </div>

                    {diff.added.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wide">
                          Added ({diff.added.length})
                        </p>
                        <div className="rounded border divide-y">
                          {diff.added.map((item) => (
                            <div key={item.id} className="px-3 py-2 bg-green-50 dark:bg-green-950/20" data-testid={`diff-added-${item.id}`}>
                              <p className="text-sm font-medium text-green-800 dark:text-green-300">{item.description}</p>
                              <p className="text-xs text-green-700 dark:text-green-400">
                                Qty: {item.quantity} {item.unit} · Total: {formatCost(item.totalCost)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {diff.removed.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide">
                          Removed ({diff.removed.length})
                        </p>
                        <div className="rounded border divide-y">
                          {diff.removed.map((item) => (
                            <div key={item.id} className="px-3 py-2 bg-red-50 dark:bg-red-950/20" data-testid={`diff-removed-${item.id}`}>
                              <p className="text-sm font-medium text-red-800 dark:text-red-300 line-through">{item.description}</p>
                              <p className="text-xs text-red-700 dark:text-red-400">
                                Qty: {item.quantity} {item.unit} · Total: {formatCost(item.totalCost)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {diff.changed.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">
                          Changed ({diff.changed.length})
                        </p>
                        <div className="rounded border divide-y">
                          {diff.changed.map(({ older, newer }) => (
                            <div key={newer.id} className="px-3 py-2 bg-amber-50 dark:bg-amber-950/20 space-y-1" data-testid={`diff-changed-${newer.id}`}>
                              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{newer.description}</p>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <p className="text-muted-foreground">Qty</p>
                                  <p className="font-mono">
                                    {Number(older.quantity) !== Number(newer.quantity) ? (
                                      <><span className="line-through text-red-600 dark:text-red-400">{older.quantity}</span> → {newer.quantity}</>
                                    ) : (
                                      <>{newer.quantity} {newer.unit}</>
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Unit Cost</p>
                                  <p className="font-mono">
                                    {Number(older.unitCost || 0) !== Number(newer.unitCost || 0) ? (
                                      <><span className="line-through text-red-600 dark:text-red-400">{formatCost(older.unitCost)}</span> → {formatCost(newer.unitCost)}</>
                                    ) : (
                                      formatCost(newer.unitCost)
                                    )}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-muted-foreground">Total</p>
                                  <p className="font-mono">
                                    {Number(older.totalCost) !== Number(newer.totalCost) ? (
                                      <><span className="line-through text-red-600 dark:text-red-400">{formatCost(older.totalCost)}</span> → {formatCost(newer.totalCost)}</>
                                    ) : (
                                      formatCost(newer.totalCost)
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {diff.unchanged.length > 0 && (
                      <div className="space-y-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full justify-between text-xs text-muted-foreground h-8"
                          onClick={() => setShowUnchanged((v) => !v)}
                          data-testid="button-toggle-unchanged"
                        >
                          <span>Unchanged ({diff.unchanged.length} items)</span>
                          {showUnchanged ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                        {showUnchanged && (
                          <div className="rounded border divide-y">
                            {diff.unchanged.map((item) => (
                              <div key={item.id} className="px-3 py-2" data-testid={`diff-unchanged-${item.id}`}>
                                <p className="text-sm text-muted-foreground">{item.description}</p>
                                <p className="text-xs text-muted-foreground">
                                  Qty: {item.quantity} {item.unit} · Total: {formatCost(item.totalCost)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0 && (
                      <p className="text-sm text-center text-muted-foreground py-4">
                        No differences found between these two versions.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
