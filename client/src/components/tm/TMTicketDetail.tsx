import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { TMTicket } from "@/hooks/use-data";
import { format } from "date-fns";
import { CheckCircle, XCircle, Send, Trash2, DollarSign, Users, Wrench, Package, Printer } from "lucide-react";

const formatCurrency = (value: string | number) => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
};

interface TMTicketDetailProps {
  ticket: TMTicket;
  canCreate: boolean;
  canApprove: boolean;
  onSubmit: (ticketId: string) => void;
  onApprove: (ticketId: string) => void;
  onReject: (ticketId: string) => void;
  onDelete: (ticketId: string) => void;
  onViewPDF: (ticketId: string) => void;
  submitPending: boolean;
  approvePending: boolean;
}

export default function TMTicketDetail({
  ticket, canCreate, canApprove,
  onSubmit, onApprove, onReject, onDelete, onViewPDF,
  submitPending, approvePending,
}: TMTicketDetailProps) {
  return (
    <div className="px-4 pb-4 border-t">
      <div className="py-4 space-y-4">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Work Date:</span>{" "}
            <span className="font-medium">{format(new Date(ticket.workDate), "MMMM d, yyyy")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Location:</span>{" "}
            <span className="font-medium">{(ticket as any).location || "Not specified"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Created By:</span>{" "}
            <span className="font-medium">{(ticket as any).createdByName || "Unknown"}</span>
          </div>
        </div>

        {(ticket as any).costCode && (
          <div className="text-sm">
            <span className="text-muted-foreground">Cost Code:</span>{" "}
            <span className="font-medium">{(ticket as any).costCode}</span>
          </div>
        )}

        <div>
          <span className="text-sm text-muted-foreground">Description:</span>
          <p className="text-sm mt-1">{ticket.scopeDescription}</p>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Card className="p-3 text-center">
            <DollarSign className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Grand Total</p>
            <p className="font-mono font-semibold">{formatCurrency(ticket.grandTotal)}</p>
          </Card>
          <Card className="p-3 text-center">
            <Users className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Labor</p>
            <p className="font-mono font-semibold">{formatCurrency(ticket.totalLaborCost)}</p>
          </Card>
          <Card className="p-3 text-center">
            <Wrench className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Equipment</p>
            <p className="font-mono font-semibold">{formatCurrency(ticket.totalEquipmentCost)}</p>
          </Card>
          <Card className="p-3 text-center">
            <Package className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Materials</p>
            <p className="font-mono font-semibold">{formatCurrency(ticket.totalMaterialCost)}</p>
          </Card>
        </div>

        {ticket.laborEntries && ticket.laborEntries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Users className="w-4 h-4" /> Labor Entries
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead className="text-right">Reg Hrs</TableHead>
                  <TableHead className="text-right">OT Hrs</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ticket.laborEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.employeeName}</TableCell>
                    <TableCell>{entry.position || "-"}</TableCell>
                    <TableCell className="text-right">{(entry as any).regularHours}</TableCell>
                    <TableCell className="text-right">{(entry as any).overtimeHours || "0"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency((entry as any).regularRate || "0")}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.totalCost || "0")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {ticket.equipmentEntries && ticket.equipmentEntries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Wrench className="w-4 h-4" /> Equipment Entries
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Equipment</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ticket.equipmentEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.equipmentType}</TableCell>
                    <TableCell className="text-right">{entry.quantity}</TableCell>
                    <TableCell className="text-right">{entry.hoursUsed}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.hourlyRate || "0")}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.totalCost || "0")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {ticket.materialEntries && ticket.materialEntries.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Package className="w-4 h-4" /> Material Entries
            </h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ticket.materialEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{entry.materialDescription}</TableCell>
                    <TableCell className="text-right">{entry.quantity}</TableCell>
                    <TableCell>{entry.unit || "-"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.unitCost || "0")}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.totalCost || "0")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          {(ticket.status === "DRAFT" || ticket.status === "REJECTED") && canCreate && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onSubmit(ticket.id)}
                disabled={submitPending}
                data-testid={`button-submit-${ticket.id}`}
              >
                <Send className="w-4 h-4 mr-2" />
                Submit for Approval
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="sm" data-testid={`button-delete-${ticket.id}`}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete T&M Ticket?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete ticket {ticket.ticketNumber}. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => onDelete(ticket.id)}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}

          {ticket.status === "SUBMITTED" && canApprove && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReject(ticket.id)}
                data-testid={`button-reject-${ticket.id}`}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reject
              </Button>
              <Button
                size="sm"
                onClick={() => onApprove(ticket.id)}
                disabled={approvePending}
                data-testid={`button-approve-${ticket.id}`}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Approve
              </Button>
            </>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => onViewPDF(ticket.id)}
            data-testid={`button-view-pdf-${ticket.id}`}
          >
            <Printer className="w-4 h-4 mr-2" />
            Print / PDF
          </Button>
        </div>
      </div>
    </div>
  );
}
