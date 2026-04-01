import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Calculator, Package, Truck, Users, Clock, FileText, DollarSign, Building2, Calendar, CheckCircle2, Send, Pencil, Check, X } from "lucide-react";
import BidDocumentDistribution from "@/components/BidDocumentDistribution";
import JobInformationForm from "@/components/JobInformationForm";
import { format } from "date-fns";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BidSummaryStepProps {
  bid: any;
  bidCode: string;
  totalMaterialCost: number;
  totalEquipmentCost: number;
  laborCost: number;
  totalSubcontractorCost: number;
  directCost: number;
  overheadPercent: number;
  overheadAmount: number;
  profitPercent: number;
  profitAmount: number;
  finalBidAmount: number;
  canEdit: boolean;
  canGeneratePDFs: boolean;
  userRole: string;
  useVendorMaterial: boolean;
  useVendorEquipment: boolean;
  useVendorSubs: boolean;
  onOverheadChange: (value: number) => void;
  onProfitChange: (value: number) => void;
  onPrevStep: () => void;
  onAwardBid: () => void;
  onNavigateEstimate: () => void;
  onSubmitBid?: () => void;
  isSubmittingBid?: boolean;
}

export default function BidSummaryStep({
  bid,
  bidCode,
  totalMaterialCost,
  totalEquipmentCost,
  laborCost,
  totalSubcontractorCost,
  directCost,
  overheadPercent,
  overheadAmount,
  profitPercent,
  profitAmount,
  finalBidAmount,
  canEdit,
  canGeneratePDFs,
  userRole,
  useVendorMaterial,
  useVendorEquipment,
  useVendorSubs,
  onOverheadChange,
  onProfitChange,
  onPrevStep,
  onAwardBid,
  onNavigateEstimate,
  onSubmitBid,
  isSubmittingBid = false,
}: BidSummaryStepProps) {
  const { toast } = useToast();
  const [isEditingBidAmount, setIsEditingBidAmount] = useState(false);
  const [editBidAmountValue, setEditBidAmountValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const autoPopulatedForBid = useRef<string | null>(null);

  const updateBidAmountMutation = useMutation({
    mutationFn: async (amount: string) => {
      return apiRequest("PATCH", `/api/bids/${bidCode}`, { bidAmount: amount });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bids", bidCode] });
      queryClient.invalidateQueries({ queryKey: ["/api/bids"] });
      toast({ title: "Success", description: "Bid amount updated" });
      setIsEditingBidAmount(false);
    },
    onError: (_, variables) => {
      if (autoPopulatedForBid.current === bidCode) {
        autoPopulatedForBid.current = null;
      }
      toast({ title: "Error", description: "Failed to update bid amount", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (
      canEdit &&
      (bid.bidAmount === null || bid.bidAmount === undefined) &&
      finalBidAmount > 0 &&
      autoPopulatedForBid.current !== bidCode
    ) {
      autoPopulatedForBid.current = bidCode;
      updateBidAmountMutation.mutate(String(finalBidAmount.toFixed(2)));
    }
  }, [finalBidAmount, bid.bidAmount, bidCode, canEdit]);

  const handleStartEdit = () => {
    setEditBidAmountValue(bid.bidAmount ? String(Number(bid.bidAmount)) : "");
    setIsEditingBidAmount(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSaveEdit = () => {
    const val = parseFloat(editBidAmountValue);
    if (isNaN(val) || val <= 0) {
      toast({ title: "Invalid amount", description: "Please enter a valid positive number", variant: "destructive" });
      return;
    }
    updateBidAmountMutation.mutate(String(val));
  };

  const handleCancelEdit = () => {
    setIsEditingBidAmount(false);
    setEditBidAmountValue("");
  };

  const handleSetToFinalAmount = () => {
    if (finalBidAmount > 0) {
      updateBidAmountMutation.mutate(String(finalBidAmount.toFixed(2)));
    }
  };

  return (
    <div className="space-y-6">
      <Card data-testid="card-bid-summary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Step 6: Bid Summary & Pricing
          </CardTitle>
          <CardDescription>Review costs and set your overhead and profit margins</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Materials</p>
                </div>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${useVendorMaterial ? 'text-green-600 border-green-300' : 'text-blue-600 border-blue-300'}`}>
                  {useVendorMaterial ? 'Vendor Quotes' : 'Estimate'}
                </Badge>
              </div>
              <p className="text-lg font-bold font-mono" data-testid="text-summary-material">${totalMaterialCost.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Truck className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Equipment</p>
                </div>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${useVendorEquipment ? 'text-green-600 border-green-300' : 'text-blue-600 border-blue-300'}`}>
                  {useVendorEquipment ? 'Selections' : 'Estimate'}
                </Badge>
              </div>
              <p className="text-lg font-bold font-mono" data-testid="text-summary-equipment">${totalEquipmentCost.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Labor</p>
                </div>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-600 border-blue-300">
                  Estimate
                </Badge>
              </div>
              <p className="text-lg font-bold font-mono" data-testid="text-summary-labor">${laborCost.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <p className="text-sm font-medium">Subcontractors</p>
                </div>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${useVendorSubs ? 'text-green-600 border-green-300' : 'text-blue-600 border-blue-300'}`}>
                  {useVendorSubs ? 'Vendor Quotes' : 'Estimate'}
                </Badge>
              </div>
              <p className="text-lg font-bold font-mono" data-testid="text-summary-subs">${totalSubcontractorCost.toLocaleString()}</p>
            </div>
          </div>

          <div className="p-4 border rounded-md bg-muted/30">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Direct Cost (Total)</span>
              <span className="text-xl font-bold font-mono">${directCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Overhead</Label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg">{overheadPercent}%</span>
                <span className="text-muted-foreground">= ${overheadAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <Slider
              value={[overheadPercent]}
              onValueChange={(value) => onOverheadChange(value[0])}
              min={0}
              max={30}
              step={1}
              className="w-full"
              data-testid="slider-overhead"
            />
            <p className="text-xs text-muted-foreground">Covers administrative costs, office expenses, insurance, etc.</p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Profit Margin</Label>
              <div className="flex items-center gap-2">
                <span className="font-mono text-lg text-green-600 dark:text-green-400">{profitPercent}%</span>
                <span className="text-green-600 dark:text-green-400">= ${profitAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <Slider
              value={[profitPercent]}
              onValueChange={(value) => onProfitChange(value[0])}
              min={0}
              max={40}
              step={1}
              className="w-full"
              data-testid="slider-profit"
            />
            <p className="text-xs text-muted-foreground">Your target profit margin on this project</p>
          </div>

          <div className="p-4 sm:p-6 bg-primary/10 rounded-md border border-primary/20">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="text-lg sm:text-xl font-bold">Final Bid Amount</span>
                <p className="text-xs sm:text-sm text-muted-foreground mt-1">Direct Cost + Overhead + Profit</p>
              </div>
              <span className="text-2xl sm:text-3xl font-bold font-mono" data-testid="text-final-bid-amount">
                ${finalBidAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {canGeneratePDFs && (
            <div className="p-4 bg-muted/30 rounded-md border">
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Generate Documents
              </h4>
              <div className="flex flex-col sm:flex-row flex-wrap gap-2 sm:gap-3">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => window.open(`/api/bids/${bidCode}/pdf/internal-summary`, '_blank')}
                  data-testid="button-download-internal-pdf"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Internal Bid Summary (PDF)
                </Button>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => window.open(`/api/bids/${bidCode}/pdf/customer-quote`, '_blank')}
                  data-testid="button-download-customer-pdf"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Customer Quote (PDF)
                </Button>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => window.open(`/api/bids/${bidCode}/pdf/warranty-contract`, '_blank')}
                  data-testid="button-download-warranty-pdf"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Warranty Contract (PDF)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Internal summary includes all vendor quotes and detailed costs. Customer quote shows only scope of work and final pricing. Warranty contract outlines warranty terms, exclusions, and claim procedures.
              </p>
            </div>
          )}

          {canEdit && onSubmitBid && (
            <div className="p-4 border rounded-lg bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Submit Bid to Client
                  </h4>
                  {bid.submittedAt ? (
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                      Submitted {format(new Date(bid.submittedAt), 'PPP p')}
                    </p>
                  ) : (
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                      Send the customer quote PDF to {bid.clientContactEmail || bid.clientName || "the client"} via email.
                    </p>
                  )}
                </div>
                <Button
                  variant={bid.submittedAt ? "outline" : "default"}
                  size="sm"
                  onClick={onSubmitBid}
                  disabled={isSubmittingBid}
                  className="w-full sm:w-auto shrink-0"
                  data-testid="button-submit-bid-to-client"
                >
                  <Send className="w-4 h-4 mr-2" />
                  {isSubmittingBid ? "Sending..." : bid.submittedAt ? "Resend to Client" : "Submit to Client"}
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-2 pt-4">
            <Button variant="outline" className="w-full sm:w-auto" onClick={onPrevStep} data-testid="button-prev-step-6">
              Back to Subcontractors
            </Button>
            {canEdit && (
              <Button className="w-full sm:w-auto" onClick={onAwardBid} data-testid="button-award-bid">
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Award Bid & Create Project
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <BidDocumentDistribution
        bidId={bid?.id}
        projectId={bid?.projectId || undefined}
        projectName={bid?.name}
        userRole={userRole}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Bid Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <DollarSign className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Current Bid Amount</p>
                {isEditingBidAmount ? (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="relative flex-1">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                      <Input
                        ref={inputRef}
                        type="number"
                        step="0.01"
                        min="0"
                        value={editBidAmountValue}
                        onChange={(e) => setEditBidAmountValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") handleCancelEdit();
                        }}
                        className="pl-6 h-8 font-mono"
                        placeholder="0.00"
                        data-testid="input-inline-bid-amount"
                      />
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-green-600 hover:text-green-700"
                      onClick={handleSaveEdit}
                      disabled={updateBidAmountMutation.isPending}
                      data-testid="button-save-bid-amount"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={handleCancelEdit}
                      disabled={updateBidAmountMutation.isPending}
                      data-testid="button-cancel-bid-amount"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p
                      className={`text-lg font-bold font-mono ${canEdit ? 'cursor-pointer hover:text-primary transition-colors' : ''}`}
                      onClick={canEdit ? handleStartEdit : undefined}
                      title={canEdit ? "Click to edit" : undefined}
                      data-testid="text-current-bid-amount"
                    >
                      {bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString()}` : 'Not Set'}
                    </p>
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={handleStartEdit}
                        disabled={updateBidAmountMutation.isPending}
                        data-testid="button-edit-bid-amount"
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                    )}
                    {canEdit && bid.bidAmount && Number(bid.bidAmount) !== finalBidAmount && finalBidAmount > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        onClick={handleSetToFinalAmount}
                        disabled={updateBidAmountMutation.isPending}
                        data-testid="button-set-to-final-amount"
                      >
                        Set to Final Amount
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Due Date</p>
                <p className="text-sm text-muted-foreground">
                  {bid.dueDate ? format(new Date(bid.dueDate), 'PPP') : 'Not set'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Building2 className="w-5 h-5 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Client</p>
                <p className="text-sm text-muted-foreground">{bid.clientName}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Documents & Handoff</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              className="w-full justify-start"
              variant="outline"
              onClick={onNavigateEstimate}
            >
              <FileText className="w-4 h-4 mr-2" />
              View Full Estimate
            </Button>
            <JobInformationForm bidCode={bidCode} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
