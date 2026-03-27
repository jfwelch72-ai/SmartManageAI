import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { TMTicket } from "@/hooks/use-data";
import { format } from "date-fns";
import { CheckCircle, XCircle, Send, Trash2, DollarSign, Users, Wrench, Package, Printer, Lock, PenLine } from "lucide-react";
import SignaturePad from "./SignaturePad";

const formatCurrency = (value: string | number) => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(num || 0);
};

function isTicketLocked(billingStatus: string | undefined): boolean {
  return billingStatus === "INVOICED" || billingStatus === "BILLED";
}

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
  const { toast } = useToast();
  const locked = isTicketLocked(ticket.billingStatus);
  const [signoffName, setSignoffName] = useState("");
  const [signoffSignature, setSignoffSignature] = useState<string | null>(null);
  const [showSignoff, setShowSignoff] = useState(false);

  const signoffMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/tm-tickets/${ticket.id}/client-signoff`, {
        clientName: signoffName,
        signature: signoffSignature,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", ticket.projectId, "tm-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-tickets", ticket.id] });
      toast({ title: "Client sign-off recorded successfully" });
      setShowSignoff(false);
      setSignoffName("");
      setSignoffSignature(null);
    },
    onError: () => {
      toast({ title: "Failed to save client sign-off", variant: "destructive" });
    },
  });

  const canSignoff = (ticket.status === "SUBMITTED" || ticket.status === "APPROVED") && !locked && !ticket.clientSignoffAt;

  return (
    <div className="px-4 pb-4 border-t">
      <div className="py-4 space-y-4">
        {locked && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md" data-testid="badge-locked">
            <Lock className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
              Locked — {ticket.billingStatus === "BILLED" ? "Billed" : "Invoiced"}
            </span>
          </div>
        )}

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Work Date:</span>{" "}
            <span className="font-medium">{format(new Date(ticket.workDate), "MMMM d, yyyy")}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Location:</span>{" "}
            <span className="font-medium">{ticket.location || "Not specified"}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Created By:</span>{" "}
            <span className="font-medium">{ticket.createdByName || "Unknown"}</span>
          </div>
        </div>

        {ticket.costCode && (
          <div className="text-sm">
            <span className="text-muted-foreground">Cost Code:</span>{" "}
            <span className="font-medium">{ticket.costCode}</span>
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
                    <TableCell className="text-right">{entry.hoursWorked}</TableCell>
                    <TableCell className="text-right">{entry.totalHours || "0"}</TableCell>
                    <TableCell className="text-right font-mono">{formatCurrency(entry.hourlyRate || "0")}</TableCell>
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

        <div className="border-t pt-4 space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <PenLine className="w-4 h-4" /> Client Sign-off
          </h4>
          {ticket.clientSignoffAt ? (
            <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-md p-4 space-y-2" data-testid="signoff-completed">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-400">Signed by {ticket.clientSignoffName}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Signed on {format(new Date(ticket.clientSignoffAt), "MMMM d, yyyy 'at' h:mm a")}
              </p>
              {ticket.clientSignoffSignature && (
                <div className="mt-2">
                  <img
                    src={ticket.clientSignoffSignature}
                    alt="Client signature"
                    className="border rounded bg-white max-w-[300px] h-auto"
                    data-testid="img-client-signature"
                  />
                </div>
              )}
            </div>
          ) : canSignoff ? (
            <>
              {!showSignoff ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowSignoff(true)}
                  data-testid="button-start-signoff"
                >
                  <PenLine className="w-4 h-4 mr-2" />
                  Capture Client Sign-off
                </Button>
              ) : (
                <div className="border rounded-md p-4 space-y-4 bg-muted/30" data-testid="signoff-form">
                  <div className="space-y-2">
                    <Label htmlFor="signoff-name">Client Representative Name</Label>
                    <Input
                      id="signoff-name"
                      value={signoffName}
                      onChange={(e) => setSignoffName(e.target.value)}
                      placeholder="Enter full name"
                      data-testid="input-signoff-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Signature</Label>
                    <SignaturePad onSignatureChange={setSignoffSignature} />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => signoffMutation.mutate()}
                      disabled={!signoffName || !signoffSignature || signoffMutation.isPending}
                      data-testid="button-confirm-signoff"
                    >
                      {signoffMutation.isPending ? "Saving..." : "Confirm Sign-off"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowSignoff(false);
                        setSignoffName("");
                        setSignoffSignature(null);
                      }}
                      data-testid="button-cancel-signoff"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {locked ? "Ticket is locked" : "Sign-off available when ticket is submitted or approved"}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          {!locked && (ticket.status === "DRAFT" || ticket.status === "REJECTED") && canCreate && (
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

          {!locked && ticket.status === "SUBMITTED" && canApprove && (
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
