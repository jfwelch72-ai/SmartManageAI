import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  FileText,
  CheckCircle,
  Clock,
  Receipt,
  Send,
  CreditCard,
  AlertCircle,
  Loader2,
  Banknote,
} from "lucide-react";

interface TMTicketWithProject {
  id: string;
  ticketNumber: string;
  workDate: string;
  scopeDescription: string;
  grandTotal: string;
  billingStatus: string;
  project: { id: string; name: string; clientName: string } | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

interface TMInvoice {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  clientName: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  total: string;
  status: string;
  project: { id: string; name: string } | null;
  ticketCount: number;
}

interface BillingSummary {
  pendingCount: number;
  pendingTotal: number;
  approvedForBillingCount: number;
  approvedForBillingTotal: number;
  invoicedCount: number;
  invoicedTotal: number;
  billedCount: number;
  billedTotal: number;
  draftInvoices: number;
  sentInvoices: number;
  paidInvoices: number;
  totalInvoiced: number;
  totalPaid: number;
}

export default function TMBillingPage() {
  const { toast } = useToast();
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(
    new Set(),
  );
  const [showInvoiceDialog, setShowInvoiceDialog] = useState(false);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentInvoiceId, setPaymentInvoiceId] = useState<string | null>(null);
  const [paymentFormData, setPaymentFormData] = useState({
    amount: "",
    paymentDate: new Date().toISOString().split("T")[0],
    paymentMethod: "CHECK",
    referenceNumber: "",
    notes: "",
  });
  const [invoiceFormData, setInvoiceFormData] = useState({
    clientName: "",
    clientAddress: "",
    clientEmail: "",
    dueDate: "",
    taxRate: "0",
    notes: "",
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<BillingSummary>(
    {
      queryKey: ["/api/tm-billing/summary"],
    },
  );

  const { data: pendingTickets, isLoading: pendingLoading } = useQuery<
    TMTicketWithProject[]
  >({
    queryKey: ["/api/tm-billing/pending"],
  });

  const { data: approvedTickets, isLoading: approvedLoading } = useQuery<
    TMTicketWithProject[]
  >({
    queryKey: ["/api/tm-billing/approved"],
  });

  const { data: invoices, isLoading: invoicesLoading } = useQuery<TMInvoice[]>({
    queryKey: ["/api/tm-invoices"],
  });

  const approveMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      return apiRequest(
        "POST",
        `/api/tm-tickets/${ticketId}/approve-for-billing`,
        {},
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/approved"] });
      toast({ title: "Ticket approved for billing" });
    },
    onError: () => {
      toast({ title: "Failed to approve ticket", variant: "destructive" });
    },
  });

  const createInvoiceMutation = useMutation({
    mutationFn: async (data: {
      ticketIds: string[];
      clientName: string;
      clientAddress?: string;
      clientEmail?: string;
      dueDate?: string;
      taxRate?: string;
      notes?: string;
    }) => {
      return apiRequest("POST", "/api/tm-invoices", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/approved"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-invoices"] });
      setShowInvoiceDialog(false);
      setSelectedTickets(new Set());
      toast({ title: "Invoice created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create invoice", variant: "destructive" });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      return apiRequest("POST", `/api/tm-invoices/${invoiceId}/mark-paid`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/summary"] });
      toast({ title: "Invoice marked as paid" });
    },
    onError: () => {
      toast({
        title: "Failed to mark invoice as paid",
        variant: "destructive",
      });
    },
  });

  const sendInvoiceMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      return apiRequest("POST", `/api/tm-invoices/${invoiceId}/send`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/summary"] });
      toast({ title: "Invoice marked as sent" });
    },
    onError: () => {
      toast({
        title: "Failed to mark invoice as sent",
        variant: "destructive",
      });
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data: { invoiceId: string; amount: number; paymentDate: string; paymentMethod: string; referenceNumber?: string; notes?: string }) => {
      return apiRequest("POST", `/api/tm-invoices/${data.invoiceId}/record-payment`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tm-invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tm-billing/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments/ar-summary"] });
      setShowPaymentDialog(false);
      setPaymentInvoiceId(null);
      setPaymentFormData({ amount: "", paymentDate: new Date().toISOString().split("T")[0], paymentMethod: "CHECK", referenceNumber: "", notes: "" });
      toast({ title: "Payment recorded successfully" });
    },
    onError: () => {
      toast({ title: "Failed to record payment", variant: "destructive" });
    },
  });

  const openPaymentDialog = (invoiceId: string) => {
    setPaymentInvoiceId(invoiceId);
    setShowPaymentDialog(true);
  };

  const handleRecordPayment = () => {
    if (!paymentInvoiceId) return;
    const amount = parseFloat(paymentFormData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Please enter a valid payment amount", variant: "destructive" });
      return;
    }
    recordPaymentMutation.mutate({
      invoiceId: paymentInvoiceId,
      amount,
      paymentDate: paymentFormData.paymentDate,
      paymentMethod: paymentFormData.paymentMethod,
      referenceNumber: paymentFormData.referenceNumber || undefined,
      notes: paymentFormData.notes || undefined,
    });
  };

  const handleTicketSelect = (ticketId: string, checked: boolean) => {
    const newSelected = new Set(selectedTickets);
    if (checked) {
      newSelected.add(ticketId);
    } else {
      newSelected.delete(ticketId);
    }
    setSelectedTickets(newSelected);
  };

  const handleGenerateInvoice = () => {
    if (selectedTickets.size === 0) {
      toast({
        title: "Please select at least one ticket",
        variant: "destructive",
      });
      return;
    }

    const firstTicket = approvedTickets?.find((t) => selectedTickets.has(t.id));
    if (firstTicket?.project) {
      setInvoiceFormData((prev) => ({
        ...prev,
        clientName: firstTicket.project?.clientName || "",
      }));
    }
    setShowInvoiceDialog(true);
  };

  const handleCreateInvoice = () => {
    const ticketIds = Array.from(selectedTickets);
    createInvoiceMutation.mutate({
      ticketIds,
      clientName: invoiceFormData.clientName,
      clientAddress: invoiceFormData.clientAddress || undefined,
      clientEmail: invoiceFormData.clientEmail || undefined,
      dueDate: invoiceFormData.dueDate || undefined,
      taxRate: invoiceFormData.taxRate || undefined,
      notes: invoiceFormData.notes || undefined,
    });
  };

  const formatCurrency = (value: string | number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(Number(value));
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "PENDING":
        return (
          <Badge variant="secondary" data-testid="badge-status-pending">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case "APPROVED_FOR_BILLING":
        return (
          <Badge variant="default" data-testid="badge-status-approved">
            <CheckCircle className="h-3 w-3 mr-1" />
            Ready to Invoice
          </Badge>
        );
      case "INVOICED":
        return (
          <Badge variant="outline" data-testid="badge-status-invoiced">
            <FileText className="h-3 w-3 mr-1" />
            Invoiced
          </Badge>
        );
      case "BILLED":
        return (
          <Badge className="bg-green-600" data-testid="badge-status-billed">
            <DollarSign className="h-3 w-3 mr-1" />
            Billed
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getInvoiceStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT":
        return (
          <Badge variant="secondary" data-testid="badge-invoice-draft">
            Draft
          </Badge>
        );
      case "SENT":
        return (
          <Badge variant="default" data-testid="badge-invoice-sent">
            <Send className="h-3 w-3 mr-1" />
            Sent
          </Badge>
        );
      case "PAID":
        return (
          <Badge className="bg-green-600" data-testid="badge-invoice-paid">
            <CreditCard className="h-3 w-3 mr-1" />
            Paid
          </Badge>
        );
      case "CANCELLED":
        return (
          <Badge variant="destructive" data-testid="badge-invoice-cancelled">
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-full p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">
            T&M Billing Management
          </h1>
          <p className="text-muted-foreground">
            Approve tickets, generate invoices, and track payments
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pending Approval
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              data-testid="text-pending-count"
            >
              {summary?.pendingCount || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(summary?.pendingTotal || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Ready to Invoice
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              data-testid="text-approved-count"
            >
              {summary?.approvedForBillingCount || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(summary?.approvedForBillingTotal || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Outstanding Invoices
            </CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              data-testid="text-outstanding-count"
            >
              {summary?.sentInvoices || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(summary?.totalInvoiced || 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Collected
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold"
              data-testid="text-collected-total"
            >
              {formatCurrency(summary?.totalPaid || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              {summary?.paidInvoices || 0} invoices paid
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending" data-testid="tab-pending">
            Pending Approval ({pendingTickets?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="approved" data-testid="tab-approved">
            Ready to Invoice ({approvedTickets?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="invoices" data-testid="tab-invoices">
            Invoices ({invoices?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Tickets Pending Billing Approval</CardTitle>
              <CardDescription>
                Review and approve completed T&M tickets for billing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !pendingTickets?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No tickets pending approval</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`ticket-pending-${ticket.id}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {ticket.ticketNumber}
                          </span>
                          {getStatusBadge(ticket.billingStatus)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {ticket.project?.name}
                        </p>
                        <p className="text-sm">{ticket.scopeDescription}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(ticket.workDate), "MMM d, yyyy")} •
                          Created by {ticket.createdBy?.firstName}{" "}
                          {ticket.createdBy?.lastName}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-bold">
                          {formatCurrency(ticket.grandTotal)}
                        </span>
                        <Button
                          onClick={() => approveMutation.mutate(ticket.id)}
                          disabled={approveMutation.isPending}
                          data-testid={`button-approve-${ticket.id}`}
                        >
                          {approveMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Approve for Billing"
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approved" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Tickets Ready for Invoicing</CardTitle>
                  <CardDescription>
                    Select tickets to include in an invoice
                  </CardDescription>
                </div>
                {selectedTickets.size > 0 && (
                  <Button
                    onClick={handleGenerateInvoice}
                    data-testid="button-generate-invoice"
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Generate Invoice ({selectedTickets.size} tickets)
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {approvedLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !approvedTickets?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No tickets ready for invoicing</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {approvedTickets.map((ticket) => (
                    <div
                      key={ticket.id}
                      className="flex items-center gap-4 p-4 border rounded-lg"
                      data-testid={`ticket-approved-${ticket.id}`}
                    >
                      <Checkbox
                        checked={selectedTickets.has(ticket.id)}
                        onCheckedChange={(checked) =>
                          handleTicketSelect(ticket.id, checked as boolean)
                        }
                        data-testid={`checkbox-ticket-${ticket.id}`}
                      />
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {ticket.ticketNumber}
                          </span>
                          {getStatusBadge(ticket.billingStatus)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {ticket.project?.name} • {ticket.project?.clientName}
                        </p>
                        <p className="text-sm">{ticket.scopeDescription}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(ticket.workDate), "MMM d, yyyy")}
                        </p>
                      </div>
                      <span className="text-lg font-bold">
                        {formatCurrency(ticket.grandTotal)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="invoices" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>
                Track invoice status and payments
              </CardDescription>
            </CardHeader>
            <CardContent>
              {invoicesLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : !invoices?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>No invoices created yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {invoices.map((invoice) => (
                    <div
                      key={invoice.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`invoice-${invoice.id}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">
                            {invoice.invoiceNumber}
                          </span>
                          {getInvoiceStatusBadge(invoice.status)}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {invoice.project?.name}
                        </p>
                        <p className="text-sm">
                          {invoice.clientName} • {invoice.ticketCount} tickets
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Created{" "}
                          {format(new Date(invoice.invoiceDate), "MMM d, yyyy")}
                          {invoice.dueDate &&
                            ` • Due ${format(new Date(invoice.dueDate), "MMM d, yyyy")}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-lg font-bold">
                          {formatCurrency(invoice.total)}
                        </span>
                        <div className="flex gap-2">
                          {invoice.status === "DRAFT" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                sendInvoiceMutation.mutate(invoice.id)
                              }
                              disabled={sendInvoiceMutation.isPending}
                              data-testid={`button-send-${invoice.id}`}
                            >
                              <Send className="h-4 w-4 mr-1" />
                              Mark Sent
                            </Button>
                          )}
                          {(invoice.status === "DRAFT" ||
                            invoice.status === "SENT") && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openPaymentDialog(invoice.id)}
                                data-testid={`button-record-payment-${invoice.id}`}
                              >
                                <Banknote className="h-4 w-4 mr-1" />
                                Record Payment
                              </Button>
                              <Button
                                size="sm"
                                onClick={() =>
                                  markPaidMutation.mutate(invoice.id)
                                }
                                disabled={markPaidMutation.isPending}
                                data-testid={`button-paid-${invoice.id}`}
                              >
                                <CreditCard className="h-4 w-4 mr-1" />
                                Mark Paid
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showInvoiceDialog} onOpenChange={setShowInvoiceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Invoice</DialogTitle>
            <DialogDescription>
              Create an invoice for {selectedTickets.size} selected ticket(s)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="clientName">Client Name *</Label>
              <Input
                id="clientName"
                value={invoiceFormData.clientName}
                onChange={(e) =>
                  setInvoiceFormData((prev) => ({
                    ...prev,
                    clientName: e.target.value,
                  }))
                }
                placeholder="Enter client name"
                data-testid="input-client-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientEmail">Client Email</Label>
              <Input
                id="clientEmail"
                type="email"
                value={invoiceFormData.clientEmail}
                onChange={(e) =>
                  setInvoiceFormData((prev) => ({
                    ...prev,
                    clientEmail: e.target.value,
                  }))
                }
                placeholder="client@example.com"
                data-testid="input-client-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientAddress">Client Address</Label>
              <Textarea
                id="clientAddress"
                value={invoiceFormData.clientAddress}
                onChange={(e) =>
                  setInvoiceFormData((prev) => ({
                    ...prev,
                    clientAddress: e.target.value,
                  }))
                }
                placeholder="Enter billing address"
                data-testid="input-client-address"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dueDate">Due Date</Label>
                <DatePicker
                  value={invoiceFormData.dueDate || undefined}
                  onChange={(date) =>
                    setInvoiceFormData((prev) => ({
                      ...prev,
                      dueDate: date ? format(date, "yyyy-MM-dd") : "",
                    }))
                  }
                  placeholder="Select due date"
                  data-testid="input-due-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="taxRate">Tax Rate (%)</Label>
                <Input
                  id="taxRate"
                  type="number"
                  step="0.01"
                  value={invoiceFormData.taxRate}
                  onChange={(e) =>
                    setInvoiceFormData((prev) => ({
                      ...prev,
                      taxRate: e.target.value,
                    }))
                  }
                  placeholder="0"
                  data-testid="input-tax-rate"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={invoiceFormData.notes}
                onChange={(e) =>
                  setInvoiceFormData((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
                placeholder="Additional notes for the invoice"
                data-testid="input-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowInvoiceDialog(false)}
              data-testid="button-cancel-invoice"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateInvoice}
              disabled={
                !invoiceFormData.clientName || createInvoiceMutation.isPending
              }
              data-testid="button-create-invoice"
            >
              {createInvoiceMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Create Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              Record a payment received for this invoice
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="paymentAmount">Payment Amount *</Label>
              <Input
                id="paymentAmount"
                type="number"
                step="0.01"
                value={paymentFormData.amount}
                onChange={(e) =>
                  setPaymentFormData((prev) => ({
                    ...prev,
                    amount: e.target.value,
                  }))
                }
                placeholder="0.00"
                data-testid="input-payment-amount"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentDate">Payment Date *</Label>
              <Input
                id="paymentDate"
                type="date"
                value={paymentFormData.paymentDate}
                onChange={(e) =>
                  setPaymentFormData((prev) => ({
                    ...prev,
                    paymentDate: e.target.value,
                  }))
                }
                data-testid="input-payment-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentMethod">Payment Method</Label>
              <Select
                value={paymentFormData.paymentMethod}
                onValueChange={(value) =>
                  setPaymentFormData((prev) => ({
                    ...prev,
                    paymentMethod: value,
                  }))
                }
              >
                <SelectTrigger data-testid="select-payment-method">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CHECK">Check</SelectItem>
                  <SelectItem value="ACH">ACH</SelectItem>
                  <SelectItem value="WIRE">Wire Transfer</SelectItem>
                  <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="referenceNumber">Reference Number</Label>
              <Input
                id="referenceNumber"
                value={paymentFormData.referenceNumber}
                onChange={(e) =>
                  setPaymentFormData((prev) => ({
                    ...prev,
                    referenceNumber: e.target.value,
                  }))
                }
                placeholder="Check # or transaction ID"
                data-testid="input-reference-number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="paymentNotes">Notes</Label>
              <Textarea
                id="paymentNotes"
                value={paymentFormData.notes}
                onChange={(e) =>
                  setPaymentFormData((prev) => ({
                    ...prev,
                    notes: e.target.value,
                  }))
                }
                placeholder="Payment notes"
                data-testid="input-payment-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowPaymentDialog(false)}
              data-testid="button-cancel-payment"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRecordPayment}
              disabled={!paymentFormData.amount || recordPaymentMutation.isPending}
              data-testid="button-submit-payment"
            >
              {recordPaymentMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Banknote className="h-4 w-4 mr-2" />
              )}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
