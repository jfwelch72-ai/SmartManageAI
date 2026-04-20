import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2, ChevronRight, FolderInput } from "lucide-react";
import { format } from "date-fns";

const bidStatusClass: Record<string, string> = {
  DRAFT: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  ACTIVE: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  SUBMITTED: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  AWARDED: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  LOST: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  CANCELLED: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

function BidStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${bidStatusClass[status] ?? ""}`}
    >
      {status}
    </Badge>
  );
}

export interface BidsTableRow {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  bidAmount?: string | null;
  dueDate?: string | null;
  city?: string | null;
  state?: string | null;
  locationAddress?: string | null;
  estimatorName?: string | null;
}

interface BidsTableProps {
  bids: BidsTableRow[];
  onRowClick: (bid: BidsTableRow) => void;
  canDelete?: boolean;
  onDelete?: (code: string, name: string) => void;
  canConvert?: boolean;
  onConvert?: (code: string) => void;
  getRowProps?: (index: number) => Record<string, unknown>;
}

function formatLocation(b: BidsTableRow) {
  const cityState = [b.city, b.state].filter(Boolean).join(", ");
  return cityState || b.locationAddress || "\u2014";
}

function formatAmount(b: BidsTableRow) {
  return b.bidAmount && Number(b.bidAmount) > 0
    ? `$${Number(b.bidAmount).toLocaleString()}`
    : "TBD";
}

function formatDue(b: BidsTableRow) {
  return b.dueDate ? format(new Date(b.dueDate), "yyyy-MM-dd") : "\u2014";
}

export default function BidsTable({
  bids,
  onRowClick,
  canDelete,
  onDelete,
  canConvert,
  onConvert,
  getRowProps,
}: BidsTableProps) {
  const showActions = canDelete || canConvert;
  return (
    <>
      <div className="hidden md:block rounded-md border" data-testid="bids-table">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-semibold">Code</TableHead>
              <TableHead className="font-semibold">Bid Name</TableHead>
              <TableHead className="font-semibold">Client</TableHead>
              <TableHead className="font-semibold">Status</TableHead>
              <TableHead className="font-semibold text-right">Amount</TableHead>
              <TableHead className="font-semibold">Due</TableHead>
              <TableHead className="font-semibold">Location</TableHead>
              <TableHead className="font-semibold">Estimator</TableHead>
              {showActions && (
                <TableHead className="font-semibold w-24">Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {bids.map((bid, idx) => (
              <TableRow
                key={bid.id}
                className="cursor-pointer hover-elevate"
                onClick={() => onRowClick(bid)}
                data-testid={`row-bid-${bid.code}`}
                {...(getRowProps ? getRowProps(idx) : {})}
              >
                <TableCell>
                  <Badge variant="outline" className="font-mono text-xs">
                    {bid.code}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{bid.name}</TableCell>
                <TableCell>{bid.clientName}</TableCell>
                <TableCell>
                  <BidStatusBadge status={bid.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatAmount(bid)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDue(bid)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatLocation(bid)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {bid.estimatorName || "Unassigned"}
                </TableCell>
                {showActions && (
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {canConvert && bid.status !== "AWARDED" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            onConvert?.(bid.code);
                          }}
                          data-testid={`button-convert-bid-${bid.code}`}
                          title="Mark as Awarded / Convert to Project"
                        >
                          <FolderInput className="w-4 h-4" />
                        </Button>
                      )}
                      {canDelete && bid.status !== "AWARDED" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete?.(bid.code, bid.name);
                          }}
                          data-testid={`button-delete-bid-${bid.code}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="md:hidden space-y-3">
        {bids.map((bid) => (
          <Card
            key={bid.id}
            className="cursor-pointer active:scale-[0.98] transition-transform"
            onClick={() => onRowClick(bid)}
            data-testid={`card-bid-${bid.code}`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <Badge variant="outline" className="font-mono text-xs shrink-0">
                      {bid.code}
                    </Badge>
                    <BidStatusBadge status={bid.status} />
                  </div>
                  <h3
                    className="font-medium text-sm leading-tight mb-1 truncate"
                    data-testid={`text-bid-name-${bid.code}`}
                  >
                    {bid.name}
                  </h3>
                  {bid.clientName && (
                    <p className="text-xs text-muted-foreground truncate">
                      {bid.clientName}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {canConvert && bid.status !== "AWARDED" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        onConvert?.(bid.code);
                      }}
                      data-testid={`button-convert-bid-${bid.code}`}
                    >
                      <FolderInput className="w-4 h-4" />
                    </Button>
                  )}
                  {canDelete && bid.status !== "AWARDED" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete?.(bid.code, bid.name);
                      }}
                      data-testid={`button-delete-bid-${bid.code}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t text-xs text-muted-foreground">
                <span>Amount: {formatAmount(bid)}</span>
                <span>Due: {formatDue(bid)}</span>
                {bid.estimatorName && <span>Est: {bid.estimatorName}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
