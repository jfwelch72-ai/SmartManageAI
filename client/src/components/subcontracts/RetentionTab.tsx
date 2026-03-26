import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, Plus, CheckCircle2, XCircle, Clock, Loader2, DollarSign, TrendingDown } from "lucide-react";
import { format } from "date-fns";

interface RetentionRelease {
  id: string;
  contractId: string;
  amount: string;
  releaseType: string;
  status: string;
  reason: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface RetentionData {
  contractId: string;
  retentionPercent: string;
  totalRetentionHeld: string;
  totalReleased: string;
  balanceRemaining: string;
  releases: RetentionRelease[];
}

interface RetentionTabProps {
  contractId: string;
  canEdit: boolean;
}

export function RetentionTab({ contractId, canEdit }: RetentionTabProps) {
  const { toast } = useToast();
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [releaseForm, setReleaseForm] = useState({ amount: "", releaseType: "PARTIAL" as "PARTIAL" | "FULL", reason: "" });

  const fmt = (v: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(typeof v === "string" ? parseFloat(v) : v);

  const { data: retention, isLoading, isError, refetch } = useQuery<RetentionData>({
    queryKey: ["/api/subcontracts", contractId, "retention"],
    queryFn: async () => {
      const res = await fetch(`/api/subcontracts/${contractId}/retention`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createReleaseMutation = useMutation({
    mutationFn: (data: { amount: string; releaseType: string; reason?: string }) =>
      apiRequest("POST", `/api/subcontracts/${contractId}/retention/release`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "retention"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts/retention/summary"] });
      toast({ title: "Retention release requested" });
      setShowReleaseDialog(false);
      setReleaseForm({ amount: "", releaseType: "PARTIAL", reason: "" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const actionMutation = useMutation({
    mutationFn: ({ releaseId, action }: { releaseId: string; action: string }) =>
      apiRequest("PATCH", `/api/subcontracts/${contractId}/retention/release/${releaseId}`, { action }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts", contractId, "retention"] });
      queryClient.invalidateQueries({ queryKey: ["/api/subcontracts/retention/summary"] });
      toast({ title: "Release updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>;
  }

  if (isError) {
    return <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground"><p>Failed to load retention data.</p><Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  }

  const totalHeld = parseFloat(retention?.totalRetentionHeld || "0");
  const totalReleased = parseFloat(retention?.totalReleased || "0");
  const balance = parseFloat(retention?.balanceRemaining || "0");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2" data-testid="text-retention-title">
          <Shield className="h-5 w-5" />
          Retention Tracking
        </h3>
        {canEdit && balance > 0 && (
          <Button onClick={() => setShowReleaseDialog(true)} data-testid="button-request-release">
            <TrendingDown className="h-4 w-4 mr-2" />Request Release
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card data-testid="card-retention-rate">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Retention Rate</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{retention?.retentionPercent || "0"}%</p></CardContent>
        </Card>
        <Card data-testid="card-retention-held">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><Shield className="h-3 w-3" />Total Held</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(totalHeld)}</p></CardContent>
        </Card>
        <Card data-testid="card-retention-released">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-green-500" />Released</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-green-600">{fmt(totalReleased)}</p></CardContent>
        </Card>
        <Card data-testid="card-retention-balance">
          <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" />Balance</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-yellow-600">{fmt(balance)}</p></CardContent>
        </Card>
      </div>

      {retention?.releases && retention.releases.length > 0 ? (
        <Card>
          <CardHeader><CardTitle className="text-sm">Release History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  {canEdit && <TableHead>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {retention.releases.map(release => (
                  <TableRow key={release.id} data-testid={`row-release-${release.id}`}>
                    <TableCell>{format(new Date(release.createdAt), "MMM d, yyyy")}</TableCell>
                    <TableCell><Badge variant="outline">{release.releaseType}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{fmt(release.amount)}</TableCell>
                    <TableCell>
                      {release.status === "PENDING" && <Badge variant="outline"><Clock className="h-3 w-3 mr-1" />Pending</Badge>}
                      {release.status === "APPROVED" && <Badge className="bg-green-500"><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>}
                      {release.status === "REJECTED" && <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{release.reason || release.rejectionReason || "-"}</TableCell>
                    {canEdit && (
                      <TableCell>
                        {release.status === "PENDING" && (
                          <div className="flex gap-1">
                            <Button size="sm" onClick={() => actionMutation.mutate({ releaseId: release.id, action: "APPROVE" })} disabled={actionMutation.isPending} data-testid={`button-approve-release-${release.id}`}>
                              <CheckCircle2 className="h-3 w-3" />
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => actionMutation.mutate({ releaseId: release.id, action: "REJECT" })} disabled={actionMutation.isPending} data-testid={`button-reject-release-${release.id}`}>
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No retention releases yet.</CardContent></Card>
      )}

      <Dialog open={showReleaseDialog} onOpenChange={setShowReleaseDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request Retention Release</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Release Type</Label>
              <Select value={releaseForm.releaseType} onValueChange={(v) => setReleaseForm({ ...releaseForm, releaseType: v as "PARTIAL" | "FULL", amount: v === "FULL" ? String(balance) : releaseForm.amount })}>
                <SelectTrigger data-testid="select-release-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PARTIAL">Partial Release</SelectItem>
                  <SelectItem value="FULL">Full Release</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount ({fmt(balance)} available)</Label>
              <Input type="number" value={releaseForm.amount} onChange={e => setReleaseForm({ ...releaseForm, amount: e.target.value })} disabled={releaseForm.releaseType === "FULL"} data-testid="input-release-amount" />
            </div>
            <div>
              <Label>Reason (optional)</Label>
              <Textarea value={releaseForm.reason} onChange={e => setReleaseForm({ ...releaseForm, reason: e.target.value })} data-testid="input-release-reason" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReleaseDialog(false)}>Cancel</Button>
            <Button onClick={() => createReleaseMutation.mutate(releaseForm)} disabled={!releaseForm.amount || createReleaseMutation.isPending} data-testid="button-submit-release">
              {createReleaseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
