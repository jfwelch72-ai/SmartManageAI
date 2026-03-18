import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { FileText } from "lucide-react";
import type { EstimateLineItem } from "@shared/schema";

interface LineItemsTableProps {
  lineItems: EstimateLineItem[];
  overheadPercent: number;
  profitMarginPercent: number;
  hasEstimateAccess: boolean;
  onEdit: (item: EstimateLineItem) => void;
  onDelete: (itemId: string) => void;
  isDeleting: boolean;
}

function fmt(val: number) {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LineItemsTable({ 
  lineItems, 
  overheadPercent, 
  profitMarginPercent, 
  hasEstimateAccess, 
  onEdit, 
  onDelete, 
  isDeleting 
}: LineItemsTableProps) {
  if (lineItems.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Estimate Line Items</CardTitle>
          <CardDescription>Detailed breakdown of all cost items in this estimate</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No line items yet</p>
            <p className="text-sm mt-2">Add manual line items to get started</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimate Line Items</CardTitle>
        <CardDescription>Detailed breakdown of all cost items in this estimate</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">

        {/* ── Mobile card layout (hidden on md+) ── */}
        <div className="md:hidden divide-y divide-border">
          {lineItems.map((item) => {
            const directCost = Number(item.materialCost) + Number(item.laborCost) + Number(item.equipmentCost) + Number(item.consumablesCost || 0) + Number(item.subcontractCost || 0);
            const totalOverhead = directCost * (overheadPercent / 100);
            const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
            const bidTotal = directCost + totalOverhead + totalProfit;

            return (
              <div key={item.id} className="px-4 py-4 space-y-3" data-testid={`row-line-item-${item.id}`}>
                {/* Header row: description + category */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-snug">{item.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {item.quantity.toLocaleString()} {item.unit}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">{item.category}</Badge>
                </div>

                {/* Cost breakdown grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Material</span>
                    <span>${fmt(Number(item.materialCost))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Labor</span>
                    <span>${fmt(Number(item.laborCost))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Equipment</span>
                    <span>${fmt(Number(item.equipmentCost))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subcontract</span>
                    <span>${fmt(Number(item.subcontractCost || 0))}</span>
                  </div>
                </div>

                {/* Totals row */}
                <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <div className="space-y-0.5">
                    <div className="flex gap-3">
                      <span className="text-muted-foreground">Direct</span>
                      <span className="font-medium">${fmt(directCost)}</span>
                    </div>
                    <div className="flex gap-3 text-xs">
                      <span className="text-orange-600 dark:text-orange-400">+OH ${fmt(totalOverhead)}</span>
                      <span className="text-green-600 dark:text-green-400">+Profit ${fmt(totalProfit)}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Bid Total</p>
                    <p className="font-bold text-base">${fmt(bidTotal)}</p>
                  </div>
                </div>

                {/* Actions */}
                {hasEstimateAccess && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs"
                      onClick={() => onEdit(item)}
                      data-testid={`button-edit-line-item-${item.id}`}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                      onClick={() => onDelete(item.id)}
                      disabled={isDeleting}
                      data-testid={`button-delete-line-item-${item.id}`}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Desktop full table (hidden below md) ── */}
        <div className="hidden md:block overflow-x-auto">
          <Table className="min-w-[1000px]">
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Description</TableHead>
                <TableHead className="whitespace-nowrap">Category</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Material</TableHead>
                <TableHead className="text-right">Labor</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Equipment</TableHead>
                <TableHead className="text-right">Subcontract</TableHead>
                <TableHead className="text-right">Direct Cost</TableHead>
                <TableHead className="text-right text-orange-600 dark:text-orange-400">Overhead ({overheadPercent}%)</TableHead>
                <TableHead className="text-right text-green-600 dark:text-green-400">Profit ({profitMarginPercent}%)</TableHead>
                <TableHead className="text-right">Bid Total</TableHead>
                {hasEstimateAccess && <TableHead></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((item) => {
                const directCost = Number(item.materialCost) + Number(item.laborCost) + Number(item.equipmentCost) + Number(item.consumablesCost || 0) + Number(item.subcontractCost || 0);
                const totalOverhead = directCost * (overheadPercent / 100);
                const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
                const bidTotal = directCost + totalOverhead + totalProfit;

                return (
                  <TableRow key={item.id} data-testid={`row-line-item-${item.id}`}>
                    <TableCell className="font-medium">{item.description}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{item.category}</Badge>
                    </TableCell>
                    <TableCell>{item.quantity.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{item.unit}</TableCell>
                    <TableCell className="text-right">${fmt(Number(item.materialCost))}</TableCell>
                    <TableCell className="text-right">${fmt(Number(item.laborCost))}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {Number(item.laborHours || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="text-right">${fmt(Number(item.equipmentCost))}</TableCell>
                    <TableCell className="text-right">${fmt(Number(item.subcontractCost || 0))}</TableCell>
                    <TableCell className="text-right font-medium">${fmt(directCost)}</TableCell>
                    <TableCell className="text-right text-orange-600 dark:text-orange-400">${fmt(totalOverhead)}</TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">${fmt(totalProfit)}</TableCell>
                    <TableCell className="text-right font-bold">${fmt(bidTotal)}</TableCell>
                    {hasEstimateAccess && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onEdit(item)}
                            data-testid={`button-edit-line-item-${item.id}`}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => onDelete(item.id)}
                            disabled={isDeleting}
                            data-testid={`button-delete-line-item-${item.id}`}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

      </CardContent>
    </Card>
  );
}
