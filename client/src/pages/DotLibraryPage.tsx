import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PayItemPicker, type DotAgency, type DotSpecBook, type DotPayItem } from "@/components/dot/PayItemPicker";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, BookOpen, Hash, Search, Wand2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BidTabItem {
  itemNumber: string;
  description: string;
  unit: string;
  quantity: number;
  specSection?: string | null;
}
interface BidTabResponse {
  fallback?: boolean;
  message?: string;
  items?: BidTabItem[];
  confidence?: number;
  notes?: string;
}

export default function DotLibraryPage() {
  const canManageLib = useFeaturePermission("canManageDotLibrary");
  const canViewLib = useFeaturePermission("canViewDotLibrary");
  const canAccess = canViewLib || canManageLib;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agencyFilter, setAgencyFilter] = useState("");
  const [bidTabOpen, setBidTabOpen] = useState(false);
  const [bidTabUrl, setBidTabUrl] = useState("");
  const [bidTabAgency, setBidTabAgency] = useState("");
  const { toast } = useToast();
  const bidTabMut = useMutation<BidTabResponse, Error, void>({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ai-features/heavy-civil/bid-tab/extract", {
        documentUrl: bidTabUrl.trim(),
        agencyName: bidTabAgency.trim() || undefined,
      });
      return (await r.json()) as BidTabResponse;
    },
    onError: (error: Error) => toast({ title: "Bid-tab extraction failed", description: error.message, variant: "destructive" }),
  });
  const { data: agencies = [], isLoading } = useQuery<DotAgency[]>({ queryKey: ["/api/dot/agencies"], enabled: canAccess });

  if (!canAccess) {
    return (
      <div className="container mx-auto p-6" data-testid="no-access-dot-library">
        <Card><CardContent className="p-8 text-center text-muted-foreground">You don't have permission to view the DOT Library.</CardContent></Card>
      </div>
    );
  }

  const filtered = agencies.filter((a) =>
    !agencyFilter ||
    a.name.toLowerCase().includes(agencyFilter.toLowerCase()) ||
    a.code.toLowerCase().includes(agencyFilter.toLowerCase()) ||
    (a.stateCode || "").toLowerCase().includes(agencyFilter.toLowerCase()),
  );

  const counts = {
    federal: agencies.filter((a) => a.kind === "FEDERAL").length,
    state: agencies.filter((a) => a.kind === "STATE_DOT").length,
    territory: agencies.filter((a) => a.kind === "TERRITORY_DOT").length,
    toll: agencies.filter((a) => a.kind === "TOLL_AUTHORITY").length,
  };

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">DOT Library</h1>
          <p className="text-sm text-muted-foreground">
            Federal, state, territory and toll-authority pay item libraries with spec book editions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBidTabOpen(true)} data-testid="button-open-bid-tab-extract">
            <Wand2 className="h-4 w-4 mr-2" />AI Bid-Tab Extract
          </Button>
          <Button onClick={() => setPickerOpen(true)} data-testid="button-open-pay-item-picker">
            <Search className="h-4 w-4 mr-2" />Browse Pay Items
          </Button>
        </div>
      </div>

      <Dialog open={bidTabOpen} onOpenChange={(o) => { setBidTabOpen(o); if (!o) bidTabMut.reset(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>AI Bid-Tab Extractor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Document URL (PDF / Excel of bid tabulation)</Label>
              <Input value={bidTabUrl} onChange={(e) => setBidTabUrl(e.target.value)} placeholder="https://… or storage URL" data-testid="input-bid-tab-url" />
            </div>
            <div>
              <Label>Agency (optional, helps AI)</Label>
              <Input value={bidTabAgency} onChange={(e) => setBidTabAgency(e.target.value)} placeholder="e.g. Caltrans, ODOT, FHWA" data-testid="input-bid-tab-agency" />
            </div>
            <p className="text-xs text-muted-foreground">AI will parse pay items (item #, description, unit, qty). Always review before adding to your library.</p>
            {bidTabMut.data && !bidTabMut.data.fallback && (
              <div className="border rounded p-3 max-h-72 overflow-y-auto" data-testid="text-bid-tab-result">
                <div className="text-xs text-muted-foreground mb-2">Confidence: {bidTabMut.data.confidence ?? "—"}/100 · {bidTabMut.data.items?.length ?? 0} items</div>
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-left"><th className="py-1 pr-2">Item #</th><th className="pr-2">Description</th><th className="pr-2">Unit</th><th>Qty</th></tr></thead>
                  <tbody>
                    {(bidTabMut.data.items ?? []).map((it, k) => (
                      <tr key={k} className="border-b last:border-0">
                        <td className="py-1 pr-2 font-mono">{it.itemNumber}</td>
                        <td className="pr-2">{it.description}</td>
                        <td className="pr-2">{it.unit}</td>
                        <td>{it.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {bidTabMut.data.notes && <div className="text-xs text-muted-foreground mt-2">{bidTabMut.data.notes}</div>}
              </div>
            )}
            {bidTabMut.data?.fallback && (
              <div className="text-xs text-amber-600">{bidTabMut.data.message ?? "AI could not extract — enter pay items manually."}</div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBidTabOpen(false)} data-testid="button-bid-tab-close">Close</Button>
            <Button disabled={bidTabMut.isPending || bidTabUrl.trim().length < 5} onClick={() => bidTabMut.mutate()} data-testid="button-bid-tab-run">
              {bidTabMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Extract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Federal" value={counts.federal} />
        <StatCard label="State DOTs" value={counts.state} />
        <StatCard label="Territories" value={counts.territory} />
        <StatCard label="Toll / Port Authorities" value={counts.toll} />
      </div>

      <Tabs defaultValue="agencies">
        <TabsList>
          <TabsTrigger value="agencies" data-testid="tab-agencies">Agencies</TabsTrigger>
          <TabsTrigger value="how" data-testid="tab-how-it-works">How it works</TabsTrigger>
        </TabsList>

        <TabsContent value="agencies" className="space-y-3">
          <div className="relative max-w-md">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Filter by name, code, or state"
              className="pl-8"
              value={agencyFilter}
              onChange={(e) => setAgencyFilter(e.target.value)}
              data-testid="input-agency-filter"
            />
          </div>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="animate-spin h-5 w-5 mr-2" />Loading agencies…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No agencies found"
              description="No agencies match your filter."
              testId="empty-state-agencies"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((a) => (
                <AgencyCard key={a.id} agency={a} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="how">
          <Card>
            <CardHeader><CardTitle>How DOT pay item libraries work</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>1. Each agency has one or more <strong>spec book editions</strong> (e.g. ODOT C&MS 2023, FHWA FP-14).</p>
              <p>2. Each spec book contains a list of <strong>pay items</strong> with item number, description, unit, and spec section.</p>
              <p>3. When you build a bid or estimate, link line items to the appropriate pay item — the pay item number, unit, and spec section flow through to the SOV and DOT progress estimate format.</p>
              <p>4. Your organization can override descriptions or add internal aliases without touching the global library.</p>
              <p className="pt-2">Tier-1 agency content (FHWA + ODOT) ships pre-loaded. Additional agency content is added via Super Admin bulk upload (CSV / AASHTOWare export).</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <PayItemPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(s) => {
          alert(`Selected ${s.payItem.itemNumber} — ${s.payItem.description} (${s.payItem.unit}) from ${s.agency.name}`);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold mt-1" data-testid={`stat-${label.toLowerCase().replace(/[^a-z]/g, "-")}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function AgencyCard({ agency }: { agency: DotAgency }) {
  const { data: specBooks = [] } = useQuery<DotSpecBook[]>({
    queryKey: ["/api/dot/agencies", agency.id, "spec-books"],
    queryFn: async () => {
      const r = await fetch(`/api/dot/agencies/${agency.id}/spec-books`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const current = specBooks.find((s) => s.isCurrent) || specBooks[0];
  const { data: items = [] } = useQuery<DotPayItem[]>({
    queryKey: ["/api/dot/pay-items", { specBookId: current?.id, limit: 1 }],
    enabled: !!current,
    queryFn: async () => {
      const r = await fetch(`/api/dot/pay-items?specBookId=${current!.id}&limit=1`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });
  return (
    <Card data-testid={`card-agency-${agency.code}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">{agency.name}</CardTitle>
            <div className="text-xs text-muted-foreground">{agency.code}{agency.stateCode ? ` · ${agency.stateCode}` : ""}</div>
          </div>
          <Badge variant="outline">{agency.kind.replace(/_/g, " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />
          {current ? `${current.title} (${current.edition})` : "No spec book loaded"}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Hash className="h-3.5 w-3.5" />
          {current?.itemCount ?? 0} pay items {items.length === 0 && current?.itemCount === 0 ? "(library empty)" : ""}
        </div>
      </CardContent>
    </Card>
  );
}
