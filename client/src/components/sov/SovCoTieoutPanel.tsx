import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  GitCompare,
} from "lucide-react";

export function SovCoTieoutPanel({ projectId }: { projectId?: string } = {}) {
  const { data: allReconciliation = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sov/co-tieout"],
  });

  const reconciliation = projectId
    ? allReconciliation.filter((r: any) => r.projectId === projectId)
    : allReconciliation;

  const [expandedProject, setExpandedProject] = useState<string | null>(null);

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>;
  }

  if (reconciliation.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No change orders or SOVs to reconcile for this project
        </CardContent>
      </Card>
    );
  }

  const reconciledCount = reconciliation.filter((r: any) => r.isReconciled).length;
  const discrepancyCount = reconciliation.filter((r: any) => !r.isReconciled).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <GitCompare className="h-5 w-5" /> Change Order SOV Tie-Out
        </h2>
        <div className="flex items-center gap-2 sm:gap-3">
          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" /> {reconciledCount} Reconciled
          </Badge>
          {discrepancyCount > 0 && (
            <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
              <AlertTriangle className="h-3 w-3 mr-1" /> {discrepancyCount} Discrepancies
            </Badge>
          )}
        </div>
      </div>

      <div className="hidden md:block">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Contract Value</TableHead>
                  <TableHead className="text-right">Approved COs</TableHead>
                  <TableHead className="text-right">Expected SOV Total</TableHead>
                  <TableHead className="text-right">Actual SOV Total</TableHead>
                  <TableHead className="text-right">Variance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reconciliation.map((r: any) => (
                  <Fragment key={r.projectId}>
                    <TableRow
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedProject(expandedProject === r.projectId ? null : r.projectId)}
                      data-testid={`row-tieout-${r.projectId}`}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {expandedProject === r.projectId ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          <span className="font-medium">{r.projectName}</span>
                          {r.projectCode && <span className="text-xs text-muted-foreground">({r.projectCode})</span>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">${r.contractValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">
                        ${r.approvedCOTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        <span className="text-xs text-muted-foreground ml-1">({r.changeOrderCount} COs)</span>
                      </TableCell>
                      <TableCell className="text-right">${r.expectedSovTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">${r.actualSovTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">
                        <span className={Math.abs(r.variance) < 0.01 ? "text-muted-foreground" : r.variance > 0 ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                          {r.variance >= 0 ? "+" : ""}${r.variance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </TableCell>
                      <TableCell>
                        {r.isReconciled ? (
                          <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Reconciled
                          </Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                            <AlertTriangle className="h-3 w-3 mr-1" /> Discrepancy
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                    {expandedProject === r.projectId && (
                      <TableRow key={`${r.projectId}-detail`}>
                        <TableCell colSpan={7} className="bg-muted/20 p-4">
                          <div className="grid grid-cols-2 gap-6">
                            <div>
                              <h4 className="text-sm font-semibold mb-2">Approved Change Orders ({r.changeOrderCount})</h4>
                              {r.changeOrders.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No approved COs</p>
                              ) : (
                                <div className="space-y-1">
                                  {r.changeOrders.map((co: any) => (
                                    <div key={co.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                                      <span>{co.changeOrderNumber}: {co.description}</span>
                                      <span className="font-medium">${parseFloat(co.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold mb-2">SOV Records ({r.sovCount})</h4>
                              {r.sovs.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No SOVs found</p>
                              ) : (
                                <div className="space-y-1">
                                  {r.sovs.map((sov: any) => (
                                    <div key={sov.id} className="flex justify-between text-sm py-1 border-b last:border-0">
                                      <span>{sov.sovNumber}: {sov.title}</span>
                                      <span className="font-medium">${parseFloat(sov.totalScheduledValue || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="md:hidden space-y-3">
        {reconciliation.map((r: any) => (
          <div
            key={r.projectId}
            className="border rounded-lg overflow-hidden"
            data-testid={`card-tieout-${r.projectId}`}
          >
            <div
              className="p-3 cursor-pointer"
              onClick={() => setExpandedProject(expandedProject === r.projectId ? null : r.projectId)}
            >
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {expandedProject === r.projectId ? <ChevronDown className="h-4 w-4 flex-shrink-0" /> : <ChevronRight className="h-4 w-4 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{r.projectName}</p>
                    {r.projectCode && <p className="text-xs text-muted-foreground">({r.projectCode})</p>}
                  </div>
                </div>
                {r.isReconciled ? (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 text-xs flex-shrink-0">
                    <CheckCircle2 className="h-3 w-3 mr-1" /> OK
                  </Badge>
                ) : (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs flex-shrink-0">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Discrepancy
                  </Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pl-6">
                <div>
                  <span className="text-muted-foreground">Contract</span>
                  <p className="font-mono font-medium">${r.contractValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">COs ({r.changeOrderCount})</span>
                  <p className="font-mono font-medium">${r.approvedCOTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Actual SOV</span>
                  <p className="font-mono font-medium">${r.actualSovTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Variance</span>
                  <p className={`font-mono font-medium ${Math.abs(r.variance) < 0.01 ? "text-muted-foreground" : r.variance > 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {r.variance >= 0 ? "+" : ""}${r.variance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>
            </div>
            {expandedProject === r.projectId && (
              <div className="border-t bg-muted/20 p-3 space-y-3">
                <div>
                  <h4 className="text-xs font-semibold mb-1.5">Approved Change Orders ({r.changeOrderCount})</h4>
                  {r.changeOrders.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No approved COs</p>
                  ) : (
                    <div className="space-y-1">
                      {r.changeOrders.map((co: any) => (
                        <div key={co.id} className="flex justify-between text-xs py-1 border-b last:border-0">
                          <span className="truncate mr-2">{co.changeOrderNumber}: {co.description}</span>
                          <span className="font-mono font-medium flex-shrink-0">${parseFloat(co.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h4 className="text-xs font-semibold mb-1.5">SOV Records ({r.sovCount})</h4>
                  {r.sovs.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No SOVs found</p>
                  ) : (
                    <div className="space-y-1">
                      {r.sovs.map((sov: any) => (
                        <div key={sov.id} className="flex justify-between text-xs py-1 border-b last:border-0">
                          <span className="truncate mr-2">{sov.sovNumber}: {sov.title}</span>
                          <span className="font-mono font-medium flex-shrink-0">${parseFloat(sov.totalScheduledValue || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
