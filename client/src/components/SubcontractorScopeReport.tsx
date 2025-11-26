import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer, FileText, Truck, Building2, Phone, Mail, Calendar, DollarSign, Package } from "lucide-react";
import type { BidSubcontractorQuote, EstimateLineItem, Estimate } from "@shared/schema";
import { format } from "date-fns";

interface SubcontractorScopeReportProps {
  quote: BidSubcontractorQuote;
  estimate?: Estimate | null;
  lineItems: EstimateLineItem[];
  bidName: string;
  bidCode: string;
  onClose?: () => void;
}

interface MaterialSummary {
  totalConcreteYards: number;
  totalStoneTons: number;
  totalExcavationYards: number;
  itemCount: number;
}

export function SubcontractorScopeReport({
  quote,
  estimate,
  lineItems,
  bidName,
  bidCode,
  onClose,
}: SubcontractorScopeReportProps) {
  const formatCurrency = (amount: number | string) => {
    const num = typeof amount === "string" ? parseFloat(amount) : amount;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(num || 0);
  };

  const formatDecimal = (value: string | number | null | undefined, decimals = 2) => {
    if (value === null || value === undefined) return "0.00";
    const num = typeof value === "string" ? parseFloat(value) : value;
    return num.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  };

  const getSubcontractedItems = () => {
    return lineItems.filter((item) => {
      // Item must have a subcontract cost
      if (!item.subcontractCost || parseFloat(item.subcontractCost) <= 0) {
        return false;
      }
      // Item must be explicitly assigned to this subcontractor quote
      // Items without subcontractorQuoteId are unassigned and should not appear on any report
      return item.subcontractorQuoteId === quote.id;
    });
  };

  const calculateMaterialSummary = (): MaterialSummary => {
    let totalConcreteYards = 0;
    let totalStoneTons = 0;
    let totalExcavationYards = 0;
    let itemCount = 0;

    const filteredItems = getSubcontractedItems();
    filteredItems.forEach((item) => {
      itemCount++;
      if (item.calculatedConcreteYards) {
        totalConcreteYards += parseFloat(item.calculatedConcreteYards);
      }
      if (item.calculatedStoneTons) {
        totalStoneTons += parseFloat(item.calculatedStoneTons);
      }
      if (item.calculatedExcavationYards) {
        totalExcavationYards += parseFloat(item.calculatedExcavationYards);
      }
    });

    return { totalConcreteYards, totalStoneTons, totalExcavationYards, itemCount };
  };

  const subcontractedItems = getSubcontractedItems();
  const materialSummary = calculateMaterialSummary();

  const handlePrint = () => {
    window.print();
  };

  const reportDate = format(new Date(), "MMMM d, yyyy");

  return (
    <div className="print-container">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print-container, .print-container * {
            visibility: visible;
          }
          .print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            padding: 20px;
          }
          .no-print {
            display: none !important;
          }
          .print-page-break {
            page-break-after: always;
          }
          @page {
            margin: 0.75in;
            size: letter;
          }
        }
      `}</style>

      <div className="no-print flex justify-end gap-2 mb-4">
        <Button variant="outline" onClick={onClose} data-testid="button-close-report">
          Close
        </Button>
        <Button onClick={handlePrint} data-testid="button-print-report">
          <Printer className="h-4 w-4 mr-2" />
          Print Report
        </Button>
      </div>

      <div className="bg-background p-6 border rounded-lg" data-testid="report-content">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">TFR CONSTRUCTION</h1>
            <p className="text-muted-foreground">Subcontractor Scope & Materials Report</p>
          </div>
          <div className="text-right">
            <Badge variant="secondary" className="text-base" data-testid="badge-report-date">
              {reportDate}
            </Badge>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="grid grid-cols-2 gap-8 mb-6">
          <div data-testid="section-project-info">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Project Information
            </h2>
            <div className="space-y-2">
              <p><span className="text-muted-foreground">Project Name:</span> <span className="font-medium">{bidName}</span></p>
              <p><span className="text-muted-foreground">Project Code:</span> <span className="font-medium">{bidCode}</span></p>
              {estimate && estimate.baseBidAmount && (
                <p><span className="text-muted-foreground">Base Bid Amount:</span> <span className="font-medium">{formatCurrency(estimate.baseBidAmount)}</span></p>
              )}
            </div>
          </div>

          <div data-testid="section-subcontractor-info">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Subcontractor
            </h2>
            <div className="space-y-2">
              <p className="font-medium text-lg">{quote.subcontractorName}</p>
              {quote.contactName && (
                <p className="flex items-center gap-2">
                  <span className="text-muted-foreground">Contact:</span> {quote.contactName}
                </p>
              )}
              {quote.contactPhone && (
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  {quote.contactPhone}
                </p>
              )}
              {quote.contactEmail && (
                <p className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {quote.contactEmail}
                </p>
              )}
            </div>
          </div>
        </div>

        <Card className="mb-6 border-primary/20" data-testid="card-contract-summary">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Contract Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-3 bg-muted/50 rounded-md">
                <p className="text-sm text-muted-foreground">Contract Amount</p>
                <p className="text-xl font-bold" data-testid="text-contract-amount">
                  {formatCurrency(quote.quoteAmount)}
                </p>
              </div>
              {quote.leadTime && (
                <div className="p-3 bg-muted/50 rounded-md">
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Lead Time
                  </p>
                  <p className="text-lg font-semibold">{quote.leadTime}</p>
                </div>
              )}
              {quote.estimatedCompletionTime && (
                <div className="p-3 bg-muted/50 rounded-md">
                  <p className="text-sm text-muted-foreground">Est. Completion</p>
                  <p className="text-lg font-semibold">{quote.estimatedCompletionTime}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="mb-6" data-testid="section-scope-of-work">
          <h2 className="text-lg font-semibold mb-3">Scope of Work</h2>
          <div className="p-4 bg-muted/30 rounded-md border">
            <p className="whitespace-pre-wrap" data-testid="text-scope-of-work">{quote.scopeOfWork}</p>
          </div>
        </div>

        {(materialSummary.totalConcreteYards > 0 || materialSummary.totalStoneTons > 0 || materialSummary.totalExcavationYards > 0) && (
          <Card className="mb-6 border-green-500/30 bg-green-50/50 dark:bg-green-950/20" data-testid="card-materials-provided">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-green-700 dark:text-green-400">
                <Truck className="h-5 w-5" />
                Materials Provided By: TFR Construction
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                {materialSummary.totalConcreteYards > 0 && (
                  <div className="p-3 bg-background rounded-md border" data-testid="metric-concrete">
                    <p className="text-sm text-muted-foreground">Concrete</p>
                    <p className="text-xl font-bold">{formatDecimal(materialSummary.totalConcreteYards)} CY</p>
                    <p className="text-xs text-muted-foreground">Cubic Yards</p>
                  </div>
                )}
                {materialSummary.totalStoneTons > 0 && (
                  <div className="p-3 bg-background rounded-md border" data-testid="metric-stone">
                    <p className="text-sm text-muted-foreground">Stone Base</p>
                    <p className="text-xl font-bold">{formatDecimal(materialSummary.totalStoneTons)} Tons</p>
                    <p className="text-xs text-muted-foreground">Aggregate</p>
                  </div>
                )}
                {materialSummary.totalExcavationYards > 0 && (
                  <div className="p-3 bg-background rounded-md border" data-testid="metric-excavation">
                    <p className="text-sm text-muted-foreground">Excavation</p>
                    <p className="text-xl font-bold">{formatDecimal(materialSummary.totalExcavationYards)} CY</p>
                    <p className="text-xs text-muted-foreground">Material Removal</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {subcontractedItems.length > 0 && (
          <div className="mb-6" data-testid="section-line-items">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <Package className="h-5 w-5" />
              Subcontracted Line Items ({subcontractedItems.length})
            </h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-center">Qty</TableHead>
                  <TableHead className="text-center">Unit</TableHead>
                  <TableHead className="text-right">Subcontract Cost</TableHead>
                  <TableHead className="text-center">Concrete (CY)</TableHead>
                  <TableHead className="text-center">Stone (Tons)</TableHead>
                  <TableHead className="text-center">Excavation (CY)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subcontractedItems.map((item) => (
                  <TableRow key={item.id} data-testid={`row-line-item-${item.id}`}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell className="text-center">{formatDecimal(item.quantity)}</TableCell>
                    <TableCell className="text-center">{item.unit}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.subcontractCost || 0)}</TableCell>
                    <TableCell className="text-center">
                      {item.calculatedConcreteYards ? formatDecimal(item.calculatedConcreteYards) : "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.calculatedStoneTons ? formatDecimal(item.calculatedStoneTons) : "-"}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.calculatedExcavationYards ? formatDecimal(item.calculatedExcavationYards) : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {quote.notes && (
          <div className="mb-6" data-testid="section-notes">
            <h2 className="text-lg font-semibold mb-3">Notes</h2>
            <div className="p-4 bg-muted/30 rounded-md border">
              <p className="whitespace-pre-wrap">{quote.notes}</p>
            </div>
          </div>
        )}

        <Separator className="my-6" />

        <div className="text-center text-sm text-muted-foreground">
          <p>This document is for internal use only and subject to the terms of the subcontractor agreement.</p>
          <p className="mt-1">Generated on {reportDate} by TFR Construction Management Platform</p>
        </div>
      </div>
    </div>
  );
}

interface SubcontractorScopeReportDialogProps {
  quote: BidSubcontractorQuote;
  estimate?: Estimate | null;
  lineItems: EstimateLineItem[];
  bidName: string;
  bidCode: string;
  trigger?: React.ReactNode;
}

export function SubcontractorScopeReportDialog({
  quote,
  estimate,
  lineItems,
  bidName,
  bidCode,
  trigger,
}: SubcontractorScopeReportDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" data-testid="button-view-scope-report">
            <FileText className="h-4 w-4 mr-1" />
            Scope Report
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Subcontractor Scope Report</DialogTitle>
        </DialogHeader>
        <SubcontractorScopeReport
          quote={quote}
          estimate={estimate}
          lineItems={lineItems}
          bidName={bidName}
          bidCode={bidCode}
        />
      </DialogContent>
    </Dialog>
  );
}
