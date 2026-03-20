import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Plus, CreditCard, Loader2 } from "lucide-react";
import { format } from "date-fns";
import type { SOV } from "./types";

export function SovPaymentsPanel({ sovs }: { sovs: SOV[] }) {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    sovId: "",
    amount: "",
    paymentDate: "",
    paymentMethod: "CHECK" as string,
    referenceNumber: "",
    notes: "",
  });

  const { data: allPayments = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/sov/payments"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const res = await apiRequest("POST", "/api/sov/payments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sov/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sov"] });
      toast({ title: "Payment recorded" });
      setShowCreate(false);
      setForm({ sovId: "", amount: "", paymentDate: "", paymentMethod: "CHECK", referenceNumber: "", notes: "" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const projectSovIds = new Set(sovs.map(s => s.id));
  const payments = sovs.length > 0
    ? allPayments.filter((p: any) => projectSovIds.has(p.sovId))
    : allPayments;

  const paymentsBySOV: Record<string, any[]> = {};
  payments.forEach((p: any) => {
    if (!paymentsBySOV[p.sovId]) paymentsBySOV[p.sovId] = [];
    paymentsBySOV[p.sovId].push(p);
  });

  const getSOVBalance = (sovId: string, earnedLessRetainage: string) => {
    const total = parseFloat(earnedLessRetainage || "0");
    const paid = (paymentsBySOV[sovId] || []).reduce((sum: number, p: any) => sum + parseFloat(p.amount || "0"), 0);
    return { total, paid, remaining: total - paid };
  };

  const methodLabel = (m: string) => {
    const map: Record<string, string> = { CHECK: "Check", ACH: "ACH", WIRE: "Wire", CREDIT_CARD: "Credit Card", OTHER: "Other" };
    return map[m] || m;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <CreditCard className="h-5 w-5" /> Partial Payments
        </h2>
        <Button onClick={() => setShowCreate(true)} data-testid="button-record-payment" className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" /> Record Payment
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : payments.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No payments recorded yet</CardContent></Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SOV / Project</TableHead>
                      <TableHead className="text-center">Payment #</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p: any) => {
                      const bal = getSOVBalance(p.sovId, p.totalEarnedLessRetainage);
                      return (
                        <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                          <TableCell>
                            <span className="font-medium">{p.sovNumber}</span>
                            <span className="text-xs text-muted-foreground block">{p.projectName}</span>
                          </TableCell>
                          <TableCell className="text-center">#{p.paymentNumber}</TableCell>
                          <TableCell className="text-right font-medium text-emerald-600">${parseFloat(p.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                          <TableCell>{p.paymentDate ? format(new Date(p.paymentDate), "MMM d, yyyy") : "—"}</TableCell>
                          <TableCell><Badge variant="outline">{methodLabel(p.paymentMethod)}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{p.referenceNumber || "—"}</TableCell>
                          <TableCell className="text-right">
                            <span className={bal.remaining > 0.01 ? "text-amber-600 font-medium" : "text-emerald-600 font-medium"}>
                              ${bal.remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
          <div className="md:hidden space-y-3">
            {payments.map((p: any) => {
              const bal = getSOVBalance(p.sovId, p.totalEarnedLessRetainage);
              return (
                <div key={p.id} className="border rounded-lg p-3 space-y-2" data-testid={`card-payment-${p.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{p.sovNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">{p.projectName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="outline" className="text-xs">#{p.paymentNumber}</Badge>
                      <Badge variant="outline" className="text-xs">{methodLabel(p.paymentMethod)}</Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Amount</span>
                      <p className="font-mono font-semibold text-emerald-600">${parseFloat(p.amount || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Date</span>
                      <p className="font-medium">{p.paymentDate ? format(new Date(p.paymentDate), "MMM d, yy") : "—"}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Balance</span>
                      <p className={`font-mono font-semibold ${bal.remaining > 0.01 ? "text-amber-600" : "text-emerald-600"}`}>
                        ${bal.remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  {p.referenceNumber && <p className="text-xs text-muted-foreground">Ref: {p.referenceNumber}</p>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Record a full or partial payment against an SOV pay app</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>SOV Pay App</Label>
              <Select value={form.sovId} onValueChange={(v) => setForm(f => ({ ...f, sovId: v }))}>
                <SelectTrigger data-testid="select-payment-sov"><SelectValue placeholder="Select SOV..." /></SelectTrigger>
                <SelectContent>
                  {sovs.map(s => <SelectItem key={s.id} value={s.id}>{s.sovNumber} - {s.title} ({s.projectName})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} data-testid="input-payment-amount" />
              </div>
              <div className="space-y-2">
                <Label>Payment Date</Label>
                <Input type="date" value={form.paymentDate} onChange={(e) => setForm(f => ({ ...f, paymentDate: e.target.value }))} data-testid="input-payment-date" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Method</Label>
                <Select value={form.paymentMethod} onValueChange={(v) => setForm(f => ({ ...f, paymentMethod: v }))}>
                  <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECK">Check</SelectItem>
                    <SelectItem value="ACH">ACH</SelectItem>
                    <SelectItem value="WIRE">Wire</SelectItem>
                    <SelectItem value="CREDIT_CARD">Credit Card</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reference # (optional)</Label>
                <Input value={form.referenceNumber} onChange={(e) => setForm(f => ({ ...f, referenceNumber: e.target.value }))} data-testid="input-payment-reference" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} data-testid="input-payment-notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)} data-testid="button-cancel-payment">Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(form)}
              disabled={!form.sovId || !form.amount || !form.paymentDate || createMutation.isPending}
              data-testid="button-submit-payment"
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
