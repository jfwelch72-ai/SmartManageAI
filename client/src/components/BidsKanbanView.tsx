import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import type { Bid } from "@shared/schema";

type BidStatus = Bid["status"];

const STATUS_COLUMNS: Array<{ key: BidStatus; label: string; accent: string }> = [
  { key: "DRAFT", label: "Draft", accent: "bg-slate-500" },
  { key: "ACTIVE", label: "Active", accent: "bg-amber-500" },
  { key: "SUBMITTED", label: "Submitted", accent: "bg-blue-500" },
  { key: "AWARDED", label: "Awarded", accent: "bg-emerald-500" },
  { key: "LOST", label: "Lost", accent: "bg-rose-500" },
  { key: "CANCELLED", label: "Cancelled", accent: "bg-slate-400" },
];

function formatCurrency(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "";
  const n = typeof val === "string" ? Number(val) : val;
  if (Number.isNaN(n)) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface Props {
  bids: Array<Bid & { estimatorName?: string | null }>;
  onCardClick: (bid: Bid) => void;
}

export default function BidsKanbanView({ bids, onCardClick }: Props) {
  const grouped = STATUS_COLUMNS.reduce((acc, col) => {
    acc[col.key] = bids.filter((b) => b.status === col.key);
    return acc;
  }, {} as Record<BidStatus, Props["bids"]>);

  return (
    <div className="overflow-x-auto pb-2" data-testid="view-kanban">
      <div className="flex gap-4 min-w-max">
        {STATUS_COLUMNS.map((col) => {
          const colBids = grouped[col.key] || [];
          return (
            <div
              key={col.key}
              className="w-72 shrink-0 rounded-md border bg-muted/30"
              data-testid={`kanban-column-${col.key}`}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                  <span className="text-sm font-semibold">{col.label}</span>
                </div>
                <Badge variant="secondary" className="text-xs">{colBids.length}</Badge>
              </div>
              <div className="p-2 space-y-2 min-h-32 max-h-[calc(100vh-22rem)] overflow-y-auto">
                {colBids.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No bids</p>
                ) : (
                  colBids.map((b) => (
                    <Card
                      key={b.id}
                      onClick={() => onCardClick(b)}
                      className="cursor-pointer hover-elevate"
                      data-testid={`kanban-card-${b.code}`}
                    >
                      <CardContent className="p-3 space-y-2">
                        <div className="min-w-0">
                          <Badge variant="outline" className="font-mono text-[10px] mb-1">{b.code}</Badge>
                          <h4 className="text-sm font-medium leading-tight truncate" data-testid={`kanban-card-name-${b.code}`}>{b.name}</h4>
                          {b.clientName && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">{b.clientName}</p>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          {b.bidAmount ? (
                            <span className="text-muted-foreground truncate">{formatCurrency(b.bidAmount)}</span>
                          ) : <span />}
                          {b.dueDate && (
                            <span className="text-muted-foreground shrink-0">{format(new Date(b.dueDate), "MMM d")}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
