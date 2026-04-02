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
import { FileText, Pencil, Trash2, Layers, Ruler, Wrench } from "lucide-react";
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

function SourceBadge({ source }: { source: string }) {
  if (source === "ASSEMBLY") {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" data-testid="badge-source-assembly">
        <Layers className="h-2.5 w-2.5" />Assembly
      </Badge>
    );
  }
  if (source === "TAKEOFF") {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" data-testid="badge-source-takeoff">
        <Ruler className="h-2.5 w-2.5" />Takeoff
      </Badge>
    );
  }
  if (source === "GENERATED") {
    return (
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5" data-testid="badge-source-generated">
        <Wrench className="h-2.5 w-2.5" />Generated
      </Badge>
    );
  }
  return null;
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
        <CardTitle className="text-lg sm:text-xl">Estimate Line Items</CardTitle>
        <CardDescription>Detailed breakdown of all cost items in this estimate</CardDescription>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">

        {/* ── Mobile card layout (hidden on lg+) ── */}
        <div className="lg:hidden divide-y divide-border">
          {lineItems.map((item) => {
            const directCost = Number(item.materialCost) + Number(item.laborCost) + Number(item.equipmentCost) + Number(item.consumablesCost || 0) + Number(item.subcontractCost || 0);
            const totalOverhead = directCost * (overheadPercent / 100);
            const totalProfit = (directCost + totalOverhead) * (profitMarginPercent / 100);
            const bidTotal = directCost + totalOverhead + totalProfit;

            return (
              <div key={item.id} className="px-4 py-4 space-y-3" data-testid={`row-line-item-${item.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-snug">{item.description}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-xs text-muted-foreground">
                        {item.quantity.toLocaleString()} {item.unit}
                      </p>
                      <SourceBadge source={item.source} />
                    </div>
                  </div>
                  <Badge variant="outline" className="text-xs shrink-0">{item.category}</Badge>
                </div>

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
                  {Number(item.laborHours || 0) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hours</span>
                      <span>{Number(item.laborHours || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
                    </div>
                  )}
                </div>

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

                {hasEstimateAccess && (
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 h-8 text-xs"
                      onClick={() => onEdit(item)}
                      data-testid={`button-edit-line-item-${item.id}`}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
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
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Desktop full table (hidden below lg) ── */}
        <div className="hidden lg:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Description</TableHead>
                <TableHead className="whitespace-nowrap">Source</TableHead>
                <TableHead className="whitespace-nowrap">Category</TableHead>
                <TableHead className="text-right whitespace-nowrap">Qty</TableHead>
                <TableHead className="whitespace-nowrap">Unit</TableHead>
                <TableHead className="text-right whitespace-nowrap">Material</TableHead>
                <TableHead className="text-right whitespace-nowrap">Labor</TableHead>
                <TableHead className="text-right whitespace-nowrap">Hours</TableHead>
                <TableHead className="text-right whitespace-nowrap">Equipment</TableHead>
                <TableHead className="text-right whitespace-nowrap">Subcontract</TableHead>
                <TableHead className="text-right whitespace-nowrap">Direct Cost</TableHead>
                <TableHead className="text-right text-orange-600 dark:text-orange-400 whitespace-nowrap">OH ({overheadPercent}%)</TableHead>
                <TableHead className="text-right text-green-600 dark:text-green-400 whitespace-nowrap">Profit ({profitMarginPercent}%)</TableHead>
                <TableHead className="text-right whitespace-nowrap">Bid Total</TableHead>
                {hasEstimateAccess && <TableHead className="w-[80px]"></TableHead>}
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
                    <TableCell className="font-medium max-w-[250px]">
                      <span className="line-clamp-3">{item.description}</span>
                    </TableCell>
                    <TableCell>
                      <SourceBadge source={item.source} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs whitespace-nowrap">{item.category}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{item.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">${fmt(Number(item.materialCost))}</TableCell>
                    <TableCell className="text-right tabular-nums">${fmt(Number(item.laborCost))}</TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {Number(item.laborHours || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">${fmt(Number(item.equipmentCost))}</TableCell>
                    <TableCell className="text-right tabular-nums">${fmt(Number(item.subcontractCost || 0))}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">${fmt(directCost)}</TableCell>
                    <TableCell className="text-right text-orange-600 dark:text-orange-400 tabular-nums">${fmt(totalOverhead)}</TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400 tabular-nums">${fmt(totalProfit)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">${fmt(bidTotal)}</TableCell>
                    {hasEstimateAccess && (
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => onEdit(item)}
                            data-testid={`button-edit-line-item-${item.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => onDelete(item.id)}
                            disabled={isDeleting}
                            data-testid={`button-delete-line-item-${item.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
