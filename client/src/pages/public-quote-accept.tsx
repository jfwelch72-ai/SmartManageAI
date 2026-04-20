import { useState } from "react";
import { useRoute } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, FileSignature, Clock } from "lucide-react";
import { format } from "date-fns";

interface QuoteData {
  status: string;
  expiresAt: string;
  organization: { name: string };
  quote: { id: string; quoteNumber: string; title: string; status: string; validUntil: string | null;
    subtotal: string; taxRate: string; taxAmount: string; discountAmount: string; totalAmount: string;
    notes: string | null; terms: string | null };
  lineItems: { id: string; description: string; quantity: string; unit: string | null; unitPrice: string; lineTotal: string }[];
  decision: { signedName: string | null; signedEmail: string | null; decidedAt: string | null; declineReason: string | null };
}

const fmt = (n: string | number) => "$" + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function PublicQuoteAccept() {
  const [, params] = useRoute("/quotes/accept/:token");
  const token = params?.token ?? "";
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false);
  const [mode, setMode] = useState<"VIEW" | "ACCEPT" | "DECLINE">("VIEW");

  const { data, isLoading, error } = useQuery<QuoteData>({
    queryKey: ["/api/public/quotes/accept", token],
    queryFn: async () => {
      const res = await fetch(`/api/public/quotes/accept/${token}`, { credentials: "omit" });
      if (!res.ok) throw new Error((await res.json()).error || "Could not load quote");
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: async (decision: "ACCEPT" | "DECLINE") => {
      const res = await fetch(`/api/public/quotes/accept/${token}`, {
        method: "POST", credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, signedName: name, signedEmail: email || null, declineReason: reason || null, consent: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Submission failed");
      return json;
    },
    onSuccess: (_, decision) => {
      toast({ title: decision === "ACCEPT" ? "Quote accepted" : "Quote declined", description: "Thank you for your response." });
      queryClient.invalidateQueries({ queryKey: ["/api/public/quotes/accept", token] });
      setMode("VIEW");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="max-w-3xl mx-auto p-6"><Skeleton className="h-96" /></div>;
  if (error) return (
    <div className="max-w-2xl mx-auto p-6">
      <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>
    </div>
  );
  if (!data) return null;

  const finalized = data.status === "ACCEPTED" || data.status === "DECLINED";
  const expired = data.status === "EXPIRED";

  return (
    <div className="min-h-screen bg-muted/30 py-8 px-4" data-testid="page-quote-accept">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{data.organization.name}</h1>
          <p className="text-muted-foreground">Quote {data.quote.quoteNumber}</p>
        </div>

        {data.status === "ACCEPTED" && (
          <Alert className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950">
            <CheckCircle className="h-4 w-4 text-emerald-600" />
            <AlertDescription>
              Accepted by <strong>{data.decision.signedName}</strong> on {data.decision.decidedAt ? format(new Date(data.decision.decidedAt), "PPP") : ""}
            </AlertDescription>
          </Alert>
        )}
        {data.status === "DECLINED" && (
          <Alert variant="destructive">
            <XCircle className="h-4 w-4" />
            <AlertDescription>
              Declined by <strong>{data.decision.signedName}</strong>
              {data.decision.declineReason && <div className="mt-1">Reason: {data.decision.declineReason}</div>}
            </AlertDescription>
          </Alert>
        )}
        {expired && (
          <Alert variant="destructive"><Clock className="h-4 w-4" /><AlertDescription>This quote link has expired.</AlertDescription></Alert>
        )}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{data.quote.title}</CardTitle>
              <Badge variant="outline">{data.quote.status}</Badge>
            </div>
            {data.quote.validUntil && <CardDescription>Valid until {format(new Date(data.quote.validUntil), "PPP")}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Description</th><th className="py-2 text-right">Qty</th>
                  <th className="py-2">Unit</th><th className="py-2 text-right">Unit Price</th><th className="py-2 text-right">Total</th>
                </tr></thead>
                <tbody>
                  {data.lineItems.map(li => (
                    <tr key={li.id} className="border-b">
                      <td className="py-2">{li.description}</td>
                      <td className="py-2 text-right">{Number(li.quantity).toLocaleString()}</td>
                      <td className="py-2">{li.unit ?? ""}</td>
                      <td className="py-2 text-right">{fmt(li.unitPrice)}</td>
                      <td className="py-2 text-right font-medium">{fmt(li.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-sm border-t pt-3 ml-auto max-w-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{fmt(data.quote.subtotal)}</span></div>
              {Number(data.quote.discountAmount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span>-{fmt(data.quote.discountAmount)}</span></div>}
              {Number(data.quote.taxAmount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Tax ({Number(data.quote.taxRate)}%)</span><span>{fmt(data.quote.taxAmount)}</span></div>}
              <div className="flex justify-between font-bold text-base border-t pt-2"><span>Total</span><span>{fmt(data.quote.totalAmount)}</span></div>
            </div>
            {data.quote.notes && <div><Label className="text-xs uppercase text-muted-foreground">Notes</Label><p className="text-sm whitespace-pre-wrap mt-1">{data.quote.notes}</p></div>}
            {data.quote.terms && <div><Label className="text-xs uppercase text-muted-foreground">Terms</Label><p className="text-sm whitespace-pre-wrap mt-1">{data.quote.terms}</p></div>}
          </CardContent>
        </Card>

        {!finalized && !expired && mode === "VIEW" && (
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => setMode("DECLINE")} data-testid="button-decline">Decline</Button>
            <Button onClick={() => setMode("ACCEPT")} data-testid="button-accept"><FileSignature className="h-4 w-4 mr-2" />Accept Quote</Button>
          </div>
        )}

        {!finalized && !expired && mode !== "VIEW" && (
          <Card>
            <CardHeader><CardTitle>{mode === "ACCEPT" ? "Accept this quote" : "Decline this quote"}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div><Label htmlFor="signed-name">Your full name *</Label>
                <Input id="signed-name" value={name} onChange={e => setName(e.target.value)} data-testid="input-signed-name" /></div>
              <div><Label htmlFor="signed-email">Email (optional)</Label>
                <Input id="signed-email" type="email" value={email} onChange={e => setEmail(e.target.value)} data-testid="input-signed-email" /></div>
              {mode === "DECLINE" && (
                <div><Label htmlFor="decline-reason">Reason (optional)</Label>
                  <Textarea id="decline-reason" value={reason} onChange={e => setReason(e.target.value)} rows={3} data-testid="input-decline-reason" /></div>
              )}
              <div className="flex items-center gap-2">
                <Checkbox id="consent" checked={consent} onCheckedChange={v => setConsent(!!v)} data-testid="checkbox-consent" />
                <Label htmlFor="consent" className="text-sm font-normal">By {mode === "ACCEPT" ? "accepting" : "declining"} this quote, I confirm my electronic signature has the same legal effect as a handwritten signature.</Label>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setMode("VIEW")}>Cancel</Button>
                <Button disabled={!name.trim() || !consent || decide.isPending}
                  onClick={() => decide.mutate(mode === "ACCEPT" ? "ACCEPT" : "DECLINE")}
                  variant={mode === "ACCEPT" ? "default" : "destructive"}
                  data-testid={`button-confirm-${mode.toLowerCase()}`}>
                  {decide.isPending ? "Submitting…" : mode === "ACCEPT" ? "Accept" : "Decline"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
