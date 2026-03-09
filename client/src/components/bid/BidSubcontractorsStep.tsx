import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Users, Plus, Edit, Trash2, FileText, CheckCircle2, ChevronRight } from "lucide-react";
import type { BidSubcontractorQuote } from "@shared/schema";

interface DerivedSubRequirement {
  id: string;
  category: string;
  description: string;
  subcontractCost: number;
  needsSubSelection: boolean;
}

interface BidSubcontractorsStepProps {
  quotes: BidSubcontractorQuote[];
  quotesLoading: boolean;
  totalSubcontractorCost: number;
  derivedSubRequirements: DerivedSubRequirement[];
  canEdit: boolean;
  toggleSelectionPending: boolean;
  onAddQuote: () => void;
  onEditQuote: (quote: BidSubcontractorQuote) => void;
  onDeleteQuote: (quoteId: string) => void;
  onToggleSelection: (quoteId: string, isSelected: boolean) => void;
  onPrevStep: () => void;
  onNextStep: () => void;
}

export default function BidSubcontractorsStep({
  quotes,
  quotesLoading,
  totalSubcontractorCost,
  derivedSubRequirements,
  canEdit,
  toggleSelectionPending,
  onAddQuote,
  onEditQuote,
  onDeleteQuote,
  onToggleSelection,
  onPrevStep,
  onNextStep,
}: BidSubcontractorsStepProps) {
  return (
    <Card data-testid="card-subcontractor-quotes">
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Step 5: Subcontractor Quotes
          </CardTitle>
          <CardDescription>Get quotes from subcontractors for specialized work</CardDescription>
        </div>
        {canEdit && (
          <Button onClick={onAddQuote} size="sm" data-testid="button-add-quote">
            <Plus className="w-4 h-4 mr-2" />
            Add Quote
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {derivedSubRequirements.length > 0 && (
          <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-3 flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Subcontractor Requirements from SOW ({derivedSubRequirements.length} items)
            </h4>
            <div className="space-y-2">
              {derivedSubRequirements.map((req) => (
                <div key={req.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{req.category}</Badge>
                    <span className="text-muted-foreground">{req.description}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono">${req.subcontractCost.toLocaleString()}</span>
                    {req.needsSubSelection ? (
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

        {quotesLoading ? (
          <div className="text-center py-8 text-muted-foreground">Loading quotes...</div>
        ) : quotes.length === 0 && derivedSubRequirements.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Users className="w-12 h-12 mx-auto mb-4 opacity-40" />
            <p className="font-medium mb-1">No subcontractor requirements yet</p>
            <p className="text-sm mb-4">Add scope items with subcontract costs in Step 1 to see requirements here</p>
          </div>
        ) : quotes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p className="font-medium mb-1">No subcontractor quotes added yet</p>
            <p className="text-sm mb-4">Add quotes from subs for specialized scope items</p>
            {canEdit && (
              <Button onClick={onAddQuote} variant="outline" data-testid="button-add-first-quote">
                <Plus className="w-4 h-4 mr-2" />
                Add Subcontractor Quote
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-muted rounded-md">
              <span className="text-sm font-medium">Selected Subcontractor Cost:</span>
              <span className="text-lg font-bold font-mono">${totalSubcontractorCost.toLocaleString()}</span>
            </div>
            <div className="space-y-3">
              {quotes.map((quote) => (
                <div
                  key={quote.id}
                  className={`flex items-start justify-between p-4 border rounded-md transition-colors ${
                    (quote as any).isSelected
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/20'
                      : ''
                  }`}
                  data-testid={`quote-${quote.id}`}
                >
                  <div className="flex gap-3 flex-1">
                    <div className="pt-1">
                      <Checkbox
                        checked={(quote as any).isSelected || false}
                        onCheckedChange={(checked) => {
                          onToggleSelection(quote.id, !!checked);
                        }}
                        disabled={toggleSelectionPending}
                        data-testid={`checkbox-quote-${quote.id}`}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h4 className="font-medium">{quote.subcontractorName}</h4>
                        <Badge variant="outline" className="font-mono">
                          ${Number(quote.quoteAmount).toLocaleString()}
                        </Badge>
                        {(quote as any).isSelected && (
                          <Badge variant="default" className="gap-1 bg-green-600">
                            <CheckCircle2 className="w-3 h-3" />
                            Selected
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mb-1">{quote.scopeOfWork}</p>
                      {quote.contactName && (
                        <p className="text-xs text-muted-foreground">Contact: {quote.contactName}</p>
                      )}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-2 ml-4">
                      <Button size="icon" variant="ghost" onClick={() => onEditQuote(quote)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => onDeleteQuote(quote.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={onPrevStep} data-testid="button-prev-step-5">
                Back to Equipment
              </Button>
              <Button onClick={onNextStep} data-testid="button-next-step-5">
                Continue to Bid Summary
                <ChevronRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
