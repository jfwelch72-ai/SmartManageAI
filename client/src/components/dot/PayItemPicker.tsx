import { useState, useMemo, useEffect, useRef } from "react";
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
import { PayItemMatchExplain } from "@/components/dot/PayItemMatchExplain";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

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
  matchReason: "alias" | "history" | "fuzzy";
  aliasText: string | null;
  matchedTokens: string[];
  historyAccepts?: number;
  historyRejects?: number;
  agencyAccepts?: number;
  orgAffinityAccepts?: number;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (selected: SelectedPayItem) => void;
  defaultAgencyId?: string;
  /** When opening the picker, scroll to and visually highlight a specific facet panel. */
  defaultFocusFacet?: "categories" | "specSections";
  /** Seed text used to auto-suggest DOT pay items (typically the line description). */
  seedDescription?: string;
  seedUnit?: string | null;
  seedCategory?: string | null;
}

function arraysEqualOrdered(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function PayItemPicker({
  open,
  onOpenChange,
  onSelect,
  defaultAgencyId,
  defaultFocusFacet,
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
  const categoryFacetRef = useRef<HTMLDivElement | null>(null);
  const sectionFacetRef = useRef<HTMLDivElement | null>(null);
  const [highlightedFacet, setHighlightedFacet] = useState<"categories" | "specSections" | null>(null);

  // When the picker is (re)opened, sync local state to the consumer's
  // intent. If a defaultAgencyId is supplied (e.g. clicking an AgencyCard
  // badge) we scope to that agency; if it's explicitly cleared (e.g. the
  // generic "Browse Pay Items" button) we reset the prior selection so the
  // picker opens unscoped instead of remembering a stale agency.
  useEffect(() => {
    if (!open) return;
    if (defaultAgencyId) {
      if (defaultAgencyId !== agencyId) {
        setAgencyId(defaultAgencyId);
        setSpecBookId(undefined);
      }
    } else if (agencyId) {
      setAgencyId(undefined);
      setSpecBookId(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAgencyId]);

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

  // Task #1743 — Persist facet selections per spec book on the server so
  // estimators don't have to re-pick their usual categories every time the
  // picker reopens AND so the choice follows them across devices. The
  // legacy localStorage key (`dot-pay-item-picker:facets:<uid>:<specBookId>`)
  // is one-shot lifted up to the server below for any existing devices.
  // Include user.id in the cache key so an account switch in the same
  // browser session can't briefly show the previous user's facets from
  // the leftover cache entry.
  const facetsQueryKey =
    effectiveSpecBookId && user?.id
      ? (["/api/dot/pay-item-picker/facets", user.id, effectiveSpecBookId] as const)
      : null;
  const { data: serverFacets } = useQuery<{
    specBookId: string;
    categories: string[];
    specSections: string[];
  }>({
    queryKey: facetsQueryKey ?? ["/api/dot/pay-item-picker/facets", "_disabled"],
    enabled: open && !!facetsQueryKey && !!user?.id,
    queryFn: async () => {
      const r = await fetch(
        `/api/dot/pay-item-picker/facets/${encodeURIComponent(effectiveSpecBookId!)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Failed to load picker facets");
      return r.json();
    },
    // The global default `staleTime: Infinity` would make React Query
    // serve a previously cached payload on every reopen without ever
    // refetching, which would shadow facet changes the same user made
    // on another device. Override here so each open triggers a fresh
    // GET while still showing the cached value instantly for snappiness.
    staleTime: 0,
    refetchOnMount: "always",
  });

  // Persist facet selections to the server. Defined BEFORE the hydrate
  // effect because that effect reads `persistFacetsMut.isPending`. The
  // mutation cancels any in-flight GET for this spec book and writes the
  // new value into the React Query cache up-front so that a slower GET
  // response can't clobber the user's click.
  // Errors are swallowed to keep the picker responsive — the worst case
  // is the next session re-hydrates from the server's older value, which
  // the user can re-toggle.
  // Out-of-order PUTs: if the user toggles A then B fast, the requests
  // can resolve B-then-A, in which case A's response (older state)
  // must NOT clobber the cache. We deliberately do NOT write the
  // server response back into the cache in `onSuccess` — `onMutate`
  // already wrote the optimistic value, and a subsequent reopen will
  // refetch (staleTime: 0). That keeps the cache aligned with the
  // user's most recent click rather than the first PUT to resolve.
  const persistFacetsMut = useMutation<
    unknown,
    Error,
    { specBookId: string; categories: string[]; specSections: string[] }
  >({
    mutationFn: async ({ specBookId: sb, categories, specSections }) => {
      const r = await apiRequest(
        "PUT",
        `/api/dot/pay-item-picker/facets/${encodeURIComponent(sb)}`,
        { categories, specSections },
      );
      return r.json();
    },
    onMutate: async ({ specBookId: sb, categories, specSections }) => {
      if (!user?.id) return;
      const key = ["/api/dot/pay-item-picker/facets", user.id, sb] as const;
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, { specBookId: sb, categories, specSections });
    },
  });

  // Hydrate local facet selections from the server whenever the server
  // value changes for the current spec book. We deliberately do NOT
  // permanently latch on the first hydrate per spec book — doing so means
  // a stale cached payload that React Query returns synchronously on
  // reopen would shadow the fresh GET response that arrives moments
  // later, defeating the cross-device sync goal of the task.
  //
  // The race we DO need to guard against is: the user toggles a facet
  // optimistically, and an in-flight GET (from this picker session) or
  // some other refetch returns the stale empty value before the PUT
  // settles. The persist mutation handles that race by (a) cancelling
  // in-flight queries in `onMutate` and (b) optimistically writing the
  // new value into the React Query cache, so by the time this effect
  // runs after a toggle, `serverFacets` already reflects the user's
  // optimistic value. The `isPending` skip below is a belt-and-braces
  // fallback in case a refetch slips through while the PUT is mid-flight.
  useEffect(() => {
    if (!open) return;
    if (!effectiveSpecBookId) {
      setSelectedCategories([]);
      setSelectedSections([]);
      return;
    }
    if (persistFacetsMut.isPending) return;
    if (!serverFacets || serverFacets.specBookId !== effectiveSpecBookId) return;
    setSelectedCategories((prev) =>
      arraysEqualOrdered(prev, serverFacets.categories) ? prev : serverFacets.categories,
    );
    setSelectedSections((prev) =>
      arraysEqualOrdered(prev, serverFacets.specSections) ? prev : serverFacets.specSections,
    );
  }, [open, effectiveSpecBookId, serverFacets, persistFacetsMut.isPending]);

  // One-shot lift any legacy device-local entry up to the server, then
  // remove it so we don't keep doing this work every time the picker opens.
  // Guarded per (uid, specBookId) so we only run it once per session.
  const liftedKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.id || !effectiveSpecBookId) return;
    const legacyKey = `dot-pay-item-picker:facets:${user.id}:${effectiveSpecBookId}`;
    if (liftedKeys.current.has(legacyKey)) return;
    liftedKeys.current.add(legacyKey);
    let raw: string | null;
    try {
      raw = localStorage.getItem(legacyKey);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { categories?: unknown; specSections?: unknown };
      const onlyStrings = (v: unknown): string[] =>
        Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
      const legacyCategories = onlyStrings(parsed.categories);
      const legacySections = onlyStrings(parsed.specSections);
      if (legacyCategories.length === 0 && legacySections.length === 0) {
        try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
        return;
      }
      apiRequest("PUT", `/api/dot/pay-item-picker/facets/${encodeURIComponent(effectiveSpecBookId)}`, {
        categories: legacyCategories,
        specSections: legacySections,
      })
        .then(() => {
          try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
          // Push the lifted values into the cache. The hydrate effect
          // will pick them up on the next render and apply them to local
          // state — no longer blocked by a per-spec-book latch.
          if (user?.id) {
            queryClient.setQueryData(
              ["/api/dot/pay-item-picker/facets", user.id, effectiveSpecBookId],
              { specBookId: effectiveSpecBookId, categories: legacyCategories, specSections: legacySections },
            );
          }
        })
        .catch(() => {
          // Leave the legacy key in place so a later attempt can lift it.
          liftedKeys.current.delete(legacyKey);
        });
    } catch {
      // Malformed legacy value — drop it so it stops cluttering storage.
      try { localStorage.removeItem(legacyKey); } catch { /* ignore */ }
    }
    // `facetsQueryKey` intentionally omitted: it's a fresh array each
    // render; only user.id and effectiveSpecBookId are functionally needed.
  }, [user?.id, effectiveSpecBookId]);

  const persistFacets = (categories: string[], specSections: string[]) => {
    if (!effectiveSpecBookId || !user?.id) return;
    persistFacetsMut.mutate({ specBookId: effectiveSpecBookId, categories, specSections });
  };

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

  // When opened with a requested facet focus, scroll the matching panel into
  // view and briefly ring-highlight it so the user sees where to filter.
  useEffect(() => {
    if (!open || !defaultFocusFacet) return;
    if (defaultFocusFacet === "categories" && categoryFacets.length === 0) return;
    if (defaultFocusFacet === "specSections" && sectionFacets.length === 0) return;
    const node = defaultFocusFacet === "categories" ? categoryFacetRef.current : sectionFacetRef.current;
    if (!node) return;
    setHighlightedFacet(defaultFocusFacet);
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const t = setTimeout(() => setHighlightedFacet(null), 2000);
    return () => clearTimeout(t);
  }, [open, defaultFocusFacet, categoryFacets.length, sectionFacets.length]);

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
    setSelectedCategories((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      persistFacets(next, selectedSections);
      return next;
    });
  };
  const toggleSection = (value: string) => {
    setSelectedSections((prev) => {
      const next = prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value];
      persistFacets(selectedCategories, next);
      return next;
    });
  };
  const clearFacets = () => {
    setSelectedCategories([]);
    setSelectedSections([]);
    persistFacets([], []);
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
    if (s.matchReason === "alias" || s.matchReason === "history" || trimmed.length < 3) return;
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
                  <HoverCard key={s.payItem.id} openDelay={120} closeDelay={80}>
                    <HoverCardTrigger asChild>
                      <button
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
                              matchReason={s.matchReason === "history" ? "fuzzy" : s.matchReason}
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
                    </HoverCardTrigger>
                    <HoverCardContent
                      side="left"
                      align="start"
                      className="w-96"
                      data-testid={`hovercard-suggestion-${s.payItem.id}`}
                    >
                      <PayItemMatchExplain
                        suggestion={s}
                        seedDescription={seedKey}
                        seedUnit={seedUnit ?? null}
                        testIdPrefix={`suggestion-${s.payItem.id}`}
                      />
                    </HoverCardContent>
                  </HoverCard>
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
              <div
                ref={categoryFacetRef}
                className={`rounded-md transition-shadow ${highlightedFacet === "categories" ? "ring-2 ring-primary ring-offset-2 ring-offset-background p-1" : ""}`}
                data-testid="facet-panel-categories"
              >
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
              <div
                ref={sectionFacetRef}
                className={`rounded-md transition-shadow ${highlightedFacet === "specSections" ? "ring-2 ring-primary ring-offset-2 ring-offset-background p-1" : ""}`}
                data-testid="facet-panel-sections"
              >
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
