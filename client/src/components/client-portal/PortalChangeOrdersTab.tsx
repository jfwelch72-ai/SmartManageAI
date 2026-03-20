import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilePenLine } from "lucide-react";
import { format } from "date-fns";

interface ChangeOrderItem {
  id: string;
  changeOrderNumber: string;
  description: string;
  amount: string;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  clientResponseDueDate: string | null;
}

interface PortalChangeOrdersTabProps {
  changeOrders: ChangeOrderItem[] | undefined;
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT:            { label: "Draft",            className: "bg-gray-100 text-gray-700" },
  PENDING_APPROVAL: { label: "Pending Approval", className: "bg-yellow-100 text-yellow-700" },
  APPROVED:         { label: "Approved",         className: "bg-green-100 text-green-700" },
  REJECTED:         { label: "Rejected",         className: "bg-red-100 text-red-700" },
  VOIDED:           { label: "Voided",           className: "bg-gray-100 text-gray-500" },
};

function fmtCurrency(amount: string): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num);
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try { return format(new Date(dateStr), "MMM d, yyyy"); } catch { return "—"; }
}

export function PortalChangeOrdersTab({ changeOrders }: PortalChangeOrdersTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change Orders</CardTitle>
        <CardDescription>Approved and pending change orders for this project</CardDescription>
      </CardHeader>
      <CardContent>
        {changeOrders && changeOrders.length > 0 ? (
          <ScrollArea className="max-h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>CO #</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Response Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {changeOrders.map((co) => {
                  const statusCfg = STATUS_CONFIG[co.status] || { label: co.status, className: "bg-gray-100 text-gray-700" };
                  return (
                    <TableRow key={co.id} data-testid={`row-co-${co.id}`}>
                      <TableCell className="font-medium whitespace-nowrap">{co.changeOrderNumber}</TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="truncate text-sm">{co.description}</p>
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {fmtCurrency(co.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge className={statusCfg.className} variant="outline">
                          {statusCfg.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDate(co.submittedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {fmtDate(co.clientResponseDueDate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        ) : (
          <div className="text-center py-8">
            <FilePenLine className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No change orders available yet.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
