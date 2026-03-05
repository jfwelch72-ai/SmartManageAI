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

export function LineItemsTable({ 
  lineItems, 
  overheadPercent, 
  profitMarginPercent, 
  hasEstimateAccess, 
  onEdit, 
  onDelete, 
  isDeleting 
}: LineItemsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Estimate Line Items</CardTitle>
        <CardDescription>
          Detailed breakdown of all cost items in this estimate
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lineItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No line items yet</p>
            <p className="text-sm mt-2">Add manual line items to get started</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
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
                      <Badge variant="outline" className="text-xs">
                        {item.category}
                      </Badge>
                    </TableCell>
                    <TableCell>{item.quantity.toLocaleString()}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{item.unit}</TableCell>
                    <TableCell className="text-right">
                      ${Number(item.materialCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(item.laborCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {Number(item.laborHours || 0).toLocaleString(undefined, { minimumFractionDigits: 1 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(item.equipmentCost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${Number(item.subcontractCost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${directCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-orange-600 dark:text-orange-400">
                      ${totalOverhead.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">
                      ${totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right font-bold">
                      ${bidTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
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
        )}
      </CardContent>
    </Card>
  );
}
