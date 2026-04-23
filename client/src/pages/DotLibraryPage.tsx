import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PayItemPicker, type DotAgency, type DotSpecBook, type DotPayItem } from "@/components/dot/PayItemPicker";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Building2, BookOpen, Hash, Search, Wand2, Tag, Trash2, Layers, FolderTree, Pencil, TrendingUp, Sparkles, History, Check, X } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { useFeaturePermission } from "@/hooks/use-dashboard-customization";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface PayItemOverrideEnriched {
  id: string;
  organizationId: string;
  payItemId: string;
  internalAlias: string | null;
  customDescription: string | null;
  customUnit: string | null;
  customCategory: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  payItem: { id: string; itemNumber: string; description: string; unit: string; specSection: string | null; category: string | null } | null;
  agency: { id: string; code: string; name: string; stateCode: string | null } | null;
  specBook: { id: string; edition: string; title: string } | null;
}

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
  const [pickerAgencyId, setPickerAgencyId] = useState<string | undefined>();
  const [pickerFocusFacet, setPickerFocusFacet] = useState<"categories" | "specSections" | undefined>();
  const [agencyFilter, setAgencyFilter] = useState("");
  const openPickerForAgency = (agencyId: string, focus: "categories" | "specSections") => {
    setPickerAgencyId(agencyId);
    setPickerFocusFacet(focus);
    setPickerOpen(true);
  };
  const [bidTabOpen, setBidTabOpen] = useState(false);
  const [bidTabDocId, setBidTabDocId] = useState("");
  const [bidTabAgency, setBidTabAgency] = useState("");
  const { toast } = useToast();
  const bidTabMut = useMutation<BidTabResponse, Error, void>({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/ai-features/heavy-civil/bid-tab/extract", {
        documentId: bidTabDocId.trim(),
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
          <Button onClick={() => { setPickerAgencyId(undefined); setPickerFocusFacet(undefined); setPickerOpen(true); }} data-testid="button-open-pay-item-picker">
            <Search className="h-4 w-4 mr-2" />Browse Pay Items
          </Button>
        </div>
      </div>

      <Dialog open={bidTabOpen} onOpenChange={(o) => { setBidTabOpen(o); if (!o) bidTabMut.reset(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>AI Bid-Tab Extractor</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Uploaded Document ID (PDF / Excel of bid tabulation)</Label>
              <Input value={bidTabDocId} onChange={(e) => setBidTabDocId(e.target.value)} placeholder="Paste plan-document ID — must be uploaded to your org first" data-testid="input-bid-tab-doc-id" />
              <p className="text-xs text-muted-foreground mt-1">For tenant safety, only documents already uploaded to your project library can be parsed.</p>
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
            <Button disabled={bidTabMut.isPending || bidTabDocId.trim().length < 1} onClick={() => bidTabMut.mutate()} data-testid="button-bid-tab-run">
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
          <TabsTrigger value="aliases" data-testid="tab-aliases">Saved aliases</TabsTrigger>
          <TabsTrigger value="top-matches" data-testid="tab-top-matches">Top auto-matches</TabsTrigger>
          <TabsTrigger value="recent-decisions" data-testid="tab-recent-decisions">Recent decisions</TabsTrigger>
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
                <AgencyCard key={a.id} agency={a} onOpenFacet={openPickerForAgency} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="aliases" className="space-y-3">
          <SavedAliasesSection canManage={!!canManageLib} />
        </TabsContent>

        <TabsContent value="top-matches" className="space-y-3">
          <TopAutoMatchesSection canManage={!!canManageLib} />
        </TabsContent>

        <TabsContent value="recent-decisions" className="space-y-3">
          <RecentDecisionsSection />
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
        defaultAgencyId={pickerAgencyId}
        defaultFocusFacet={pickerFocusFacet}
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

function AgencyCard({ agency, onOpenFacet }: { agency: DotAgency; onOpenFacet: (agencyId: string, focus: "categories" | "specSections") => void }) {
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
  const { data: facets } = useQuery<{ categories: { value: string; count: number }[]; specSections: { value: string; count: number }[] }>({
    queryKey: ["/api/dot/pay-items/facets", { agencyId: agency.id, specBookId: current?.id }],
    enabled: !!current,
    queryFn: async () => {
      const r = await fetch(`/api/dot/pay-items/facets?agencyId=${agency.id}&specBookId=${current!.id}`, { credentials: "include" });
      if (!r.ok) return { categories: [], specSections: [] };
      return r.json();
    },
  });
  const categoryCount = facets?.categories.length ?? 0;
  const sectionCount = facets?.specSections.length ?? 0;
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
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            type="button"
            onClick={() => onOpenFacet(agency.id, "categories")}
            disabled={categoryCount === 0}
            className="inline-flex items-center gap-1 rounded-md bg-secondary text-secondary-foreground text-xs px-2 py-0.5 font-semibold hover-elevate active-elevate-2 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`badge-categories-${agency.code}`}
            aria-label={`Browse ${agency.name} pay items by category`}
          >
            <FolderTree className="h-3 w-3" />
            {categoryCount} {categoryCount === 1 ? "category" : "categories"}
          </button>
          <button
            type="button"
            onClick={() => onOpenFacet(agency.id, "specSections")}
            disabled={sectionCount === 0}
            className="inline-flex items-center gap-1 rounded-md bg-secondary text-secondary-foreground text-xs px-2 py-0.5 font-semibold hover-elevate active-elevate-2 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid={`badge-sections-${agency.code}`}
            aria-label={`Browse ${agency.name} pay items by spec section`}
          >
            <Layers className="h-3 w-3" />
            {sectionCount} {sectionCount === 1 ? "section" : "sections"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

function SavedAliasesSection({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<PayItemOverrideEnriched | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const { data: rows = [], isLoading } = useQuery<PayItemOverrideEnriched[]>({
    queryKey: ["/api/dot/pay-item-overrides", { include: "payItem" }],
    queryFn: async () => {
      const r = await fetch("/api/dot/pay-item-overrides?include=payItem", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load aliases");
      return r.json();
    },
  });

  // Clearing only the internalAlias preserves any sibling override data
  // (customDescription, customUnit, etc.) the org has set for the same pay
  // item. The server drops the row entirely if no override fields remain.
  const deleteMut = useMutation<unknown, Error, string>({
    mutationFn: async (id) => {
      const r = await apiRequest("PATCH", `/api/dot/pay-item-overrides/${id}`, { internalAlias: null });
      return r;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-item-overrides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match"] });
      toast({ title: "Alias removed" });
    },
    onError: (err) => toast({ title: "Couldn't remove", description: err.message, variant: "destructive" }),
  });

  const editMut = useMutation<unknown, Error, { id: string; internalAlias: string; notes: string | null }>({
    mutationFn: async ({ id, internalAlias, notes }) => {
      return apiRequest("PATCH", `/api/dot/pay-item-overrides/${id}`, {
        internalAlias,
        notes,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-item-overrides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match"] });
      toast({ title: "Alias updated" });
      setEditing(null);
    },
    onError: (err) => toast({ title: "Couldn't save", description: err.message, variant: "destructive" }),
  });

  const openEdit = (r: PayItemOverrideEnriched) => {
    setEditing(r);
    setEditAlias(r.internalAlias ?? "");
    setEditNotes(r.notes ?? "");
  };

  const submitEdit = () => {
    if (!editing) return;
    const trimmed = editAlias.trim();
    if (!trimmed) {
      toast({ title: "Alias can't be empty", variant: "destructive" });
      return;
    }
    editMut.mutate({
      id: editing.id,
      internalAlias: trimmed,
      notes: editNotes.trim() ? editNotes.trim() : null,
    });
  };

  const aliasRows = rows.filter((r) => r.internalAlias && r.internalAlias.trim().length > 0);
  const visible = aliasRows.filter((r) => {
    if (!filter.trim()) return true;
    const q = filter.toLowerCase();
    return (
      (r.internalAlias ?? "").toLowerCase().includes(q) ||
      (r.payItem?.itemNumber ?? "").toLowerCase().includes(q) ||
      (r.payItem?.description ?? "").toLowerCase().includes(q) ||
      (r.agency?.code ?? "").toLowerCase().includes(q)
    );
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin h-5 w-5 mr-2" />Loading aliases…
      </div>
    );
  }

  if (aliasRows.length === 0) {
    return (
      <EmptyState
        icon={Tag}
        title="No saved aliases yet"
        description="When you accept a fuzzy match in the pay-item picker, choose 'Remember' on the toast and the line description will be saved here as an alias for that DOT pay item."
        testId="empty-state-aliases"
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative max-w-md">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by alias, item #, agency"
          className="pl-8"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          data-testid="input-alias-filter"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        These aliases give the auto-matcher a top-priority hint for your organization. Removing one returns that description to fuzzy matching.
      </p>
      <div className="border rounded-md divide-y">
        {visible.map((r) => (
          <div
            key={r.id}
            className="flex items-start justify-between gap-3 p-3"
            data-testid={`row-alias-${r.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="secondary" className="gap-1"><Tag className="h-3 w-3" /> Alias</Badge>
                <span className="text-sm font-medium" data-testid={`text-alias-${r.id}`}>
                  {r.internalAlias}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                → resolves to{" "}
                {r.payItem ? (
                  <>
                    <span className="font-mono">{r.payItem.itemNumber}</span>
                    {" — "}
                    {r.payItem.description}
                  </>
                ) : (
                  <span className="italic">deleted pay item</span>
                )}
                {r.agency && (
                  <>
                    {" · "}
                    <span>{r.agency.code}{r.agency.stateCode ? ` (${r.agency.stateCode})` : ""}</span>
                  </>
                )}
              </div>
            </div>
            {canManage && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => openEdit(r)}
                  data-testid={`button-edit-alias-${r.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(r.id)}
                  data-testid={`button-delete-alias-${r.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {visible.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground text-center">No aliases match your filter.</div>
        )}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent data-testid="dialog-edit-alias">
          <DialogHeader>
            <DialogTitle>Edit alias</DialogTitle>
            <DialogDescription>
              {editing?.payItem ? (
                <>Resolves to <span className="font-mono">{editing.payItem.itemNumber}</span> — {editing.payItem.description}</>
              ) : (
                "Resolves to a deleted pay item"
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-alias-text">Alias text</Label>
              <Input
                id="edit-alias-text"
                value={editAlias}
                onChange={(e) => setEditAlias(e.target.value)}
                data-testid="input-edit-alias-text"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-alias-notes">Notes (optional)</Label>
              <Textarea
                id="edit-alias-notes"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                data-testid="input-edit-alias-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} data-testid="button-cancel-edit-alias">
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={editMut.isPending} data-testid="button-save-edit-alias">
              {editMut.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TopMatchRow {
  payItem: { id: string; itemNumber: string; description: string; unit: string; specSection: string | null; category: string | null };
  agency: { id: string; code: string; name: string; stateCode: string | null } | null;
  specBook: { id: string; edition: string; title: string } | null;
  acceptCount: number;
  rejectCount: number;
  lastAcceptedAt: string | null;
  sampleDescriptions: string[];
  hasAlias: boolean;
}

interface TopMatchResponse {
  items: TopMatchRow[];
}

function TopAutoMatchesSection({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<TopMatchResponse>({
    queryKey: ["/api/dot/pay-items/match-history/top", { limit: 25 }],
    queryFn: async () => {
      const r = await fetch("/api/dot/pay-items/match-history/top?limit=25", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load top auto-matches");
      return r.json();
    },
  });
  const items = data?.items ?? [];

  const promoteMut = useMutation<unknown, Error, { row: TopMatchRow; alias: string; sampleIndex: number }>({
    mutationFn: async ({ row, alias }) => {
      return apiRequest("POST", "/api/dot/pay-item-overrides", {
        payItemId: row.payItem.id,
        internalAlias: alias,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-item-overrides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match"] });
      // Refetch top auto-matches so hasAlias flips to true without a page refresh.
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/top"] });
      toast({ title: "Alias saved", description: "Future imports of that description will jump straight to this pay item." });
    },
    onError: (err) => toast({ title: "Couldn't save alias", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin h-5 w-5 mr-2" />Loading top auto-matches…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={TrendingUp}
        title="No auto-match history yet"
        description="Once your team accepts (or rejects) DOT pay-item suggestions during bid-tab import, the most-used items will appear here so you can promote them to formal aliases."
        testId="empty-state-top-matches"
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Most-accepted DOT pay items from your bid-tab imports. Promote a frequently-used description to an alias so future imports skip the suggestion step entirely.
      </p>
      <div className="border rounded-md divide-y">
        {items.map((row) => {
          const promotable = canManage && !row.hasAlias;
          const pendingVars = promoteMut.isPending ? promoteMut.variables : undefined;
          const isRowPending = !!pendingVars && pendingVars.row.payItem.id === row.payItem.id;
          return (
            <div
              key={row.payItem.id}
              className="flex items-start justify-between gap-3 p-3"
              data-testid={`row-top-match-${row.payItem.id}`}
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-mono text-[11px]" data-testid={`badge-top-match-item-${row.payItem.id}`}>
                    {row.payItem.itemNumber}
                  </Badge>
                  <span className="text-sm font-medium truncate">{row.payItem.description}</span>
                  <Badge variant="secondary" className="text-[10px]">{row.payItem.unit}</Badge>
                  {row.agency && (
                    <span className="text-[11px] text-muted-foreground">
                      {row.agency.code}{row.agency.stateCode ? ` · ${row.agency.stateCode}` : ""}
                    </span>
                  )}
                  {row.hasAlias && (
                    <Badge variant="secondary" className="gap-1 text-[10px]" data-testid={`badge-has-alias-${row.payItem.id}`}>
                      <Tag className="h-3 w-3" /> aliased
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span data-testid={`text-top-match-accepts-${row.payItem.id}`}>
                    <span className="font-semibold text-foreground">{row.acceptCount}</span> accepted
                  </span>
                  {row.rejectCount > 0 && (
                    <span data-testid={`text-top-match-rejects-${row.payItem.id}`}>
                      {row.rejectCount} rejected
                    </span>
                  )}
                  {row.lastAcceptedAt && (
                    <span>last {new Date(row.lastAcceptedAt).toLocaleDateString()}</span>
                  )}
                </div>
                {row.sampleDescriptions.length > 0 && (
                  <div className="text-[11px] text-muted-foreground space-y-1">
                    <span className="text-muted-foreground/80">matched from:</span>
                    <ul className="space-y-1">
                      {row.sampleDescriptions.map((d, i) => {
                        const trimmed = d.trim();
                        const canPromoteSample = promotable && trimmed.length > 0;
                        const isThisPending = isRowPending && pendingVars?.sampleIndex === i;
                        return (
                          <li
                            key={i}
                            className="flex items-start gap-2"
                            data-testid={`row-top-match-sample-${row.payItem.id}-${i}`}
                          >
                            <span className="italic flex-1 min-w-0 break-words">&ldquo;{d}&rdquo;</span>
                            {canPromoteSample && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px] shrink-0"
                                disabled={isRowPending}
                                onClick={() => promoteMut.mutate({ row, alias: d, sampleIndex: i })}
                                data-testid={`button-promote-alias-${row.payItem.id}-${i}`}
                                title={`Save "${d}" as an alias for ${row.payItem.itemNumber}`}
                              >
                                {isThisPending ? (
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3 mr-1" />
                                )}
                                Promote
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface RecentDecisionRow {
  id: string;
  batchId: string | null;
  accepted: boolean;
  descriptionRaw: string;
  createdAt: string;
  payItem: { id: string; itemNumber: string; description: string; unit: string };
  agency: { id: string; code: string; name: string; stateCode: string | null } | null;
}

interface RecentDecisionsResponse {
  items: RecentDecisionRow[];
}

function RecentDecisionsSection() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<RecentDecisionsResponse>({
    queryKey: ["/api/dot/pay-items/match-history/recent", { limit: 50 }],
    queryFn: async () => {
      const r = await fetch("/api/dot/pay-items/match-history/recent?limit=50", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load recent decisions");
      return r.json();
    },
  });
  const items = data?.items ?? [];

  const deleteMut = useMutation<unknown, Error, RecentDecisionRow>({
    mutationFn: async (row) => {
      return apiRequest("DELETE", `/api/dot/pay-items/match-history/${encodeURIComponent(row.id)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/recent"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/top"] });
      toast({ title: "Decision removed", description: "That match decision will no longer influence future suggestions." });
    },
    onError: (err) => toast({ title: "Couldn't remove decision", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="animate-spin h-5 w-5 mr-2" />Loading recent decisions…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No recent decisions"
        description="As your team imports bid tabs and accepts (or rejects) DOT pay-item suggestions, the most recent decisions will appear here so you can scrub a one-off mis-match."
        testId="empty-state-recent-decisions"
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        The most recent {items.length} pay-item match decision{items.length === 1 ? "" : "s"} recorded for your org. Delete a row to stop it from boosting (or suppressing) that pay item in future imports.
      </p>
      <div className="border rounded-md divide-y">
        {items.map((row) => (
          <div
            key={row.id}
            className="flex items-start justify-between gap-3 p-3"
            data-testid={`row-recent-decision-${row.id}`}
          >
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {row.accepted ? (
                  <Badge variant="secondary" className="gap-1 text-[10px]" data-testid={`badge-decision-accepted-${row.id}`}>
                    <Check className="h-3 w-3" /> accepted
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-[10px]" data-testid={`badge-decision-rejected-${row.id}`}>
                    <X className="h-3 w-3" /> rejected
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-[11px]">{row.payItem.itemNumber}</Badge>
                <span className="text-sm font-medium truncate">{row.payItem.description}</span>
                <Badge variant="secondary" className="text-[10px]">{row.payItem.unit}</Badge>
                {row.agency && (
                  <span className="text-[11px] text-muted-foreground">
                    {row.agency.code}{row.agency.stateCode ? ` · ${row.agency.stateCode}` : ""}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-muted-foreground italic truncate" data-testid={`text-decision-source-${row.id}`}>
                from: &ldquo;{row.descriptionRaw}&rdquo;
              </div>
              <div className="text-[11px] text-muted-foreground">
                {new Date(row.createdAt).toLocaleString()}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={deleteMut.isPending}
              onClick={() => deleteMut.mutate(row)}
              data-testid={`button-delete-decision-${row.id}`}
              title="Forget this decision"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
