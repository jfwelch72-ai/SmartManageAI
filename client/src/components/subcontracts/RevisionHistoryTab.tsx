import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery } from "@tanstack/react-query";
import { History, Loader2, ArrowRight } from "lucide-react";
import { format } from "date-fns";

interface RevisionHistoryTabProps {
  contractId: string;
}

interface Revision {
  id: string;
  sovLineItemId: string;
  contractId: string;
  revisionType: string;
  previousValue: string | null;
  newValue: string | null;
  changeOrderRef: string | null;
  createdAt: string;
  sovItem: { id: string; description: string; itemNumber: number } | null;
  changedBy: { id: string; firstName: string; lastName: string } | null;
}

export function RevisionHistoryTab({ contractId }: RevisionHistoryTabProps) {
  const { data: revisions = [], isLoading } = useQuery<Revision[]>({
    queryKey: ["/api/subcontracts", contractId, "sov", "revisions"],
    queryFn: async () => {
      const r = await fetch(`/api/subcontracts/${contractId}/sov/revisions`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load revision history");
      return r.json();
    },
  });

  const fmt = (v: string | null) => {
    if (!v) return "—";
    const num = parseFloat(v);
    if (isNaN(num)) return v;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
  };

  const typeLabel = (t: string) => {
    switch (t) {
      case "VALUE_CHANGE": return "Value Changed";
      case "DESCRIPTION_CHANGE": return "Description Changed";
      case "ITEM_ADDED": return "Item Added";
      case "ITEM_REMOVED": return "Item Removed";
      default: return t.replace(/_/g, " ");
    }
  };

  const typeBadgeVariant = (t: string): "default" | "secondary" | "destructive" | "outline" => {
    switch (t) {
      case "VALUE_CHANGE": return "default";
      case "DESCRIPTION_CHANGE": return "secondary";
      case "ITEM_REMOVED": return "destructive";
      default: return "outline";
    }
  };

  if (isLoading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <History className="h-4 w-4" />Amendment & Change Order History ({revisions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {revisions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No scope revisions recorded yet. Changes to SOV line item values and descriptions are tracked automatically.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>SOV Item</TableHead>
                <TableHead>Change Type</TableHead>
                <TableHead>Previous</TableHead>
                <TableHead></TableHead>
                <TableHead>New</TableHead>
                <TableHead>CO Ref</TableHead>
                <TableHead>By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {revisions.map(rev => (
                <TableRow key={rev.id} data-testid={`row-revision-${rev.id}`}>
                  <TableCell className="text-muted-foreground whitespace-nowrap">{format(new Date(rev.createdAt), "MMM d, yyyy h:mm a")}</TableCell>
                  <TableCell className="font-medium">
                    {rev.sovItem ? `#${rev.sovItem.itemNumber} - ${rev.sovItem.description}` : "Deleted Item"}
                  </TableCell>
                  <TableCell><Badge variant={typeBadgeVariant(rev.revisionType)}>{typeLabel(rev.revisionType)}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{rev.revisionType === "VALUE_CHANGE" ? fmt(rev.previousValue) : (rev.previousValue || "—")}</TableCell>
                  <TableCell><ArrowRight className="h-3 w-3 text-muted-foreground" /></TableCell>
                  <TableCell className="font-medium">{rev.revisionType === "VALUE_CHANGE" ? fmt(rev.newValue) : (rev.newValue || "—")}</TableCell>
                  <TableCell>{rev.changeOrderRef ? <Badge variant="outline">{rev.changeOrderRef}</Badge> : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{rev.changedBy ? `${rev.changedBy.firstName} ${rev.changedBy.lastName}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
