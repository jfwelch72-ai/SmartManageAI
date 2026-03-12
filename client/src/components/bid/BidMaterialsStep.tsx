import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Package, Plus, Edit, Trash2, FileText, CheckCircle2, ChevronRight, Send, Clock } from "lucide-react";
import type { BidMaterialQuote } from "@shared/schema";

interface DerivedMaterialRequirement {
  id: string;
  category: string;
  description: string;
  unit: string;
  quantity: number;
  materialCost: number;
  needsVendorSelection: boolean;
}

interface BidMaterialsStepProps {
  materialQuotes: BidMaterialQuote[];
  materialQuotesLoading: boolean;
  totalMaterialCost: number;
  derivedMaterialRequirements: DerivedMaterialRequirement[];
  canEdit: boolean;
  toggleSelectionPending: boolean;
  onAddQuote: () => void;
  onEditQuote: (quote: BidMaterialQuote) => void;
  onDeleteQuote: (quoteId: string) => void;
  onToggleSelection: (quoteId: string, isSelected: boolean) => void;
  onSendRfq?: (quoteId: string) => void;
  sendRfqPending?: boolean;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export default function BidMaterialsStep({
  materialQuotes,
  materialQuotesLoading,
  totalMaterialCost,
  derivedMaterialRequirements,
  canEdit,
  toggleSelectionPending,
  onAddQuote,
  onEditQuote,
  onDeleteQuote,
  onToggleSelection,
  onSendRfq,
  sendRfqPending,
  onPrevStep,
  onNextStep,
}: BidMaterialsStepProps) {
  return (
    <Card data-testid="card-material-quotes">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Package className="w-5 h-5 shrink-0" />
            Step 3: Material & Supply Quotes
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm">Get quotes from suppliers for materials identified in the Scope of Work</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={onAddQuote} size="sm" className="w-full sm:w-auto" data-testid="button-add-material-quote">
            <Plus className="w-4 h-4 mr-2" />
            Add Quote
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {derivedMaterialRequirements.length > 0 && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Material Requirements from SOW ({derivedMaterialRequirements.length} items)
            </h4>
            <div className="space-y-2">
              {derivedMaterialRequirements.map((req) => (
                <div key={req.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap min-w-0">
                    <Badge variant="secondary" className="text-xs shrink-0">{req.category}</Badge>
                    <span className="text-muted-foreground truncate">{req.description}</span>
                    <span className="text-muted-foreground shrink-0">({req.quantity} {req.unit})</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono">${req.materialCost.toLocaleString()}</span>
                    {req.needsVendorSelection ? (
                      <Badge variant="outline" className="text-orange-600 border-orange-300">Needs Quote</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-300">Quote Added</Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {materialQuotesLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading material quotes...</div>
        ) : materialQuotes.length === 0 && derivedMaterialRequirements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium mb-1">No material requirements yet</p>
            <p className="text-sm mb-4">Add scope items with material costs in Step 1 to see requirements here</p>
          </div>
        ) : materialQuotes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="font-medium mb-1">No supplier quotes added yet</p>
            <p className="text-sm mb-4">Add quotes from suppliers to finalize material costs</p>
            {canEdit && (
              <Button onClick={onAddQuote} variant="outline" data-testid="button-add-first-material-quote">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Quote
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-md">
              <span className="text-sm font-medium">Selected Material Cost:</span>
              <span className="text-lg font-bold font-mono">${totalMaterialCost.toLocaleString()}</span>
            </div>
            <div className="space-y-3">
              {materialQuotes.map((quote) => (
                <div
                  key={quote.id}
                  className={`flex flex-col sm:flex-row sm:items-start sm:justify-between p-3 sm:p-4 border rounded-md transition-colors ${
                    (quote as any).isSelected
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                      : ''
                  }`}
                  data-testid={`material-quote-${quote.id}`}
                >
                  <div className="flex gap-3 flex-1 min-w-0">
                    <div className="pt-1">
                      <Checkbox
                        checked={(quote as any).isSelected || false}
                        onCheckedChange={(checked) => {
                          onToggleSelection(quote.id, !!checked);
                        }}
                        disabled={toggleSelectionPending}
                        data-testid={`checkbox-material-quote-${quote.id}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 sm:gap-3 mb-2 flex-wrap">
                        <h4 className="font-medium text-sm sm:text-base">{quote.materialName}</h4>
                        <Badge variant="outline" className="font-mono">
                          ${Number(quote.cost).toLocaleString()}
                        </Badge>
                        {(quote as any).isSelected && (
                          <Badge variant="default" className="gap-1 bg-green-600">
                            <CheckCircle2 className="w-3 h-3" />
                            Selected
                          </Badge>
                        )}
                        {(quote as any).rfqStatus === "sent" && (
                          <Badge variant="outline" className="gap-1 text-indigo-600 border-indigo-300">
                            <Send className="w-3 h-3" />
                            RFQ Sent
                          </Badge>
                        )}
                        {(quote as any).rfqStatus === "responded" && (
                          <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            Responded
                          </Badge>
                        )}
                      </div>
                      {quote.description && (
                        <p className="text-xs sm:text-sm text-muted-foreground mb-2">{quote.description}</p>
                      )}
                      {quote.supplierName && (
                        <p className="text-xs text-muted-foreground">Supplier: {quote.supplierName}</p>
                      )}
                      {quote.leadTime && (
                        <p className="text-xs text-muted-foreground">Lead Time: {quote.leadTime}</p>
                      )}
                      {(quote as any).rfqSentAt && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                          <Clock className="w-3 h-3" />
                          RFQ sent {new Date((quote as any).rfqSentAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 mt-2 sm:mt-0 sm:ml-4 self-end sm:self-start">
                      {onSendRfq && (quote as any).supplierEmail && !(quote as any).rfqSentAt && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSendRfq(quote.id)}
                          disabled={sendRfqPending}
                          data-testid={`button-send-rfq-material-${quote.id}`}
                        >
                          <Send className="w-3 h-3 mr-1" />
                          Send RFQ
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onEditQuote(quote)}
                        data-testid={`button-edit-material-quote-${quote.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => onDeleteQuote(quote.id)}
                        data-testid={`button-delete-material-quote-${quote.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row justify-between gap-2 pt-4">
              <Button variant="outline" className="w-full sm:w-auto" onClick={onPrevStep} data-testid="button-prev-step-3">
                Back to Scope of Work
              </Button>
              <Button className="w-full sm:w-auto" onClick={onNextStep} data-testid="button-next-step-3">
                Continue to Equipment
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
