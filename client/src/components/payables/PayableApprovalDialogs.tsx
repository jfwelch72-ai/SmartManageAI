import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import {
  FileText, Check, X, CreditCard, XCircle, Loader2,
  Calendar as CalendarIcon,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import type { Payable } from "./types";

interface PayableApprovalDialogsProps {
  selectedPayable: Payable | null;
  isDetailOpen: boolean;
  onDetailOpenChange: (open: boolean) => void;
  isRejectOpen: boolean;
  onRejectOpenChange: (open: boolean) => void;
  isPayOpen: boolean;
  onPayOpenChange: (open: boolean) => void;
  userRole: string;
  onApprove: (payable: Payable) => void;
  onReject: (id: string, reason: string) => void;
  onMarkPaid: (params: { id: string; paymentDate: string; checkNumber?: string; paymentMethod?: string }) => void;
  isApproving: boolean;
  isRejecting: boolean;
  isMarkingPaid: boolean;
  formatCurrency: (amount: string | number) => string;
  getStatusBadge: (status: string) => JSX.Element;
}

export function PayableApprovalDialogs({
  selectedPayable,
  isDetailOpen,
  onDetailOpenChange,
  isRejectOpen,
  onRejectOpenChange,
  isPayOpen,
  onPayOpenChange,
  userRole,
  onApprove,
  onReject,
  onMarkPaid,
  isApproving,
  isRejecting,
  isMarkingPaid,
  formatCurrency,
  getStatusBadge,
}: PayableApprovalDialogsProps) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [checkNumber, setCheckNumber] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CHECK");

  const handleReject = () => {
    if (!selectedPayable || !rejectionReason.trim()) return;
    onReject(selectedPayable.id, rejectionReason);
  };

  const handleMarkPaid = () => {
    if (!selectedPayable || !paymentDate) return;
    onMarkPaid({
      id: selectedPayable.id,
      paymentDate,
      checkNumber: checkNumber || undefined,
      paymentMethod: paymentMethod || undefined,
    });
  };

  return (
    <>
      <Dialog open={isDetailOpen} onOpenChange={(open) => {
        onDetailOpenChange(open);
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby="payable-detail-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Payable Details
            </DialogTitle>
            <DialogDescription id="payable-detail-description">
              View full details of this subcontractor payable request.
            </DialogDescription>
          </DialogHeader>
          {selectedPayable && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Contract</p>
                  <p className="font-mono font-bold">{selectedPayable.contract.contractNumber}</p>
                </div>
                {getStatusBadge(selectedPayable.status)}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Subcontractor</p>
                  <p className="font-medium">{selectedPayable.subcontractor.companyName}</p>
                  {selectedPayable.subcontractor.contactName && (
                    <p className="text-sm text-muted-foreground">{selectedPayable.subcontractor.contactName}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Project</p>
                  <p className="font-medium">{selectedPayable.project.name}</p>
                  <Badge variant="outline" className="font-mono text-xs">{selectedPayable.project.code}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Amount</p>
                  <p className="text-2xl font-bold">{formatCurrency(selectedPayable.amount)}</p>
                </div>
                {selectedPayable.retentionHeld && parseFloat(selectedPayable.retentionHeld) > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground">Retention Held</p>
                    <p className="text-lg font-medium text-yellow-600 dark:text-yellow-500">
                      {formatCurrency(selectedPayable.retentionHeld)}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <p className="text-sm text-muted-foreground">Scope of Work</p>
                <p className="text-sm">{selectedPayable.contract.scopeOfWork}</p>
              </div>

              {selectedPayable.description && (
                <div>
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="text-sm">{selectedPayable.description}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-4 border-t">
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="text-sm">{format(new Date(selectedPayable.createdAt), "MMM d, yyyy h:mm a")}</p>
                  {selectedPayable.autoCreated && (
                    <Badge variant="outline" className="mt-1">Auto-generated from contract completion</Badge>
                  )}
                </div>
                {selectedPayable.approvedAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Approved</p>
                    <p className="text-sm">{format(new Date(selectedPayable.approvedAt), "MMM d, yyyy h:mm a")}</p>
                  </div>
                )}
                {selectedPayable.paidAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Paid</p>
                    <p className="text-sm">{format(new Date(selectedPayable.paidAt), "MMM d, yyyy h:mm a")}</p>
                    {selectedPayable.checkNumber && (
                      <p className="text-xs text-muted-foreground">Check #{selectedPayable.checkNumber}</p>
                    )}
                    {selectedPayable.paymentMethod && (
                      <Badge variant="outline" className="mt-1">{selectedPayable.paymentMethod}</Badge>
                    )}
                  </div>
                )}
                {selectedPayable.rejectedAt && (
                  <div>
                    <p className="text-sm text-muted-foreground">Rejected</p>
                    <p className="text-sm">{format(new Date(selectedPayable.rejectedAt), "MMM d, yyyy h:mm a")}</p>
                    {selectedPayable.rejectionReason && (
                      <p className="text-sm text-destructive mt-1">{selectedPayable.rejectionReason}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            {selectedPayable?.status === "PENDING" && (userRole === "ADMIN" || userRole === "MANAGER") && (
              <div className="flex gap-2 w-full justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRejectionReason("");
                    onRejectOpenChange(true);
                  }}
                >
                  <X className="w-4 h-4 mr-2" /> Reject
                </Button>
                <Button onClick={() => selectedPayable && onApprove(selectedPayable)} disabled={isApproving}>
                  {isApproving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
                  Approve
                </Button>
              </div>
            )}
            {selectedPayable?.status === "APPROVED" && (userRole === "ADMIN" || userRole === "MANAGER") && (
              <Button onClick={() => {
                setPaymentDate(format(new Date(), "yyyy-MM-dd"));
                setPaymentMethod(selectedPayable.paymentMethod || "CHECK");
                setCheckNumber("");
                onPayOpenChange(true);
              }}>
                <CreditCard className="w-4 h-4 mr-2" /> Record Payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isRejectOpen} onOpenChange={(open) => {
        onRejectOpenChange(open);
        if (!open) {
          setRejectionReason("");
        }
      }}>
        <DialogContent aria-describedby="reject-dialog-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="w-5 h-5 text-destructive" />
              Reject Payable
            </DialogTitle>
            <DialogDescription id="reject-dialog-description">
              Please provide a reason for rejecting this payable request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="rejection-reason">Rejection Reason</Label>
              <Textarea
                id="rejection-reason"
                placeholder="Enter the reason for rejection..."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                className="mt-2"
                data-testid="textarea-rejection-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onRejectOpenChange(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!rejectionReason.trim() || isRejecting}
              data-testid="button-confirm-reject"
            >
              {isRejecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <X className="w-4 h-4 mr-2" />}
              Reject Payable
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isPayOpen} onOpenChange={(open) => {
        onPayOpenChange(open);
        if (!open) {
          setCheckNumber("");
          setPaymentDate(format(new Date(), "yyyy-MM-dd"));
          setPaymentMethod("CHECK");
        }
      }}>
        <DialogContent aria-describedby="payment-dialog-description">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-green-500" />
              Record Payment
            </DialogTitle>
            <DialogDescription id="payment-dialog-description">
              Enter the payment details for this approved payable.
            </DialogDescription>
          </DialogHeader>
          {selectedPayable && (
            <div className="space-y-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Amount to Pay</p>
                <p className="text-2xl font-bold">{formatCurrency(selectedPayable.amount)}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedPayable.subcontractor.companyName} - {selectedPayable.contract.contractNumber}
                </p>
              </div>

              <div className="grid gap-4">
                <div className="space-y-2">
                  <Label htmlFor="payment-date">Payment Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal mt-2",
                          !paymentDate && "text-muted-foreground"
                        )}
                        data-testid="input-payment-date"
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {paymentDate ? format(parseISO(paymentDate), "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarPicker
                        mode="single"
                        selected={paymentDate ? parseISO(paymentDate) : undefined}
                        onSelect={(date) => setPaymentDate(date ? format(date, "yyyy-MM-dd") : "")}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                </div>
                <div>
                  <Label htmlFor="payment-method">Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="mt-2" data-testid="select-payment-method">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CHECK">Check</SelectItem>
                      <SelectItem value="ACH">ACH Transfer</SelectItem>
                      <SelectItem value="WIRE">Wire Transfer</SelectItem>
                      <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                      <SelectItem value="CASH">Cash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="check-number">Check/Reference Number (optional)</Label>
                  <Input
                    id="check-number"
                    placeholder="e.g., 12345"
                    value={checkNumber}
                    onChange={(e) => setCheckNumber(e.target.value)}
                    className="mt-2"
                    data-testid="input-check-number"
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => onPayOpenChange(false)}>Cancel</Button>
            <Button
              onClick={handleMarkPaid}
              disabled={!paymentDate || isMarkingPaid}
              data-testid="button-confirm-payment"
            >
              {isMarkingPaid ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Check className="w-4 h-4 mr-2" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
