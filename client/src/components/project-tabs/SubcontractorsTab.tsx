import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";
import { Clock, CheckCircle, DollarSign, FileText, Users, Package, Ruler, CalendarCheck, StickyNote, Paperclip, ExternalLink, User, Building2, Calendar as CalendarIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCreateSubcontractorPayment } from "@/hooks/use-data";
import { useTableKeyboardNav } from "@/hooks/use-table-keyboard-nav";
import { useRegisterShortcuts, TABLE_NAV_SHORTCUTS } from "@/components/KeyboardShortcutsHelp";

interface SubcontractorsTabProps {
  projectCode: string;
}

interface PendingSubQuote {
  id: string;
  subcontractorName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  scopeOfWork: string;
  quoteAmount: string;
  leadTime: string | null;
  estimatedCompletionTime: string | null;
  notes: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize?: number | null;
  createdAt: string;
  updatedAt: string;
}

interface PendingMatQuote {
  id: string;
  materialName: string;
  description: string;
  specs: string | null;
  cost: string;
  leadTime: string | null;
  supplierName: string | null;
  supplierContact: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileSize?: number | null;
  createdAt: string;
  updatedAt: string;
  notes?: string | null;
}

export default function SubcontractorsTab({ projectCode }: SubcontractorsTabProps) {
  const { toast } = useToast();

  const { data: subcontractors = [], isLoading: subcontractorsLoading } = useQuery<Array<{
    id: string;
    contractNumber: string;
    scopeOfWork: string;
    contractAmount: string;
    startDate: string | null;
    completionDate: string | null;
    status: string;
    paymentTerms: string | null;
    retentionPercent: string | null;
    notes: string | null;
    createdAt: string;
    totalPaid: number;
    remainingBalance: number;
    subcontractor: {
      id: string;
      companyName: string;
      contactName: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  }>>({
    queryKey: ["/api/projects", projectCode, "subcontractors"],
    enabled: !!projectCode,
  });

  const { data: pendingQuotes } = useQuery<{
    subcontractorQuotes: PendingSubQuote[];
    materialQuotes: PendingMatQuote[];
  }>({
    queryKey: ["/api/projects", projectCode, "pending-quotes"],
    enabled: !!projectCode,
  });

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");
  const [paymentInvoiceNumber, setPaymentInvoiceNumber] = useState("");
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));

  const [showQuoteDetailDialog, setShowQuoteDetailDialog] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<{
    type: "subcontractor" | "material";
    data: any;
  } | null>(null);

  const createPaymentMutation = useCreateSubcontractorPayment();

  const selectSubQuoteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      return await apiRequest("POST", `/api/projects/${projectCode}/pending-quotes/subcontractor/${quoteId}/select`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "pending-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "subcontractors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
      toast({ title: "Success", description: "Subcontractor contract created from quote" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to select quote", variant: "destructive" });
    },
  });

  const selectMatQuoteMutation = useMutation({
    mutationFn: async (quoteId: string) => {
      return await apiRequest("POST", `/api/projects/${projectCode}/pending-quotes/material/${quoteId}/select`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "pending-quotes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "procurement"] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectCode, "financials"] });
      toast({ title: "Success", description: "Procurement item created from quote" });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to select quote", variant: "destructive" });
    },
  });

  const openPayment = (contractId: string) => {
    setSelectedContractId(contractId);
    setShowPaymentDialog(true);
  };

  const { getRowProps: getContractRowProps } = useTableKeyboardNav({
    rowCount: subcontractors.length,
    onActivate: (idx) => {
      const c = subcontractors[idx];
      if (c) openPayment(c.id);
    },
  });
  useRegisterShortcuts(
    "project-subcontractors",
    TABLE_NAV_SHORTCUTS.filter((s) => s.keys !== "/"),
  );

  const handleCreatePayment = async () => {
    if (!selectedContractId || !paymentAmount) {
      toast({ title: "Error", description: "Amount is required", variant: "destructive" });
      return;
    }

    try {
      await createPaymentMutation.mutateAsync({
        contractId: selectedContractId,
        projectCode,
        amount: paymentAmount,
        description: paymentDescription || undefined,
        invoiceNumber: paymentInvoiceNumber || undefined,
        paymentDate: paymentDate ? new Date(paymentDate).toISOString() : undefined,
      });
      toast({ title: "Success", description: "Payment recorded" });
      setShowPaymentDialog(false);
      setSelectedContractId(null);
      setPaymentAmount("");
      setPaymentDescription("");
      setPaymentInvoiceNumber("");
      setPaymentDate(format(new Date(), "yyyy-MM-dd"));
    } catch (error) {
      toast({ title: "Error", description: "Failed to record payment", variant: "destructive" });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Subcontractors & Contracts</CardTitle>
        </CardHeader>
        <CardContent>
          {subcontractorsLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading subcontractors...</div>
          ) : subcontractors.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No subcontractor contracts yet"
              description="Add subcontractor contracts to track work and payments."
              testId="empty-state-subcontractors"
            />
          ) : (
            <div className="space-y-4">
              {subcontractors.map((contract, idx) => (
                <Card
                  key={contract.id}
                  data-testid={`subcontractor-${contract.id}`}
                  className="cursor-pointer data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-offset-2 data-[focused=true]:ring-offset-background"
                  {...getContractRowProps(idx)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <CardTitle className="text-base">
                            {contract.subcontractor?.companyName || "Unknown Subcontractor"}
                          </CardTitle>
                          <Badge variant={
                            contract.status === "ACTIVE" ? "default" :
                            contract.status === "COMPLETED" ? "outline" :
                            "secondary"
                          }>
                            {contract.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">
                          Contract #{contract.contractNumber}
                        </p>
                        {contract.subcontractor?.contactName && (
                          <p className="text-xs text-muted-foreground">
                            Contact: {contract.subcontractor.contactName}
                            {contract.subcontractor.phone && ` • ${contract.subcontractor.phone}`}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold font-mono">
                          ${parseFloat(contract.contractAmount).toLocaleString()}
                        </p>
                        {contract.retentionPercent && (
                          <p className="text-xs text-muted-foreground">
                            {contract.retentionPercent}% retention
                          </p>
                        )}
                        {(contract.totalPaid > 0 || contract.remainingBalance !== Number(contract.contractAmount)) && (
                          <div className="mt-2 text-sm">
                            <p className="text-green-600 dark:text-green-500">
                              Paid: ${contract.totalPaid.toLocaleString()}
                            </p>
                            <p className={`${contract.remainingBalance > 0 ? 'text-yellow-600 dark:text-yellow-500' : 'text-muted-foreground'}`}>
                              Balance: ${contract.remainingBalance.toLocaleString()}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-sm font-medium mb-1">Scope of Work</p>
                      <p className="text-sm text-muted-foreground">{contract.scopeOfWork}</p>
                    </div>
                    
                    {(contract.startDate || contract.completionDate) && (
                      <div className="flex items-center gap-4 text-sm">
                        {contract.startDate && (
                          <div>
                            <span className="text-muted-foreground">Start: </span>
                            <span className="font-medium">
                              {format(new Date(contract.startDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        )}
                        {contract.completionDate && (
                          <div>
                            <span className="text-muted-foreground">Completion: </span>
                            <span className="font-medium">
                              {format(new Date(contract.completionDate), "MMM d, yyyy")}
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    {contract.paymentTerms && (
                      <div>
                        <p className="text-sm font-medium mb-1">Payment Terms</p>
                        <p className="text-sm text-muted-foreground">{contract.paymentTerms}</p>
                      </div>
                    )}

                    {contract.notes && (
                      <div>
                        <p className="text-sm font-medium mb-1">Notes</p>
                        <p className="text-sm text-muted-foreground">{contract.notes}</p>
                      </div>
                    )}
                    
                    <div className="pt-2 border-t">
                      <Button
                        size="sm"
                        onClick={() => {
                          setSelectedContractId(contract.id);
                          setShowPaymentDialog(true);
                        }}
                        data-testid={`button-record-payment-${contract.id}`}
                      >
                        <DollarSign className="w-4 h-4 mr-2" />
                        Record Payment
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {pendingQuotes && (pendingQuotes.subcontractorQuotes.length > 0 || pendingQuotes.materialQuotes.length > 0) && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Pending Quotes from Bid
            </CardTitle>
            <CardDescription>
              These quotes were collected during the bid phase. Select the ones you want to convert into contracts or procurement items.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {pendingQuotes.subcontractorQuotes.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground">Subcontractor Quotes</h4>
                {pendingQuotes.subcontractorQuotes.map((quote) => (
                  <Card 
                    key={quote.id} 
                    className="border-dashed hover-elevate cursor-pointer" 
                    data-testid={`pending-sub-quote-${quote.id}`}
                    onClick={() => {
                      setSelectedQuote({ type: "subcontractor", data: quote });
                      setShowQuoteDetailDialog(true);
                    }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{quote.subcontractorName}</span>
                            <Badge variant="secondary">Pending</Badge>
                            {quote.fileUrl && (
                              <Badge variant="outline" className="text-xs">
                                <FileText className="w-3 h-3 mr-1" />
                                Has Attachment
                              </Badge>
                            )}
                          </div>
                          {quote.contactName && (
                            <p className="text-xs text-muted-foreground">
                              Contact: {quote.contactName}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(quote.quoteAmount).toLocaleString()}
                          </p>
                          {quote.leadTime && (
                            <p className="text-xs text-muted-foreground">
                              Lead: {quote.leadTime}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div>
                        <p className="text-sm font-medium mb-1">Scope of Work</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{quote.scopeOfWork}</p>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          Click to view details • Added: {format(new Date(quote.createdAt), "MMM d, yyyy")}
                        </p>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectSubQuoteMutation.mutate(quote.id);
                          }}
                          disabled={selectSubQuoteMutation.isPending}
                          data-testid={`button-select-sub-quote-${quote.id}`}
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {selectSubQuoteMutation.isPending ? "Creating..." : "Select & Create Contract"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {pendingQuotes.materialQuotes.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-muted-foreground">Material Quotes</h4>
                {pendingQuotes.materialQuotes.map((quote) => (
                  <Card 
                    key={quote.id} 
                    className="border-dashed hover-elevate cursor-pointer" 
                    data-testid={`pending-mat-quote-${quote.id}`}
                    onClick={() => {
                      setSelectedQuote({ type: "material", data: quote });
                      setShowQuoteDetailDialog(true);
                    }}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium">{quote.materialName}</span>
                            <Badge variant="secondary">Pending</Badge>
                            {quote.fileUrl && (
                              <Badge variant="outline" className="text-xs">
                                <FileText className="w-3 h-3 mr-1" />
                                Has Attachment
                              </Badge>
                            )}
                          </div>
                          {quote.supplierName && (
                            <p className="text-xs text-muted-foreground">
                              Supplier: {quote.supplierName}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold font-mono">
                            ${parseFloat(quote.cost).toLocaleString()}
                          </p>
                          {quote.leadTime && (
                            <p className="text-xs text-muted-foreground">
                              Lead: {quote.leadTime}
                            </p>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div>
                        <p className="text-sm font-medium mb-1">Description</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">{quote.description}</p>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t">
                        <p className="text-xs text-muted-foreground">
                          Click to view details • Added: {format(new Date(quote.createdAt), "MMM d, yyyy")}
                        </p>
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectMatQuoteMutation.mutate(quote.id);
                          }}
                          disabled={selectMatQuoteMutation.isPending}
                          data-testid={`button-select-mat-quote-${quote.id}`}
                        >
                          <CheckCircle className="w-4 h-4 mr-2" />
                          {selectMatQuoteMutation.isPending ? "Creating..." : "Select & Create Procurement"}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showQuoteDetailDialog} onOpenChange={(open) => {
        setShowQuoteDetailDialog(open);
        if (!open) setSelectedQuote(null);
      }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-quote-detail">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedQuote?.type === "subcontractor" ? (
                <>
                  <Users className="w-5 h-5" />
                  Subcontractor Quote Details
                </>
              ) : (
                <>
                  <Package className="w-5 h-5" />
                  Material Quote Details
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              Review the full details of this quote before selecting it.
            </DialogDescription>
          </DialogHeader>

          {selectedQuote && (
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <h3 className="text-lg font-semibold">
                    {selectedQuote.type === "subcontractor" 
                      ? selectedQuote.data.subcontractorName 
                      : selectedQuote.data.materialName}
                  </h3>
                  <Badge variant="secondary" className="mt-1">Pending Selection</Badge>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold font-mono text-primary">
                    ${parseFloat(selectedQuote.type === "subcontractor" 
                      ? selectedQuote.data.quoteAmount 
                      : selectedQuote.data.cost).toLocaleString()}
                  </p>
                  {selectedQuote.data.leadTime && (
                    <p className="text-sm text-muted-foreground mt-1">
                      <Clock className="w-3 h-3 inline mr-1" />
                      Lead Time: {selectedQuote.data.leadTime}
                    </p>
                  )}
                </div>
              </div>

              {selectedQuote.type === "subcontractor" && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <User className="w-4 h-4" />
                    Contact Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Name</p>
                      <p className="text-sm font-medium">{selectedQuote.data.contactName || "Not provided"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Phone</p>
                      <p className="text-sm font-medium">{selectedQuote.data.contactPhone || "Not provided"}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm font-medium">{selectedQuote.data.contactEmail || "Not provided"}</p>
                    </div>
                  </div>
                </div>
              )}

              {selectedQuote.type === "material" && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Supplier Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 border rounded-lg">
                    <div>
                      <p className="text-xs text-muted-foreground">Supplier Name</p>
                      <p className="text-sm font-medium">{selectedQuote.data.supplierName || "Not provided"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Contact</p>
                      <p className="text-sm font-medium">{selectedQuote.data.supplierContact || "Not provided"}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  {selectedQuote.type === "subcontractor" ? "Scope of Work" : "Description"}
                </h4>
                <div className="p-3 border rounded-lg bg-card">
                  <p className="text-sm whitespace-pre-wrap">
                    {selectedQuote.type === "subcontractor" 
                      ? selectedQuote.data.scopeOfWork 
                      : selectedQuote.data.description}
                  </p>
                </div>
              </div>

              {selectedQuote.type === "material" && selectedQuote.data.specs && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Ruler className="w-4 h-4" />
                    Specifications
                  </h4>
                  <div className="p-3 border rounded-lg bg-card">
                    <p className="text-sm whitespace-pre-wrap">{selectedQuote.data.specs}</p>
                  </div>
                </div>
              )}

              {selectedQuote.type === "subcontractor" && selectedQuote.data.estimatedCompletionTime && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <CalendarCheck className="w-4 h-4" />
                    Estimated Completion Time
                  </h4>
                  <div className="p-3 border rounded-lg">
                    <p className="text-sm">{selectedQuote.data.estimatedCompletionTime}</p>
                  </div>
                </div>
              )}

              {selectedQuote.data.notes && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <StickyNote className="w-4 h-4" />
                    Notes
                  </h4>
                  <div className="p-3 border rounded-lg bg-card">
                    <p className="text-sm whitespace-pre-wrap">{selectedQuote.data.notes}</p>
                  </div>
                </div>
              )}

              {selectedQuote.data.fileUrl && (
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Paperclip className="w-4 h-4" />
                    Attached Document
                  </h4>
                  <div className="p-3 border rounded-lg flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-8 h-8 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{selectedQuote.data.fileName || "Document"}</p>
                        {selectedQuote.data.fileSize && (
                          <p className="text-xs text-muted-foreground">
                            {(selectedQuote.data.fileSize / 1024).toFixed(1)} KB
                          </p>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(selectedQuote.data.fileUrl, '_blank')}
                      data-testid="button-view-quote-attachment"
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      View File
                    </Button>
                  </div>
                </div>
              )}

              <div className="pt-4 border-t text-xs text-muted-foreground">
                <p>Added: {format(new Date(selectedQuote.data.createdAt), "MMMM d, yyyy 'at' h:mm a")}</p>
                {selectedQuote.data.updatedAt !== selectedQuote.data.createdAt && (
                  <p>Updated: {format(new Date(selectedQuote.data.updatedAt), "MMMM d, yyyy 'at' h:mm a")}</p>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setShowQuoteDetailDialog(false)}
              data-testid="button-close-quote-detail"
            >
              Close
            </Button>
            <Button
              onClick={() => {
                if (selectedQuote?.type === "subcontractor") {
                  selectSubQuoteMutation.mutate(selectedQuote.data.id);
                } else if (selectedQuote?.type === "material") {
                  selectMatQuoteMutation.mutate(selectedQuote.data.id);
                }
                setShowQuoteDetailDialog(false);
              }}
              disabled={selectSubQuoteMutation.isPending || selectMatQuoteMutation.isPending}
              data-testid="button-select-quote-from-dialog"
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              {selectedQuote?.type === "subcontractor" ? "Select & Create Contract" : "Select & Create Procurement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentDialog} onOpenChange={(open) => {
        setShowPaymentDialog(open);
        if (!open) setSelectedContractId(null);
      }}>
        <DialogContent data-testid="dialog-record-payment">
          <DialogHeader>
            <DialogTitle>Record Subcontractor Payment</DialogTitle>
            <DialogDescription>
              Enter payment details. Payments entered here flow to the project financials.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="payment-amount">Amount ($) *</Label>
              <Input
                id="payment-amount"
                type="number"
                step="0.01"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-payment-amount"
              />
            </div>
            <div>
              <Label htmlFor="payment-description">Description</Label>
              <Input
                id="payment-description"
                value={paymentDescription}
                onChange={(e) => setPaymentDescription(e.target.value)}
                placeholder="Progress payment, final payment, etc..."
                data-testid="input-payment-description"
              />
            </div>
            <div>
              <Label htmlFor="payment-invoice">Invoice Number</Label>
              <Input
                id="payment-invoice"
                value={paymentInvoiceNumber}
                onChange={(e) => setPaymentInvoiceNumber(e.target.value)}
                placeholder="INV-001..."
                data-testid="input-payment-invoice"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-date">Payment Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowPaymentDialog(false);
              setSelectedContractId(null);
            }}>
              Cancel
            </Button>
            <Button
              onClick={handleCreatePayment}
              disabled={createPaymentMutation.isPending}
              data-testid="button-submit-payment"
            >
              {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
