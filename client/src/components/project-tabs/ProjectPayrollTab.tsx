import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, FileText, RefreshCw, Plus, Loader2, Sparkles, Pencil, Trash2, Bell, BellOff } from "lucide-react";

// Task #1398: lightweight fuzzy match used to surface near-duplicate
// classifications when promoting a DOL feed row. Realistic typos like
// "Carpenter (Form Carpenter)" vs "Carpenter" should pre-select the
// existing classification instead of silently defaulting to "Create new".
function normalizeClassificationName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function classificationSimilarity(a: string, b: string): number {
  const A = normalizeClassificationName(a);
  const B = normalizeClassificationName(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  // Substring containment is a strong signal: e.g. "carpenter" inside
  // "carpenter form carpenter" should pre-select the existing carpenter row.
  if (A.includes(B) || B.includes(A)) {
    const minLen = Math.min(A.length, B.length);
    const maxLen = Math.max(A.length, B.length);
    return 0.7 + 0.3 * (minLen / maxLen);
  }
  const dist = levenshteinDistance(A, B);
  return 1 - dist / Math.max(A.length, B.length);
}

// Threshold above which we treat the candidate as a near-match worth
// pre-selecting. 0.7 keeps obvious typos in scope while requiring the
// user to opt in for genuinely new classifications.
const FUZZY_MATCH_THRESHOLD = 0.7;

function findBestClassificationMatch(
  feedName: string,
  candidates: ReadonlyArray<{ id: string; name: string }>,
): { id: string; name: string; score: number } | null {
  let best: { id: string; name: string; score: number } | null = null;
  for (const c of candidates) {
    const score = classificationSimilarity(feedName, c.name);
    if (score >= FUZZY_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { id: c.id, name: c.name, score };
    }
  }
  return best;
}

interface OrgJobClassification {
  id: string;
  name: string;
}

interface ProjectPayrollSummary {
  laborCostToDate: number;
  budget: number;
  laborVsBudget: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  overtimePercent: number;
  totalEntries: number;
  workers: { userId: string; name: string; role: string; regularHours: number; overtimeHours: number }[];
}

type PrevailingRateSource = "PROJECT_OVERRIDE" | "DOL_FEED";

// Task #1409: per-classification "rate changed recently" payload from
// the latest stale-refresh diff. `null` when the classification's rate
// hasn't shifted since the most recent acknowledgement (or never has).
interface PrevailingWageRecentChange {
  changeKind: "added" | "changed" | "removed";
  oldBaseRate: number | null;
  newBaseRate: number | null;
  oldFringeRate: number | null;
  newFringeRate: number | null;
  oldTotalRate: number | null;
  newTotalRate: number | null;
  detectedAt: string | null;
}

interface PrevailingWageClassification {
  classificationId: string;
  classificationName: string;
  wageRate: number;
  fringeRate: number | null;
  totalRate: number | null;
  overtimeMultiplier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  wageDecision: string | null;
  source: PrevailingRateSource;
  // Task #1396: original DOL feed name for DOL_FEED rows so the client can
  // round-trip the feed identity to the POST endpoint and persist the
  // user's chosen mapping for future syncs.
  dolFeedName?: string | null;
  // Task #1437: when this synthetic dol-feed row hasn't been mapped on
  // this project yet but a sibling project (same org, same wage decision)
  // already mapped this feed name, the server forwards the previously
  // chosen classificationId here so the override dialog can pre-select
  // it instead of running its fuzzy heuristic.
  rememberedClassificationId?: string | null;
  // Task #1409: populated when the most recent Davis-Bacon stale-refresh
  // changed this classification's rate. Drives the per-row badge.
  recentRateChange?: PrevailingWageRecentChange | null;
}

interface PrevailingWageSummary {
  projectId: string;
  wageDecision: string | null;
  wageDecisionCached: boolean | null;
  // Task #1332: persisted "last sync attempt" tracking so the banner can
  // distinguish "never tried" from "tried and failed" and show an error.
  wageDecisionLastSyncAt?: string | null;
  wageDecisionLastAttemptAt?: string | null;
  wageDecisionLastError?: string | null;
  // Task #1367: auto-retry progress (from integration_sync_state). Used to
  // tell users when the next background retry will fire (so they don't have
  // to babysit it) and to switch to a "manual action required" banner once
  // the chain is exhausted.
  wageDecisionRetryCount?: number | null;
  wageDecisionNextRetryAt?: string | null;
  wageDecisionRetryExhausted?: boolean | null;
  wageDecisionMaxRetries?: number | null;
  // Task #1339: surface cache size + a configurable staleness threshold so
  // PMs know how fresh the cached DOL decision is and can re-sync when in
  // doubt without leaving the project page.
  wageDecisionRatesCached?: number | null;
  wageDecisionStaleAfterDays?: number | null;
  // Task #1409: how many classifications have unacknowledged
  // "rate changed recently" flags + when the most-recent diff landed.
  // Drives the panel-level "rates changed recently" banner so PMs can
  // see at a glance which projects need reconciliation against
  // existing certified payrolls.
  wageDecisionRecentChangeCount?: number | null;
  wageDecisionRecentChangeAt?: string | null;
  // Task #1444: DOL feed rows for the current wage decision that still
  // have no saved classification mapping on this project. Drives the
  // "Needs mapping" summary inside the prevailing wage card so PMs can
  // jump directly to the unmapped row instead of scrolling the table.
  unmappedDolFeedCount?: number | null;
  unmappedDolFeedNames?: Array<{ dolFeedName: string; classificationId: string }>;
  classifications: PrevailingWageClassification[];
}

function formatRelativeTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

const formatCurrency = (val: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

function SourceBadge({ source }: { source: PrevailingRateSource }) {
  if (source === "PROJECT_OVERRIDE") {
    return (
      <Badge variant="default" className="text-xs" data-testid={`badge-source-project-override`}>
        Project override
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs" data-testid={`badge-source-dol-feed`}>
      DOL feed
    </Badge>
  );
}

interface SavedDolMapping {
  id: string;
  projectId: string;
  dolFeedName: string;
  classificationId: string;
  createdAt: string;
  updatedAt: string;
  classification: { id: string; name: string; code: string | null } | null;
}

// Task #1411: management surface for the DOL feed -> classification
// mappings persisted by task #1396. PMs need to be able to review what
// they previously saved, re-target a wrong pick, or clear a mapping so
// the next sync falls back to the default name-match / create-new
// behavior. Lives inside the Prevailing Wage card so it sits next to
// the place those mappings were created.
function SavedDolMappingsSection({
  projectId,
  orgClassifications,
  onMappingsChanged,
  unmappedDolFeedNames,
  unmappedDolFeedCount,
  onJumpToUnmapped,
}: {
  projectId: string;
  orgClassifications: ReadonlyArray<OrgJobClassification>;
  onMappingsChanged: () => void;
  // Task #1444: feed names from the cached wage decision that still have
  // no saved mapping on this project. Rendered as a "Needs mapping"
  // summary above the saved-mappings table so PMs can jump to the
  // unmapped synthetic row in the rates table to promote/map it.
  unmappedDolFeedNames?: Array<{ dolFeedName: string; classificationId: string }>;
  // Server-authoritative count. Falls back to `unmappedDolFeedNames.length`
  // when the server omits it (older payloads), but normally we render the
  // server value so the UI never disagrees with what the API computed.
  unmappedDolFeedCount?: number | null;
  onJumpToUnmapped?: (classificationId: string) => void;
}) {
  const { toast } = useToast();
  const mappingsKey = ["/api/labor-rates/dol-classification-mappings", { projectId }];
  const { data: mappings = [], isLoading } = useQuery<SavedDolMapping[]>({
    queryKey: mappingsKey,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editChoice, setEditChoice] = useState<string>("");

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; classificationId: string }) => {
      return await apiRequest("PATCH", `/api/labor-rates/dol-classification-mappings/${vars.id}`, {
        classificationId: vars.classificationId,
      });
    },
    onSuccess: () => {
      toast({ title: "Mapping updated", description: "DOL feed mapping re-pointed." });
      queryClient.invalidateQueries({ queryKey: mappingsKey });
      onMappingsChanged();
      setEditingId(null);
      setEditChoice("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to update mapping", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/labor-rates/dol-classification-mappings/${id}`);
    },
    onSuccess: () => {
      toast({
        title: "Mapping removed",
        description: "Future syncs will fall back to name match or create a new classification.",
      });
      queryClient.invalidateQueries({ queryKey: mappingsKey });
      onMappingsChanged();
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove mapping", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="border-t pt-4 mt-2">
        <h3 className="text-sm font-medium mb-2">Saved DOL classification mappings</h3>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const unmapped = unmappedDolFeedNames ?? [];
  // Prefer the server-provided count; only fall back to the list length
  // when the API omits it so the badge always agrees with the API.
  const unmappedCount = unmappedDolFeedCount ?? unmapped.length;

  return (
    <div className="border-t pt-4 mt-2 space-y-4" data-testid="section-dol-mappings">
      {/* Task #1444: needs-mapping summary so PMs can clean up unmapped
          DOL feed rows without scrolling the rates table to spot every
          synthetic `dol-feed:` row. The list is hidden when every feed
          name already has a saved (or auto name-matched) mapping. */}
      <div data-testid="section-dol-mappings-unmapped">
        <h3 className="text-sm font-medium">
          Needs mapping{" "}
          <span
            className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200 text-xs font-semibold px-2 py-0.5"
            data-testid="text-unmapped-dol-feed-count"
          >
            {unmappedCount}
          </span>
        </h3>
        <p className="text-xs text-muted-foreground">
          DOL feed names from the cached wage decision that still have no saved classification
          mapping on this project. Jump to a row to promote or map it.
        </p>
        {unmappedCount === 0 ? (
          <p
            className="text-sm text-muted-foreground mt-2"
            data-testid="text-no-unmapped-dol-feeds"
          >
            All DOL feed names are mapped.
          </p>
        ) : (
          <ul className="mt-2 space-y-1" data-testid="list-unmapped-dol-feeds">
            {unmapped.map((u) => (
              <li
                key={u.classificationId}
                className="flex items-center justify-between gap-2 rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-2 py-1"
                data-testid={`row-unmapped-dol-feed-${u.classificationId}`}
              >
                <span
                  className="font-mono text-xs truncate"
                  title={u.dolFeedName}
                  data-testid={`text-unmapped-dol-feed-name-${u.classificationId}`}
                >
                  {u.dolFeedName}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onJumpToUnmapped?.(u.classificationId)}
                  data-testid={`button-jump-unmapped-dol-feed-${u.classificationId}`}
                >
                  Jump to row
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium">Saved DOL classification mappings</h3>
        <p className="text-xs text-muted-foreground">
          DOL feed names you've mapped to org classifications. Removing a mapping causes the next
          sync to fall back to name-match or create a new classification.
        </p>
      </div>
      {mappings.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="text-no-dol-mappings">
          No saved mappings yet. Promote a DOL feed row above to create one.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>DOL feed name</TableHead>
                <TableHead>Mapped classification</TableHead>
                <TableHead className="text-right w-[180px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map((m) => {
                const isEditing = editingId === m.id;
                return (
                  <TableRow key={m.id} data-testid={`row-dol-mapping-${m.id}`}>
                    <TableCell
                      className="font-mono text-xs"
                      data-testid={`text-dol-mapping-feed-${m.id}`}
                    >
                      {m.dolFeedName}
                    </TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Select value={editChoice} onValueChange={setEditChoice}>
                          <SelectTrigger
                            className="h-8"
                            data-testid={`select-dol-mapping-${m.id}`}
                          >
                            <SelectValue placeholder="Select a classification..." />
                          </SelectTrigger>
                          <SelectContent>
                            {orgClassifications.map((c) => (
                              <SelectItem
                                key={c.id}
                                value={c.id}
                                data-testid={`option-dol-mapping-${m.id}-${c.id}`}
                              >
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span
                          className="text-sm"
                          data-testid={`text-dol-mapping-classification-${m.id}`}
                        >
                          {m.classification?.name ?? (
                            <span className="text-muted-foreground italic">Unknown</span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isEditing ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(null);
                              setEditChoice("");
                            }}
                            data-testid={`button-dol-mapping-cancel-${m.id}`}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              if (!editChoice) {
                                toast({
                                  title: "Pick a classification",
                                  description: "Select a classification to re-point this mapping to.",
                                  variant: "destructive",
                                });
                                return;
                              }
                              if (editChoice === m.classificationId) {
                                setEditingId(null);
                                setEditChoice("");
                                return;
                              }
                              updateMutation.mutate({ id: m.id, classificationId: editChoice });
                            }}
                            disabled={updateMutation.isPending}
                            data-testid={`button-dol-mapping-save-${m.id}`}
                          >
                            {updateMutation.isPending ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              "Save"
                            )}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingId(m.id);
                              setEditChoice(m.classificationId);
                            }}
                            data-testid={`button-dol-mapping-edit-${m.id}`}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1" /> Re-map
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (
                                !confirm(
                                  `Remove the mapping for "${m.dolFeedName}"? Future syncs will fall back to name-match or create a new classification.`,
                                )
                              ) {
                                return;
                              }
                              deleteMutation.mutate(m.id);
                            }}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-dol-mapping-delete-${m.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5 text-red-600" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function PrevailingWagePanel({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const summaryKey = ["/api/projects", projectId, "prevailing-wage-summary"];
  const { data, isLoading } = useQuery<PrevailingWageSummary>({
    queryKey: summaryKey,
  });

  // Task #1373: when a background auto-retry is pending, the banner shows
  // "next auto-retry at <time>" but won't update on its own once that time
  // passes. Schedule a refetch shortly after `wageDecisionNextRetryAt`
  // elapses so the UI flips to either the success state or the next
  // attempt without requiring the user to navigate or reload. Gated on
  // the retry-pending state so healthy projects don't poll needlessly.
  const nextRetryAtRaw = data?.wageDecisionNextRetryAt ?? null;
  const retryExhaustedRaw = data?.wageDecisionRetryExhausted ?? false;
  const hasFailure = !!data?.wageDecisionLastError && !!data?.wageDecision;
  useEffect(() => {
    if (!hasFailure || retryExhaustedRaw || !nextRetryAtRaw) return;
    const due = new Date(nextRetryAtRaw).getTime();
    if (Number.isNaN(due)) return;
    // Add a small buffer so the server-side retry has a chance to run
    // before we ask for the latest summary.
    const delay = Math.max(due - Date.now() + 2000, 1000);
    const timer = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: summaryKey });
    }, delay);
    return () => clearTimeout(timer);
    // summaryKey is derived from projectId; including projectId keeps the
    // dependency list stable without re-running on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, nextRetryAtRaw, retryExhaustedRaw, hasFailure]);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideRow, setOverrideRow] = useState<PrevailingWageClassification | null>(null);
  const [ovWageRate, setOvWageRate] = useState("");
  const [ovFringeRate, setOvFringeRate] = useState("");
  const [ovOtMultiplier, setOvOtMultiplier] = useState("1.5");
  const [ovEffectiveDate, setOvEffectiveDate] = useState("");
  const [ovExpirationDate, setOvExpirationDate] = useState("");
  const [ovNotes, setOvNotes] = useState("");
  // Task #1396: explicit classification target chosen by the user. Empty
  // string means "use the auto-matched classification"; the sentinel
  // "__create_new__" means "create a brand-new classification using the
  // DOL feed name". Anything else is a real job_classifications.id.
  const CREATE_NEW_SENTINEL = "__create_new__";
  const [ovMappingChoice, setOvMappingChoice] = useState<string>("");
  // Task #1398: id of the org classification flagged as a near-match to the
  // current DOL feed name. Drives the "Looks similar to an existing
  // classification" badge in the dropdown so users notice the auto pick
  // instead of blindly accepting "Create new".
  const [ovSuggestedMatchId, setOvSuggestedMatchId] = useState<string>("");
  const [ovSuggestedMatchName, setOvSuggestedMatchName] = useState<string>("");

  // Task #1382: confirmation step before auto-creating a brand-new job
  // classification from a DOL feed override. Task #1396 merged the choice
  // into the main override dialog's "Map to classification" selector, so
  // these states are retained only to preserve the onSuccess reset path
  // used by other callers that still reference them.
  const [, setConfirmCreateOpen] = useState(false);
  const [, setPickedExistingId] = useState<string>("");

  const { data: orgClassifications = [] } = useQuery<OrgJobClassification[]>({
    queryKey: ["/api/labor-rates/classifications"],
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/projects/${projectId}/prevailing-wage-summary/sync`, {});
      return (await res.json()) as { success: boolean; ratesImported?: number; decisionNumber?: string };
    },
    onSuccess: (res) => {
      toast({
        title: "Wage decision synced",
        description: `Imported ${res.ratesImported ?? 0} rate${res.ratesImported === 1 ? "" : "s"} for ${res.decisionNumber}.`,
      });
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Task #1409: clear the per-classification "rate changed recently"
  // badges in one shot. Optionally accepts a single classification name
  // so a future per-row dismiss button could acknowledge just one row.
  const acknowledgeRateChangesMutation = useMutation({
    mutationFn: async (classifications?: string[]) => {
      const res = await apiRequest(
        "POST",
        `/api/projects/${projectId}/prevailing-wage-summary/acknowledge-rate-changes`,
        classifications && classifications.length > 0 ? { classifications } : {},
      );
      return (await res.json()) as { acknowledged: number };
    },
    onSuccess: (res) => {
      if (res.acknowledged > 0) {
        toast({
          title: "Rate change badges cleared",
          description: `Acknowledged ${res.acknowledged} classification${res.acknowledged === 1 ? "" : "s"}.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: summaryKey });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to acknowledge rate changes", description: err.message, variant: "destructive" });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: async (opts: { classificationIdOverride?: string; confirmCreate?: boolean } = {}) => {
      if (!overrideRow) throw new Error("No row selected");
      // Task #1350 / #1382 / #1396: synthetic `dol-feed:<name>` ids have no
      // matching job_classifications row yet. The user has either picked an
      // existing org classification (we send that real id) or explicitly
      // opted in to creating a new one (we forward the synthetic id + name
      // + the `confirmCreateClassification` flag so the server is allowed
      // to insert a new row). Real-id rows fall straight through. The
      // optional `dolFeedName` field is included for every DOL_FEED row so
      // the server can persist a `dol_classification_mappings` row.
      const classificationId = opts.classificationIdOverride ?? overrideRow.classificationId;
      const isSynthetic = classificationId.startsWith("dol-feed:");
      // For DOL_FEED rows the feed name is the one reported by the
      // summary endpoint; fall back to the display name for older payloads.
      const feedName = overrideRow.source === "DOL_FEED"
        ? (overrideRow.dolFeedName ?? overrideRow.classificationName)
        : null;
      return await apiRequest("POST", "/api/labor-rates/prevailing-wage-rates", {
        projectId,
        classificationId,
        ...(isSynthetic ? { classificationName: overrideRow.classificationName } : {}),
        ...(isSynthetic && opts.confirmCreate ? { confirmCreateClassification: true } : {}),
        ...(feedName ? { dolFeedName: feedName } : {}),
        wageRate: ovWageRate,
        fringeRate: ovFringeRate || "0",
        fringeHealthRate: "0",
        fringePensionRate: "0",
        fringeVacationRate: "0",
        fringeTrainingRate: "0",
        overtimeMultiplier: ovOtMultiplier || "1.5",
        effectiveDate: ovEffectiveDate,
        expirationDate: ovExpirationDate || null,
        wageDecision: overrideRow.wageDecision || null,
        notes: ovNotes.trim() || null,
      });
    },
    onSuccess: () => {
      toast({ title: "Project override saved", description: "DOL feed rate promoted to a project-specific override." });
      queryClient.invalidateQueries({ queryKey: summaryKey });
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/classifications"] });
      setOverrideOpen(false);
      setOverrideRow(null);
      setConfirmCreateOpen(false);
      setPickedExistingId("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save override", description: err.message, variant: "destructive" });
    },
  });

  const openOverrideDialog = (c: PrevailingWageClassification) => {
    setOverrideRow(c);
    setOvWageRate(c.wageRate.toFixed(2));
    setOvFringeRate(c.fringeRate != null ? c.fringeRate.toFixed(2) : "0");
    setOvOtMultiplier(c.overtimeMultiplier || "1.5");
    setOvEffectiveDate(c.effectiveDate || new Date().toISOString().split("T")[0]);
    setOvExpirationDate(c.expirationDate || "");
    setOvNotes("");
    // Task #1396: pre-select the current (auto-matched) classification when
    // the DOL feed row is already mapped to an existing org row; otherwise
    // default to "Create new" so the user sees what will happen by default.
    const isSynthetic = c.classificationId.startsWith("dol-feed:");
    // Task #1398: when the row is a synthetic DOL feed entry, look for a
    // near-match in the existing org classifications so we can pre-select
    // it (and visually flag it) instead of dropping the user on
    // "Create new". Below-threshold names still default to "Create new".
    let suggestedId = "";
    let suggestedName = "";
    if (isSynthetic) {
      const feedName = c.dolFeedName ?? c.classificationName;
      // Task #1437: a remembered mapping from a sibling project always
      // wins over the live fuzzy heuristic — once the user has explicitly
      // chosen a target for this feed name on any project in the org with
      // the same wage decision, we trust that pick instead of guessing.
      const remembered = c.rememberedClassificationId
        ? orgClassifications.find((o) => o.id === c.rememberedClassificationId)
        : null;
      if (remembered) {
        suggestedId = remembered.id;
        suggestedName = remembered.name;
      } else {
        const match = findBestClassificationMatch(feedName, orgClassifications);
        if (match) {
          suggestedId = match.id;
          suggestedName = match.name;
        }
      }
    }
    setOvSuggestedMatchId(suggestedId);
    setOvSuggestedMatchName(suggestedName);
    setOvMappingChoice(
      isSynthetic
        ? (suggestedId || CREATE_NEW_SENTINEL)
        : c.classificationId,
    );
    setOverrideOpen(true);
  };

  // Task #1398: orgClassifications is loaded asynchronously, so the user
  // may open the override dialog before the list has arrived (or while a
  // refetch is in flight). When the list later resolves, recompute the
  // near-match suggestion so the dialog still pre-selects the right
  // existing classification instead of stranding the user on
  // "Create new".
  useEffect(() => {
    if (!overrideOpen || !overrideRow) return;
    if (!overrideRow.classificationId.startsWith("dol-feed:")) return;
    const feedName = overrideRow.dolFeedName ?? overrideRow.classificationName;
    // Task #1437: a remembered sibling-project mapping wins over the
    // fuzzy heuristic when the org classifications list resolves after
    // the dialog opened, mirroring the priority used in
    // openOverrideDialog.
    const remembered = overrideRow.rememberedClassificationId
      ? orgClassifications.find((o) => o.id === overrideRow.rememberedClassificationId)
      : null;
    const match = remembered
      ? { id: remembered.id, name: remembered.name }
      : findBestClassificationMatch(feedName, orgClassifications);
    const nextId = match?.id ?? "";
    const nextName = match?.name ?? "";
    if (nextId !== ovSuggestedMatchId) setOvSuggestedMatchId(nextId);
    if (nextName !== ovSuggestedMatchName) setOvSuggestedMatchName(nextName);
    // Only auto-promote the suggestion if the user has not yet picked an
    // existing classification — i.e. they are still sitting on the
    // default "Create new" sentinel. Don't override an explicit choice.
    if (nextId && ovMappingChoice === CREATE_NEW_SENTINEL) {
      setOvMappingChoice(nextId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrideOpen, overrideRow, orgClassifications]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" /> Prevailing Wage Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const showMissingWarning =
    !!data.wageDecision && data.wageDecisionCached === false;
  // Task #1332: show a dedicated failure banner when the most recent
  // attempt errored. Distinct from the generic "not yet imported" warning
  // so users see *why* their automatic sync didn't take and can retry.
  const showFailureBanner =
    !!data.wageDecision && !!data.wageDecisionLastError;
  const lastSyncDisplay = formatRelativeTimestamp(data.wageDecisionLastSyncAt);
  const lastAttemptDisplay = formatRelativeTimestamp(data.wageDecisionLastAttemptAt);
  // Task #1367: derive retry state for the failure banner.
  // - retryPending: a future auto-retry is scheduled, so the banner should
  //   reassure the user that the system will keep trying.
  // - retryExhausted: the chain is done, so the banner should escalate to
  //   "manual action required" (different visual treatment).
  const nextRetryDisplay = formatRelativeTimestamp(data.wageDecisionNextRetryAt);
  const retryPending =
    showFailureBanner &&
    !data.wageDecisionRetryExhausted &&
    !!data.wageDecisionNextRetryAt &&
    new Date(data.wageDecisionNextRetryAt).getTime() > Date.now();
  const retryExhausted = showFailureBanner && data.wageDecisionRetryExhausted === true;
  // Attempt N of M — retryCount is "failures so far"; the *next* attempt
  // number is retryCount + 1, capped at maxRetries.
  const maxRetries = data.wageDecisionMaxRetries ?? 0;
  const nextAttemptNumber = Math.min((data.wageDecisionRetryCount ?? 0) + 1, maxRetries || 1);

  // Task #1339: compute "stale" from the server-provided threshold so PMs
  // can tell at a glance whether the cached rates are fresh enough to trust.
  const staleAfterDays =
    typeof data.wageDecisionStaleAfterDays === "number" && data.wageDecisionStaleAfterDays > 0
      ? data.wageDecisionStaleAfterDays
      : 30;
  const lastSyncMs = data.wageDecisionLastSyncAt ? new Date(data.wageDecisionLastSyncAt).getTime() : NaN;
  const isStale =
    data.wageDecisionCached === true &&
    Number.isFinite(lastSyncMs) &&
    Date.now() - lastSyncMs > staleAfterDays * 24 * 60 * 60 * 1000;
  const ratesCached =
    typeof data.wageDecisionRatesCached === "number" ? data.wageDecisionRatesCached : null;

  const overrideCount = data.classifications.filter(c => c.source === "PROJECT_OVERRIDE").length;
  const dolCount = data.classifications.filter(c => c.source === "DOL_FEED").length;

  // Task #1409: derive the panel-level "rates changed recently" banner
  // state. We trust the per-row `recentRateChange` payload as the source
  // of truth (it survives stale cache invalidation across renders) and
  // fall back to the aggregate count for the unusual case where the
  // server omits per-row data.
  const rowsWithRecentChange = data.classifications.filter(c => c.recentRateChange);
  const recentChangeCount =
    rowsWithRecentChange.length || (data.wageDecisionRecentChangeCount ?? 0);
  const recentChangeAtDisplay = formatRelativeTimestamp(
    data.wageDecisionRecentChangeAt
      ?? rowsWithRecentChange.reduce<string | null>((acc, c) => {
        const t = c.recentRateChange?.detectedAt ?? null;
        if (!t) return acc;
        return acc && acc > t ? acc : t;
      }, null),
  );

  const totalForOverride =
    (parseFloat(ovWageRate || "0") + parseFloat(ovFringeRate || "0")).toFixed(2);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" /> Prevailing Wage Rates
        </CardTitle>
        <CardDescription>
          Source for each classification's rate. Project overrides take precedence over the cached DOL Davis-Bacon feed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.wageDecision && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Project wage decision:</span>
            <span className="font-mono font-medium" data-testid="text-project-wage-decision">
              {data.wageDecision}
            </span>
            {data.wageDecisionCached === true && (
              <Badge variant="outline" className="text-xs" data-testid="badge-decision-cached">
                Cached from DOL
              </Badge>
            )}
            {data.wageDecisionCached === true && ratesCached != null && (
              <span className="text-xs text-muted-foreground" data-testid="text-wage-decision-rates-cached">
                {ratesCached} rate{ratesCached === 1 ? "" : "s"} cached
              </span>
            )}
            {lastSyncDisplay && (
              <span className="text-xs text-muted-foreground" data-testid="text-wage-decision-last-sync">
                Last synced {lastSyncDisplay}
              </span>
            )}
            {isStale && (
              <Badge
                variant="outline"
                className="text-xs border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300"
                data-testid="badge-decision-stale"
                title={`Last synced more than ${staleAfterDays} day${staleAfterDays === 1 ? "" : "s"} ago`}
              >
                Stale
              </Badge>
            )}
            {data.wageDecisionCached === true && !showFailureBanner && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-resync-wage-decision"
              >
                {syncMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Re-syncing...</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1" /> Re-sync</>
                )}
              </Button>
            )}
          </div>
        )}

        {showFailureBanner && (
          <div
            className={
              retryPending
                ? "flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg"
                : "flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
            }
            data-testid={
              retryExhausted
                ? "banner-wage-decision-retry-exhausted"
                : retryPending
                  ? "banner-wage-decision-retry-pending"
                  : "banner-wage-decision-sync-failed"
            }
          >
            <AlertTriangle
              className={
                retryPending
                  ? "w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5"
                  : "w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
              }
            />
            <div
              className={
                retryPending
                  ? "flex-1 text-sm text-amber-800 dark:text-amber-200"
                  : "flex-1 text-sm text-red-700 dark:text-red-300"
              }
            >
              <p className="font-medium">
                {retryExhausted
                  ? "Davis-Bacon auto-retry exhausted - manual action required"
                  : retryPending
                    ? "Davis-Bacon auto-sync retrying in background"
                    : "Davis-Bacon auto-sync failed"}
              </p>
              <p className="mt-1">
                The last attempt to sync <span className="font-mono">{data.wageDecision}</span>
                {lastAttemptDisplay ? <> at <span className="font-medium">{lastAttemptDisplay}</span></> : null} returned an error:
              </p>
              <p
                className="mt-1 font-mono text-xs whitespace-pre-wrap break-words"
                data-testid="text-wage-decision-sync-error"
              >
                {data.wageDecisionLastError}
              </p>
              {retryPending && nextRetryDisplay && (
                <p
                  className="mt-2"
                  data-testid="text-wage-decision-next-retry"
                >
                  Next auto-retry at <span className="font-medium">{nextRetryDisplay}</span>
                  {maxRetries > 0 && (
                    <> (attempt {nextAttemptNumber} of {maxRetries})</>
                  )}
                  . You don't need to do anything &mdash; we'll keep trying automatically.
                </p>
              )}
              {retryExhausted && (
                <p
                  className="mt-2 font-medium"
                  data-testid="text-wage-decision-retry-exhausted"
                >
                  We've exhausted all {maxRetries || data.wageDecisionRetryCount} automatic retry attempts. Please run a manual sync below.
                </p>
              )}
              <div className="mt-2">
                <Button
                  size="sm"
                  variant={retryExhausted ? "default" : "outline"}
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  data-testid="button-retry-wage-decision-sync"
                >
                  {syncMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Retrying...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> {retryExhausted ? "Retry sync now" : "Retry sync"}</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Task #1409: panel-level "rates changed recently" banner. Shows
            when the most recent Davis-Bacon stale-refresh changed cached
            rates for one or more classifications on this project's wage
            decision. Pairs with per-row badges below. The PM clears it
            via the Acknowledge button — or it auto-clears when a
            subsequent refresh produces no further diff. */}
        {recentChangeCount > 0 && (
          <div
            className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg"
            data-testid="banner-wage-decision-rates-changed"
          >
            <Bell className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium">
                Davis-Bacon rates changed recently
              </p>
              <p className="mt-1">
                The latest auto-refresh updated{" "}
                <span className="font-medium" data-testid="text-recent-rate-change-count">
                  {recentChangeCount} classification{recentChangeCount === 1 ? "" : "s"}
                </span>
                {recentChangeAtDisplay ? (
                  <> on <span className="font-medium" data-testid="text-recent-rate-change-at">{recentChangeAtDisplay}</span></>
                ) : null}
                . Review certified payrolls and pay items before your next submission.
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => acknowledgeRateChangesMutation.mutate(undefined)}
                  disabled={acknowledgeRateChangesMutation.isPending}
                  data-testid="button-acknowledge-rate-changes"
                >
                  {acknowledgeRateChangesMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Acknowledging...</>
                  ) : (
                    <><BellOff className="w-4 h-4 mr-2" /> Acknowledge changes</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {showMissingWarning && !showFailureBanner && (
          <div
            className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
            data-testid="banner-missing-wage-decision"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-sm text-red-700 dark:text-red-300">
              <p className="font-medium">
                Wage decision not yet imported from DOL
              </p>
              <p className="mt-1">
                <span className="font-mono">{data.wageDecision}</span> is referenced by this project but has not been
                synced. Run a Davis-Bacon sync so prevailing wage rates are applied automatically.
              </p>
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  data-testid="button-sync-wage-decision"
                >
                  {syncMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Syncing...</>
                  ) : (
                    <><RefreshCw className="w-4 h-4 mr-2" /> Sync from DOL</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {data.classifications.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-no-pw-rates">
            No prevailing wage classifications resolved for this project.
            {data.wageDecision
              ? " Add project overrides or sync the wage decision from DOL."
              : " Set a wage decision on the project or add project-specific overrides."}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span data-testid="text-count-project-override">{overrideCount} project override{overrideCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span data-testid="text-count-dol-feed">{dolCount} from DOL feed</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Wage Rate</TableHead>
                    <TableHead className="text-right">Fringe</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right w-[140px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.classifications.map((c) => (
                    <TableRow key={c.classificationId} data-testid={`row-pw-classification-${c.classificationId}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <span>{c.classificationName}</span>
                          {/* Task #1409: per-row badge highlighting a
                              classification whose rate shifted in the
                              latest Davis-Bacon stale-refresh diff. The
                              detection date is also exposed via title
                              so PMs can hover to see exactly when the
                              change landed. */}
                          {c.recentRateChange && (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-300"
                              data-testid={`badge-rate-changed-${c.classificationId}`}
                              title={
                                c.recentRateChange.detectedAt
                                  ? `Rate ${c.recentRateChange.changeKind} on ${new Date(c.recentRateChange.detectedAt).toLocaleString()}`
                                  : `Rate ${c.recentRateChange.changeKind} on most recent refresh`
                              }
                            >
                              {c.recentRateChange.detectedAt
                                ? `Rate changed on ${new Date(c.recentRateChange.detectedAt).toLocaleDateString()}`
                                : "Rate changed recently"}
                            </Badge>
                          )}
                        </div>
                        {c.source === "DOL_FEED" && (
                          c.classificationId.startsWith("dol-feed:") ? (
                            <div className="text-[10px] text-muted-foreground mt-0.5" data-testid={`text-pw-mapping-${c.classificationId}`}>
                              New classification will be created
                            </div>
                          ) : (
                            <div className="text-[10px] text-muted-foreground mt-0.5" data-testid={`text-pw-mapping-${c.classificationId}`}>
                              Mapped to <span className="font-medium text-foreground">{c.classificationName}</span>
                            </div>
                          )
                        )}
                        {c.wageDecision && c.source === "DOL_FEED" && (
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5" data-testid={`text-pw-decision-${c.classificationId}`}>
                            {c.wageDecision}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={c.source} />
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-pw-wage-rate-${c.classificationId}`}>
                        {formatCurrency(c.wageRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {c.fringeRate != null ? formatCurrency(c.fringeRate) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {c.totalRate != null ? formatCurrency(c.totalRate) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.effectiveDate || "\u2014"}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.source === "DOL_FEED" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openOverrideDialog(c)}
                            data-testid={`button-promote-override-${c.classificationId}`}
                          >
                            <Plus className="w-3.5 h-3.5 mr-1" /> Override
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

        <SavedDolMappingsSection
          projectId={projectId}
          orgClassifications={orgClassifications}
          onMappingsChanged={() => {
            queryClient.invalidateQueries({ queryKey: summaryKey });
            queryClient.invalidateQueries({ queryKey: ["/api/labor-rates/prevailing-wage-rates"] });
          }}
          unmappedDolFeedNames={data.unmappedDolFeedNames ?? []}
          unmappedDolFeedCount={data.unmappedDolFeedCount ?? null}
          onJumpToUnmapped={(classificationId) => {
            // Task #1444: scroll the unmapped synthetic dol-feed row into
            // view and apply a brief highlight ring so PMs can spot the
            // row they jumped to. Falls back silently if the row isn't
            // currently rendered (e.g. the rates table collapsed).
            const sel = `[data-testid="row-pw-classification-${CSS.escape(classificationId)}"]`;
            const el = document.querySelector<HTMLElement>(sel);
            if (!el) return;
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add(
              "ring-2",
              "ring-amber-400",
              "ring-offset-2",
              "transition-shadow",
            );
            window.setTimeout(() => {
              el.classList.remove(
                "ring-2",
                "ring-amber-400",
                "ring-offset-2",
                "transition-shadow",
              );
            }, 2000);
          }}
        />
      </CardContent>

      <Dialog open={overrideOpen} onOpenChange={(o) => { setOverrideOpen(o); if (!o) setOverrideRow(null); }}>
        <DialogContent data-testid="dialog-promote-override">
          <DialogHeader>
            <DialogTitle>Promote DOL rate to project override</DialogTitle>
            <DialogDescription>
              Pre-filled from the cached DOL feed for{" "}
              <span className="font-medium">{overrideRow?.classificationName}</span>
              {overrideRow?.wageDecision ? (
                <> (<span className="font-mono">{overrideRow.wageDecision}</span>)</>
              ) : null}
              . Changes here only affect this project.
            </DialogDescription>
          </DialogHeader>
          {overrideRow && overrideRow.classificationId.startsWith("dol-feed:") ? (
            <div className="space-y-1" data-testid="field-override-mapping">
              <Label htmlFor="ov-mapping">Map to classification</Label>
              <Select value={ovMappingChoice} onValueChange={setOvMappingChoice}>
                <SelectTrigger id="ov-mapping" data-testid="select-override-mapping">
                  <SelectValue placeholder="Select a classification..." />
                </SelectTrigger>
                <SelectContent>
                  {orgClassifications.map((c) => (
                    <SelectItem
                      key={c.id}
                      value={c.id}
                      data-testid={`option-override-mapping-${c.id}`}
                    >
                      <span className="inline-flex items-center gap-2">
                        {c.name}
                        {c.id === ovSuggestedMatchId ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-sm bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 px-1.5 py-0.5 text-[10px] font-medium"
                            data-testid={`badge-override-mapping-similar-${c.id}`}
                          >
                            <Sparkles className="w-3 h-3" /> Looks similar
                          </span>
                        ) : null}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem
                    value={CREATE_NEW_SENTINEL}
                    data-testid="option-override-mapping-create-new"
                  >
                    Create new: {overrideRow.dolFeedName ?? overrideRow.classificationName}
                  </SelectItem>
                </SelectContent>
              </Select>
              {ovSuggestedMatchId ? (
                <p
                  className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1"
                  data-testid="text-override-mapping-similar"
                >
                  <Sparkles className="w-3 h-3 mt-0.5 shrink-0" />
                  <span>
                    Looks similar to an existing classification:{" "}
                    <span className="font-medium">{ovSuggestedMatchName}</span>. Pre-selected to
                    prevent accidental duplicates.
                  </span>
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground" data-testid="text-override-mapping-hint">
                {ovMappingChoice === CREATE_NEW_SENTINEL ? (
                  <>
                    A new classification named{" "}
                    <span className="font-medium text-foreground">
                      {overrideRow.dolFeedName ?? overrideRow.classificationName}
                    </span>{" "}
                    will be created. Future syncs will reuse this mapping.
                  </>
                ) : (
                  <>
                    Future syncs of this wage decision will map the DOL feed row{" "}
                    <span className="font-medium text-foreground">
                      {overrideRow.dolFeedName ?? overrideRow.classificationName}
                    </span>{" "}
                    to the selected classification.
                  </>
                )}
              </p>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ov-wage">Wage rate *</Label>
              <Input
                id="ov-wage"
                type="number"
                step="0.01"
                value={ovWageRate}
                onChange={(e) => setOvWageRate(e.target.value)}
                data-testid="input-override-wage-rate"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-fringe">Fringe rate</Label>
              <Input
                id="ov-fringe"
                type="number"
                step="0.01"
                value={ovFringeRate}
                onChange={(e) => setOvFringeRate(e.target.value)}
                data-testid="input-override-fringe-rate"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-ot">OT multiplier</Label>
              <Input
                id="ov-ot"
                type="number"
                step="0.1"
                value={ovOtMultiplier}
                onChange={(e) => setOvOtMultiplier(e.target.value)}
                data-testid="input-override-ot-multiplier"
              />
            </div>
            <div className="space-y-1">
              <Label>Total rate</Label>
              <div className="h-9 flex items-center px-2 rounded-md border bg-muted text-sm font-mono" data-testid="text-override-total-rate">
                ${totalForOverride}
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-effective">Effective date *</Label>
              <Input
                id="ov-effective"
                type="date"
                value={ovEffectiveDate}
                onChange={(e) => setOvEffectiveDate(e.target.value)}
                data-testid="input-override-effective-date"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ov-expiration">Expiration date</Label>
              <Input
                id="ov-expiration"
                type="date"
                value={ovExpirationDate}
                onChange={(e) => setOvExpirationDate(e.target.value)}
                data-testid="input-override-expiration-date"
              />
            </div>
            <div className="space-y-1 col-span-2">
              <Label htmlFor="ov-notes">Notes</Label>
              <Input
                id="ov-notes"
                value={ovNotes}
                onChange={(e) => setOvNotes(e.target.value)}
                placeholder="Optional"
                data-testid="input-override-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideOpen(false)} data-testid="button-cancel-override">Cancel</Button>
            <Button
              onClick={() => {
                if (!ovWageRate || !ovEffectiveDate) {
                  toast({ title: "Missing fields", description: "Wage rate and effective date are required.", variant: "destructive" });
                  return;
                }
                if (!overrideRow) return;
                // Task #1396: the user now picks the target classification
                // in the in-dialog selector. Dispatch based on that choice:
                // - CREATE_NEW_SENTINEL => forward the synthetic dol-feed id
                //   plus confirmCreateClassification so the server inserts a
                //   new job_classification row.
                // - Any other value => treat as an explicit existing
                //   classification id (the happy path for re-mapping
                //   "Carpenter (Group 1)" onto an existing "Carpenter").
                if (!ovMappingChoice) {
                  toast({ title: "Select a classification", description: "Pick a classification to map this DOL feed row to.", variant: "destructive" });
                  return;
                }
                if (ovMappingChoice === CREATE_NEW_SENTINEL) {
                  overrideMutation.mutate({ confirmCreate: true });
                  return;
                }
                overrideMutation.mutate({ classificationIdOverride: ovMappingChoice });
              }}
              disabled={overrideMutation.isPending}
              data-testid="button-save-override"
            >
              {overrideMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                "Save override"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </Card>
  );
}

export default function ProjectPayrollTab({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useQuery<ProjectPayrollSummary>({
    queryKey: ["/api/projects", projectId, "payroll-summary"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-8 text-muted-foreground">No payroll data available</div>;
  }

  const budgetUsedPercent = summary.laborVsBudget;
  const budgetBarColor = budgetUsedPercent > 90 ? "bg-red-500" : budgetUsedPercent > 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor Cost to Date</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-cost">{formatCurrency(summary.laborCostToDate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor vs Budget</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-budget">
              {summary.budget > 0 ? `${budgetUsedPercent.toFixed(1)}%` : "N/A"}
            </p>
            {summary.budget > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                <div className={`${budgetBarColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overtime %</p>
            <p className="text-2xl font-bold" data-testid="text-project-overtime-pct">{summary.overtimePercent}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalOvertimeHours.toFixed(1)} OT / {(summary.totalRegularHours + summary.totalOvertimeHours).toFixed(1)} total hrs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Workers Assigned</p>
            <p className="text-2xl font-bold" data-testid="text-project-workers">{summary.workers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.totalEntries} time entries</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Workers on This Project</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.workers.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground">No workers have logged time on this project</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Regular Hours</TableHead>
                  <TableHead>OT Hours</TableHead>
                  <TableHead>Total Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.workers.map(w => (
                  <TableRow key={w.userId} data-testid={`row-project-worker-${w.userId}`}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{w.role}</Badge>
                    </TableCell>
                    <TableCell>{w.regularHours.toFixed(1)}</TableCell>
                    <TableCell>{w.overtimeHours > 0 ? w.overtimeHours.toFixed(1) : "\u2014"}</TableCell>
                    <TableCell className="font-medium">{(w.regularHours + w.overtimeHours).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PrevailingWagePanel projectId={projectId} />
    </div>
  );
}
