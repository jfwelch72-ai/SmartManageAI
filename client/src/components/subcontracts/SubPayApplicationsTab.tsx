import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, FileText, CheckCircle2, Clock, XCircle, Send, Eye, Loader2, DollarSign, Download } from "lucide-react";
import { format } from "date-fns";

interface SubPayApp {
  id: string;
  contractId: string;
  applicationNumber: number;
  periodTo: string | null;
  status: string;
  totalScheduledValue: string | null;
  totalCompletedThisPeriod: string | null;
  totalCompletedToDate: string | null;
  totalRetentionHeld: string | null;
  netAmountDue: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface SubPayAppDetail extends SubPayApp {
  lineItems: Array<{
    id: string;
    sovLineItemId: string;
    previouslyCompleted: string;
    completedThisPeriod: string;
    materialsStored: string;
    totalCompleted: string;
    percentComplete: string;
    retentionHeld: string;
    sovItem: {
      id: string;
      itemNumber: number;
      description: string;
      scheduledValue: string;
    };
  }>;
}

interface SubPayApplicationsTabProps {
  contractId: string;
  canEdit: boolean;
}

export function SubPayApplicationsTab({ contractId, canEdit }: SubPayApplicationsTabProps) {
  const { toast } = useToast();
  const [selectedPayApp, setSelectedPayApp] = useState<string | null>(null);
  const [lineItemEdits, setLineItemEdits] = useState<Record<string, { completedThisPeriod: string; materialsStored: string }>>({});

  const fmt = (v: string | number | null) => {
    if (v === null || v === undefined) return "$0.00";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(typeof v === "string" ? parseFloat(v) : v);
  };

  const { data: payApps = [], isLoading, isError, refetch } = useQuery<SubPayApp[]>({
    queryKey: ["/api/subcontracts", contractId, "pay-applications"],
    queryFn: async () => {
      const res = await fetch(`/api/subcontracts/${contractId}/pay-applications`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const { data: payAppDetail, isLoading: detailLoading } = useQuery<SubPayAppDetail>({
    queryKey: ["/api/subcontracts", contractId, "pay-applications", selectedPayApp],
    queryFn: async () => {
      const res = await fetch(`/api/subcontracts/${contractId}/pay-applications/${selectedPayApp}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!selectedPayApp,
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/subcontracts/${contractId}/pay-applications`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "pay-applications"] });
      toast({ title: "Pay application created" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const updateLineItemsMutation = useMutation({
    mutationFn: (lineItems: Array<{ id: string; completedThisPeriod: string; materialsStored: string }>) =>
      apiRequest("PATCH", `/api/subcontracts/${contractId}/pay-applications/${selectedPayApp}/line-items`, { lineItems }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "pay-applications", selectedPayApp] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "pay-applications"] });
      toast({ title: "Progress updated" });
      setLineItemEdits({});
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ payAppId, status }: { payAppId: string; status: string }) =>
      apiRequest("PATCH", `/api/subcontracts/${contractId}/pay-applications/${payAppId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "pay-applications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "pay-applications", selectedPayApp] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "DRAFT": return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
      case "SUBMITTED": return <Badge className="bg-blue-500"><Send className="h-3 w-3 mr-1" />Submitted</Badge>;
      case "UNDER_REVIEW": return <Badge className="bg-yellow-500"><Eye className="h-3 w-3 mr-1" />Under Review</Badge>;
      case "APPROVED": return <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
      case "REJECTED": return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case "PAID": return <Badge className="bg-emerald-600"><DollarSign className="h-3 w-3 mr-1" />Paid</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleSaveProgress = () => {
    const items = Object.entries(lineItemEdits).map(([id, data]) => ({ id, ...data }));
    if (items.length > 0) updateLineItemsMutation.mutate(items);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>;
  }

  if (isError) {
    return <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground"><p>Failed to load pay applications.</p><Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-pay-apps-title">
            <FileText className="h-5 w-5" />
            Pay Applications
          </h3>
          <p className="text-sm text-muted-foreground">{payApps.length} application{payApps.length !== 1 ? "s" : ""}</p>
        </div>
        {canEdit && (
          <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} data-testid="button-create-pay-app">
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            New Pay Application
          </Button>
        )}
      </div>

      {payApps.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No pay applications yet. Create one to start tracking subcontractor billing.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App #</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">This Period</TableHead>
                  <TableHead className="text-right">Total Completed</TableHead>
                  <TableHead className="text-right">Retention</TableHead>
                  <TableHead className="text-right">Net Due</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payApps.map(app => (
                  <TableRow key={app.id} data-testid={`row-pay-app-${app.id}`}>
                    <TableCell className="font-mono font-semibold">#{app.applicationNumber}</TableCell>
                    <TableCell>{app.periodTo || "-"}</TableCell>
                    <TableCell>{getStatusBadge(app.status)}</TableCell>
                    <TableCell className="text-right">{fmt(app.totalCompletedThisPeriod)}</TableCell>
                    <TableCell className="text-right">{fmt(app.totalCompletedToDate)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(app.totalRetentionHeld)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(app.netAmountDue)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedPayApp(app.id)} data-testid={`button-view-pay-app-${app.id}`}>
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedPayApp} onOpenChange={(open) => { if (!open) { setSelectedPayApp(null); setLineItemEdits({}); } }}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Pay Application #{payAppDetail?.applicationNumber}
              {payAppDetail && getStatusBadge(payAppDetail.status)}
            </DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : payAppDetail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Scheduled Value</CardTitle></CardHeader><CardContent><p className="text-lg font-bold">{fmt(payAppDetail.totalScheduledValue)}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Completed To Date</CardTitle></CardHeader><CardContent><p className="text-lg font-bold">{fmt(payAppDetail.totalCompletedToDate)}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Retention Held</CardTitle></CardHeader><CardContent><p className="text-lg font-bold text-muted-foreground">{fmt(payAppDetail.totalRetentionHeld)}</p></CardContent></Card>
                <Card><CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Net Amount Due</CardTitle></CardHeader><CardContent><p className="text-lg font-bold text-green-600">{fmt(payAppDetail.netAmountDue)}</p></CardContent></Card>
              </div>

              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">#</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="text-right">Scheduled Value</TableHead>
                          <TableHead className="text-right">Previously Completed</TableHead>
                          <TableHead className="text-right w-32">This Period</TableHead>
                          <TableHead className="text-right w-32">Materials Stored</TableHead>
                          <TableHead className="text-right">Total Completed</TableHead>
                          <TableHead className="text-right">% Complete</TableHead>
                          <TableHead className="text-right">Balance to Finish</TableHead>
                          <TableHead className="text-right">Retention</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payAppDetail.lineItems.map(li => {
                          const edit = lineItemEdits[li.id];
                          return (
                            <TableRow key={li.id} data-testid={`row-pay-app-line-${li.id}`}>
                              <TableCell className="font-mono">{li.sovItem.itemNumber}</TableCell>
                              <TableCell className="max-w-xs truncate">{li.sovItem.description}</TableCell>
                              <TableCell className="text-right">{fmt(li.sovItem.scheduledValue)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{fmt(li.previouslyCompleted)}</TableCell>
                              <TableCell className="text-right">
                                {payAppDetail.status === "DRAFT" && canEdit ? (
                                  <Input type="number" className="w-28 text-right" value={edit?.completedThisPeriod ?? li.completedThisPeriod} onChange={e => setLineItemEdits({ ...lineItemEdits, [li.id]: { completedThisPeriod: e.target.value, materialsStored: edit?.materialsStored ?? li.materialsStored } })} data-testid={`input-this-period-${li.id}`} />
                                ) : fmt(li.completedThisPeriod)}
                              </TableCell>
                              <TableCell className="text-right">
                                {payAppDetail.status === "DRAFT" && canEdit ? (
                                  <Input type="number" className="w-28 text-right" value={edit?.materialsStored ?? li.materialsStored} onChange={e => setLineItemEdits({ ...lineItemEdits, [li.id]: { materialsStored: e.target.value, completedThisPeriod: edit?.completedThisPeriod ?? li.completedThisPeriod } })} data-testid={`input-materials-${li.id}`} />
                                ) : fmt(li.materialsStored)}
                              </TableCell>
                              <TableCell className="text-right font-semibold">{fmt(li.totalCompleted)}</TableCell>
                              <TableCell className="text-right">{parseFloat(li.percentComplete || "0").toFixed(1)}%</TableCell>
                              <TableCell className="text-right">{fmt(parseFloat(li.sovItem.scheduledValue || "0") - parseFloat(li.totalCompleted || "0"))}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{fmt(li.retentionHeld)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <div className="flex items-center justify-between pt-4 border-t">
                <div className="flex gap-2">
                  {payAppDetail.status === "DRAFT" && canEdit && Object.keys(lineItemEdits).length > 0 && (
                    <Button onClick={handleSaveProgress} disabled={updateLineItemsMutation.isPending} data-testid="button-save-progress">
                      {updateLineItemsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save Progress
                    </Button>
                  )}
                  {payAppDetail.status === "DRAFT" && canEdit && (
                    <Button variant="outline" onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "SUBMITTED" })} disabled={statusMutation.isPending} data-testid="button-submit-pay-app">
                      <Send className="h-4 w-4 mr-2" />Submit
                    </Button>
                  )}
                  {payAppDetail.status === "SUBMITTED" && canEdit && (
                    <>
                      <Button variant="outline" onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "UNDER_REVIEW" })} disabled={statusMutation.isPending} data-testid="button-review-pay-app">
                        <Eye className="h-4 w-4 mr-2" />Begin Review
                      </Button>
                      <Button onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "APPROVED" })} disabled={statusMutation.isPending} data-testid="button-approve-pay-app">
                        <CheckCircle2 className="h-4 w-4 mr-2" />Approve
                      </Button>
                      <Button variant="destructive" onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "REJECTED" })} disabled={statusMutation.isPending} data-testid="button-reject-pay-app">
                        <XCircle className="h-4 w-4 mr-2" />Reject
                      </Button>
                    </>
                  )}
                  {payAppDetail.status === "UNDER_REVIEW" && canEdit && (
                    <>
                      <Button onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "APPROVED" })} disabled={statusMutation.isPending} data-testid="button-approve-reviewed-pay-app">
                        <CheckCircle2 className="h-4 w-4 mr-2" />Approve
                      </Button>
                      <Button variant="destructive" onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "REJECTED" })} disabled={statusMutation.isPending} data-testid="button-reject-reviewed-pay-app">
                        <XCircle className="h-4 w-4 mr-2" />Reject
                      </Button>
                    </>
                  )}
                  {payAppDetail.status === "APPROVED" && canEdit && (
                    <Button onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "PAID" })} disabled={statusMutation.isPending} data-testid="button-mark-paid-pay-app">
                      <DollarSign className="h-4 w-4 mr-2" />Mark Paid
                    </Button>
                  )}
                  {payAppDetail.status === "REJECTED" && canEdit && (
                    <Button variant="outline" onClick={() => statusMutation.mutate({ payAppId: payAppDetail.id, status: "DRAFT" })} disabled={statusMutation.isPending} data-testid="button-revert-draft-pay-app">
                      Revert to Draft
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => window.open(`/api/subcontracts/${contractId}/pay-applications/${selectedPayApp}/pdf`, "_blank")} data-testid="button-export-pay-app-pdf">
                    <Download className="h-4 w-4 mr-2" />Export PDF
                  </Button>
                  <Button variant="outline" onClick={() => { setSelectedPayApp(null); setLineItemEdits({}); }}>Close</Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
