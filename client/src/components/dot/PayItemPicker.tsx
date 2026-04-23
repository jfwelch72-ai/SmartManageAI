import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToastAction } from "@/components/ui/toast";
import { Search, Loader2, Sparkles, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { PayItemMatchReasonChips } from "@/components/dot/PayItemMatchReasonChips";

interface FacetEntry { value: string; count: number; }
interface PayItemFacets { categories: FacetEntry[]; specSections: FacetEntry[]; }

export interface DotAgency {
  id: string;
  code: string;
  name: string;
  stateCode: string | null;
  kind: string;
  currentSpecYear: string | null;
}
export interface DotSpecBook { id: string; agencyId: string; edition: string; title: string; isCurrent: boolean; itemCount: number; }
export interface DotPayItem {
  id: string;
  specBookId: string;
  agencyId: string;
  itemNumber: string;
  description: string;
  unit: string;
  specSection: string | null;
  category: string | null;
}

export interface SelectedPayItem {
  payItem: DotPayItem;
  agency: DotAgency;
  specBook: DotSpecBook;
}

interface MatchSuggestion {
  payItem: DotPayItem;
  agency: DotAgency;
  specBook: DotSpecBook;
  score: number;
  matchReason: "alias" | "fuzzy";
  aliasText: string | null;
  matchedTokens: string[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: SelectedPayItem) => void;
  defaultAgencyId?: string;
  /** Seed text used to auto-suggest DOT pay items (typically the line description). */
  seedDescription?: string;
  seedUnit?: string | null;
  seedCategory?: string | null;
}

export function PayItemPicker({
  open,
  onOpenChange,
  onSelect,
  defaultAgencyId,
  seedDescription,
  seedUnit,
  seedCategory,
}: Props) {
  const { user } = useAuth();
  const [agencyId, setAgencyId] = useState<string | undefined>(defaultAgencyId);
  const [specBookId, setSpecBookId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);

  const { data: agencies = [] } = useQuery<DotAgency[]>({ queryKey: ["/api/dot/agencies"], enabled: open });
  const { data: specBooks = [] } = useQuery<DotSpecBook[]>({
    queryKey: ["/api/dot/agencies", agencyId, "spec-books"],
    enabled: open && !!agencyId,
    queryFn: async () => {
      const r = await fetch(`/api/dot/agencies/${agencyId}/spec-books`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load spec books");
      return r.json();
    },
  });

  const effectiveSpecBookId = specBookId || specBooks.find((s) => s.isCurrent)?.id || specBooks[0]?.id;

  // Persist facet selections per spec book in localStorage so estimators don't
  // have to re-pick their usual categories every time the picker reopens.
  const facetStorageKey = effectiveSpecBookId && user?.id
    ? `dot-pay-item-picker:facets:${user.id}:${effectiveSpecBookId}`
    : null;
  useEffect(() => {
    if (!facetStorageKey) {
      setSelectedCategories([]);
      setSelectedSections([]);
      return;
    }
    try {
      const raw = localStorage.getItem(facetStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { categories?: unknown; specSections?: unknown };
        const onlyStrings = (v: unknown): string[] =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
        setSelectedCategories(onlyStrings(parsed.categories));
        setSelectedSections(onlyStrings(parsed.specSections));
      } else {
        setSelectedCategories([]);
        setSelectedSections([]);
      }
    } catch {
      setSelectedCategories([]);
      setSelectedSections([]);
    }
  }, [facetStorageKey]);

  useEffect(() => {
    if (!facetStorageKey) return;
    try {
      if (selectedCategories.length === 0 && selectedSections.length === 0) {
        localStorage.removeItem(facetStorageKey);
      } else {
        localStorage.setItem(
          facetStorageKey,
          JSON.stringify({ categories: selectedCategories, specSections: selectedSections }),
        );
      }
    } catch {
      // ignore quota/serialization errors — persistence is best-effort
    }
  }, [facetStorageKey, selectedCategories, selectedSections]);

  const { data: facets } = useQuery<PayItemFacets>({
    queryKey: ["/api/dot/pay-items/facets", { specBookId: effectiveSpecBookId }],
    enabled: open && !!effectiveSpecBookId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveSpecBookId) params.set("specBookId", effectiveSpecBookId);
      const r = await fetch(`/api/dot/pay-items/facets?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load facets");
      return r.json();
    },
  });
  const categoryFacets = facets?.categories ?? [];
  const sectionFacets = facets?.specSections ?? [];

  const sortedCategories = selectedCategories.slice().sort().join(",");
  const sortedSections = selectedSections.slice().sort().join(",");
  const { data: payItems = [], isLoading } = useQuery<DotPayItem[]>({
    queryKey: [
      "/api/dot/pay-items",
      { specBookId: effectiveSpecBookId, q: search, categories: sortedCategories, specSections: sortedSections },
    ],
    enabled: open && !!effectiveSpecBookId,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (effectiveSpecBookId) params.set("specBookId", effectiveSpecBookId);
      if (search.trim()) params.set("q", search.trim());
      if (sortedCategories) params.set("categories", sortedCategories);
      if (sortedSections) params.set("specSections", sortedSections);
      params.set("limit", "150");
      const r = await fetch(`/api/dot/pay-items?${params}`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load pay items");
      return r.json();
    },
  });

  const toggleCategory = (value: string) => {
    setSelectedCategories((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };
  const toggleSection = (value: string) => {
    setSelectedSections((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    );
  };
  const clearFacets = () => {
    setSelectedCategories([]);
    setSelectedSections([]);
  };
  const hasActiveFacets = selectedCategories.length > 0 || selectedSections.length > 0;

  // Auto-match suggestions seeded from the line item description
  const seedKey = (seedDescription ?? "").trim();
  const {
    data: matchData,
    isLoading: matchLoading,
  } = useQuery<{ matches: MatchSuggestion[] }>({
    queryKey: ["/api/dot/pay-items/match", { description: seedKey, unit: seedUnit ?? null, category: seedCategory ?? null }],
    enabled: open && seedKey.length >= 3,
    queryFn: async () => {
      const r = await apiRequest("POST", "/api/dot/pay-items/match", {
        description: seedKey,
        unit: seedUnit ?? null,
        category: seedCategory ?? null,
        limit: 6,
      });
      return r.json();
    },
  });
  const suggestions = matchData?.matches ?? [];

  // Save the seed description as an internalAlias on dotPayItemOverrides so the
  // matcher returns this pay item as a top-priority "alias" hit next time the
  // estimator types the same description.
  const { toast } = useToast();
  const saveAliasMut = useMutation<unknown, Error, { payItemId: string; alias: string; itemNumber: string }>({
    mutationFn: async ({ payItemId, alias }) => {
      const r = await apiRequest("POST", "/api/dot/pay-item-overrides", {
        payItemId,
        internalAlias: alias,
      });
      return r.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-item-overrides"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match"] });
      toast({
        title: "Match saved",
        description: `"${vars.alias.slice(0, 60)}${vars.alias.length > 60 ? "…" : ""}" will auto-resolve to ${vars.itemNumber}.`,
      });
    },
    onError: (err) => {
      toast({ title: "Couldn't save match", description: err.message, variant: "destructive" });
    },
  });

  const handleSuggestionClick = (s: MatchSuggestion) => {
    onSelect({ payItem: s.payItem, agency: s.agency, specBook: s.specBook });
    // Only offer to remember when this was a fuzzy guess — alias hits already
    // resolve directly. Skip if the suggestion text is already an exact alias
    // for this seed (case-insensitive).
    const trimmed = seedKey.trim();
    if (s.matchReason !== "fuzzy" || trimmed.length < 3) return;
    if (s.aliasText && s.aliasText.toLowerCase() === trimmed.toLowerCase()) return;
    toast({
      title: "Remember this match?",
      description: `Save "${trimmed.slice(0, 60)}${trimmed.length > 60 ? "…" : ""}" as an alias for ${s.payItem.itemNumber} so it auto-matches next time.`,
      action: (
        <ToastAction
          altText="Remember this match"
          data-testid={`button-remember-match-${s.payItem.id}`}
          onClick={() => saveAliasMut.mutate({ payItemId: s.payItem.id, alias: trimmed, itemNumber: s.payItem.itemNumber })}
        >
          Remember
        </ToastAction>
      ),
    });
  };

  // If user hasn't picked an agency yet, default to the first suggestion's agency for browse context.
  useEffect(() => {
    if (open && !agencyId && suggestions.length > 0) {
      setAgencyId(suggestions[0].agency.id);
    }
  }, [open, agencyId, suggestions]);

  const agencyById = useMemo(() => Object.fromEntries(agencies.map((a) => [a.id, a])), [agencies]);
  const specBookById = useMemo(() => Object.fromEntries(specBooks.map((s) => [s.id, s])), [specBooks]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col" data-testid="dialog-pay-item-picker">
        <DialogHeader>
          <DialogTitle>Select DOT Pay Item</DialogTitle>
        </DialogHeader>

        {seedKey.length >= 3 && (
          <div className="border rounded-md bg-primary/5" data-testid="section-pay-item-suggestions">
            <div className="flex items-center gap-2 px-3 py-2 border-b bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Suggested matches for "{seedKey.slice(0, 80)}{seedKey.length > 80 ? "…" : ""}"</span>
              {matchLoading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {!matchLoading && suggestions.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground" data-testid="text-no-suggestions">
                No automatic matches yet — try searching below.
              </div>
            ) : (
              <div className="divide-y max-h-56 overflow-y-auto">
                {suggestions.map((s) => (
                  <button
                    key={s.payItem.id}
                    onClick={() => handleSuggestionClick(s)}
                    className="w-full text-left p-3 hover-elevate active-elevate-2 flex items-start justify-between gap-3"
                    data-testid={`button-suggestion-${s.payItem.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{s.payItem.itemNumber}</span>
                        <Badge variant="outline" className="text-xs">{s.agency.code}{s.agency.stateCode ? ` · ${s.agency.stateCode}` : ""}</Badge>
                        <span className="ml-auto text-xs text-muted-foreground" data-testid={`text-suggestion-score-${s.payItem.id}`}>
                          {Math.round(s.score * 100)}% match
                        </span>
                      </div>
                      <div className="text-sm mt-0.5 truncate">{s.payItem.description}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {s.payItem.category ?? "Uncategorized"}
                        {s.payItem.specSection ? ` · §${s.payItem.specSection}` : ""}
                      </div>
                      <div className="mt-1.5">
                        <PayItemMatchReasonChips
                          matchReason={s.matchReason}
                          aliasText={s.aliasText}
                          matchedTokens={s.matchedTokens}
                          payItem={s.payItem}
                          seedDescription={seedKey}
                          seedUnit={seedUnit ?? null}
                          seedCategory={seedCategory ?? null}
                          testIdPrefix={`suggestion-${s.payItem.id}`}
                          size="xs"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline">{s.payItem.unit}</Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select value={agencyId} onValueChange={(v) => { setAgencyId(v); setSpecBookId(undefined); }}>
            <SelectTrigger data-testid="select-agency"><SelectValue placeholder="Choose agency" /></SelectTrigger>
            <SelectContent>
              {agencies.map((a) => (
                <SelectItem key={a.id} value={a.id} data-testid={`option-agency-${a.code}`}>
                  {a.name} {a.stateCode ? `(${a.stateCode})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={effectiveSpecBookId} onValueChange={setSpecBookId} disabled={!agencyId}>
            <SelectTrigger data-testid="select-spec-book"><SelectValue placeholder="Spec book edition" /></SelectTrigger>
            <SelectContent>
              {specBooks.map((sb) => (
                <SelectItem key={sb.id} value={sb.id} data-testid={`option-spec-book-${sb.edition}`}>
                  {sb.edition} {sb.isCurrent ? "(current)" : ""} — {sb.itemCount} items
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by item number or description"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
            data-testid="input-pay-item-search"
          />
        </div>
        {effectiveSpecBookId && (categoryFacets.length > 0 || sectionFacets.length > 0) && (
          <div className="border rounded-md p-2 space-y-2" data-testid="section-pay-item-facets">
            {categoryFacets.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Category</div>
                  {hasActiveFacets && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={clearFacets}
                      data-testid="button-clear-facets"
                    >
                      <X className="h-3 w-3 mr-1" />Clear filters
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {categoryFacets.map((c) => {
                    const active = selectedCategories.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleCategory(c.value)}
                        className={`text-xs px-2 py-1 rounded-md border hover-elevate active-elevate-2 ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                        data-testid={`button-facet-category-${c.value.replace(/[^a-zA-Z0-9]/g, "-")}`}
                        aria-pressed={active}
                      >
                        {c.value} <span className={active ? "opacity-80" : "text-muted-foreground"}>({c.count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {sectionFacets.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Spec section</div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {sectionFacets.map((s) => {
                    const active = selectedSections.includes(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        onClick={() => toggleSection(s.value)}
                        className={`text-xs px-2 py-1 rounded-md border font-mono hover-elevate active-elevate-2 ${active ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                        data-testid={`button-facet-section-${s.value.replace(/[^a-zA-Z0-9]/g, "-")}`}
                        aria-pressed={active}
                      >
                        §{s.value} <span className={active ? "opacity-80" : "text-muted-foreground"}>({s.count})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <ScrollArea className="flex-1 border rounded-md">
          {isLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground"><Loader2 className="animate-spin mr-2 h-4 w-4" />Loading…</div>
          ) : payItems.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground" data-testid="text-no-pay-items">
              {effectiveSpecBookId ? "No pay items match your filter." : "Choose an agency to see its pay items."}
            </div>
          ) : (
            <div className="divide-y">
              {payItems.map((p) => {
                const agency = agencyById[p.agencyId];
                const sb = specBookById[p.specBookId];
                return (
                  <button
                    key={p.id}
                    onClick={() => agency && sb && onSelect({ payItem: p, agency, specBook: sb })}
                    className="w-full text-left p-3 hover-elevate active-elevate-2 flex items-start justify-between gap-3"
                    data-testid={`button-pay-item-${p.id}`}
                  >
                    <div className="flex-1">
                      <div className="font-mono text-sm font-medium">{p.itemNumber}</div>
                      <div className="text-sm">{p.description}</div>
                      {p.category && <div className="text-xs text-muted-foreground mt-0.5">{p.category}</div>}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline">{p.unit}</Badge>
                      {p.specSection && <span className="text-xs text-muted-foreground">§{p.specSection}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </ScrollArea>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-pay-item-picker-cancel">Cancel</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
