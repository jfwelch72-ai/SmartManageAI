import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Calculator, Package, Truck, Users, Clock, FileText, DollarSign, Building2, Calendar, CheckCircle2 } from "lucide-react";
import BidDocumentDistribution from "@/components/BidDocumentDistribution";
import JobInformationForm from "@/components/JobInformationForm";
import { format } from "date-fns";

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
  onOverheadChange: (value: number) => void;
  onProfitChange: (value: number) => void;
  onPrevStep: () => void;
  onAwardBid: () => void;
  onNavigateEstimate: () => void;
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
  onOverheadChange,
  onProfitChange,
  onPrevStep,
  onAwardBid,
  onNavigateEstimate,
}: BidSummaryStepProps) {
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
              <div className="flex items-center gap-2 mb-1">
                <Package className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-medium">Materials</p>
              </div>
              <p className="text-lg font-bold font-mono">${totalMaterialCost.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center gap-2 mb-1">
                <Truck className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-medium">Equipment</p>
              </div>
              <p className="text-lg font-bold font-mono">${totalEquipmentCost.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-medium">Labor</p>
              </div>
              <p className="text-lg font-bold font-mono">${laborCost.toLocaleString()}</p>
            </div>
            <div className="p-4 bg-muted rounded-md">
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-muted-foreground" />
                <p className="text-sm font-medium">Subcontractors</p>
              </div>
              <p className="text-lg font-bold font-mono">${totalSubcontractorCost.toLocaleString()}</p>
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
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Internal summary includes all vendor quotes and detailed costs. Customer quote shows only scope of work and final pricing.
              </p>
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
              <div>
                <p className="text-sm font-medium">Current Bid Amount</p>
                <p className="text-lg font-bold font-mono">
                  {bid.bidAmount ? `$${Number(bid.bidAmount).toLocaleString()}` : 'Not Set'}
                </p>
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
