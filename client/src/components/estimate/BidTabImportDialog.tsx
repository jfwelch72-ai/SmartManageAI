import { useState, useMemo, useCallback, useRef } from "react";
import { parseFile, type ParsedRow } from "@/lib/bidTabParser";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { apiRequest, queryClient, bidEstimateKey } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useFeatureFlags } from "@/hooks/use-feature-flags";
import { PayItemMatchReasonChips } from "@/components/dot/PayItemMatchReasonChips";
import { PayItemMatchExplain } from "@/components/dot/PayItemMatchExplain";

interface BidTabImportDialogProps {
  estimateId: string;
  bidId?: string;
  defaultCategory?: string;
  /** Called after a successful import so callers can update their revision counter. */
  onLineItemsChanged?: () => void;
}

interface MatchSuggestion {
  payItem: {
    id: string;
    itemNumber: string;
    description: string;
    unit: string;
    specSection: string | null;
    category: string | null;
  };
  agency: { id: string; code: string; name: string };
  specBook: { id: string; edition: string };
  score: number;
  matchReason: "alias" | "history" | "fuzzy";
  aliasText: string | null;
  matchedTokens: string[];
  historyAccepts?: number;
  historyRejects?: number;
  agencyAccepts?: number;
  orgAffinityAccepts?: number;
}

interface MatchResponse {
  matches: MatchSuggestion[];
}

interface ReviewRow extends ParsedRow {
  status: "pending" | "matched" | "no-match" | "error";
  topMatch: MatchSuggestion | null;
  alternates: MatchSuggestion[];
  selectedPayItemId: string | null;
  accepted: boolean;
  skipped: boolean;
  errorMessage?: string;
}

const ESTIMATE_CATEGORIES = [
  "CONCRETE", "EXCAVATION", "PAVERS", "BOLLARDS", "GC", "GENERAL",
  "PLUMBING", "HVAC", "ROOFING", "STRUCTURAL_STEEL", "MASONRY",
  "DRYWALL", "PAINTING", "FLOORING", "FIRE_PROTECTION", "DEMOLITION",
  "CARPENTRY", "INSULATION", "WINDOWS_DOORS", "ELEVATOR", "GRADING",
  "PAVING", "SITEWORK", "WATERPROOFING", "MECHANICAL", "FRAMING",
  "STRIPING", "SIGNAGE", "LANDSCAPING", "ELECTRICAL", "OTHER",
  "METALS", "FINISHES",
];

function normalizeCategory(raw: string | null | undefined, fallback: string): string {
  if (!raw) return fallback;
  const upper = raw.toUpperCase().replace(/[^A-Z]+/g, "_");
  if (ESTIMATE_CATEGORIES.includes(upper)) return upper;
  // Try common substring matches
  for (const cat of ESTIMATE_CATEGORIES) {
    if (upper.includes(cat)) return cat;
  }
  return fallback;
}

function AlternatesPopover({
  row,
  onChoose,
}: {
  row: ReviewRow;
  onChoose: (payItemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          data-testid={`button-alternates-${row.rowIndex}`}
        >
          {row.alternates.length} other
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[28rem] p-0"
        data-testid={`popover-alternates-${row.rowIndex}`}
      >
        <div className="px-3 py-2 border-b">
          <div className="text-xs font-medium">Alternate suggestions</div>
          <div className="text-[11px] text-muted-foreground">
            Hover an item to see why it was suggested. Click to use it instead.
          </div>
        </div>
        <ScrollArea className="max-h-80">
          <div className="p-2 space-y-1">
            {row.alternates.map((a) => (
              <HoverCard key={a.payItem.id} openDelay={120} closeDelay={80}>
                <HoverCardTrigger asChild>
                  <button
                    type="button"
                    onClick={() => {
                      onChoose(a.payItem.id);
                      setOpen(false);
                    }}
                    className="w-full text-left rounded p-2 hover-elevate active-elevate-2 focus:outline-none focus:ring-1 focus:ring-ring"
                    data-testid={`button-alternate-${row.rowIndex}-${a.payItem.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {a.payItem.itemNumber}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {a.payItem.unit}
                      </Badge>
                      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                        {(a.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                      {a.payItem.description}
                    </div>
                    <div className="mt-1">
                      <PayItemMatchReasonChips
                        matchReason={a.matchReason === "history" ? "fuzzy" : a.matchReason}
                        aliasText={a.aliasText}
                        matchedTokens={a.matchedTokens}
                        payItem={a.payItem}
                        seedDescription={row.description}
                        seedUnit={row.unit || null}
                        seedCategory={null}
                        testIdPrefix={`bid-tab-alt-${row.rowIndex}-${a.payItem.id}`}
                        size="2xs"
                      />
                    </div>
                  </button>
                </HoverCardTrigger>
                <HoverCardContent
                  side="left"
                  align="start"
                  className="w-96"
                  data-testid={`hovercard-alternate-${row.rowIndex}-${a.payItem.id}`}
                >
                  <PayItemMatchExplain
                    suggestion={a}
                    seedDescription={row.description}
                    seedUnit={row.unit || null}
                    testIdPrefix={`alt-${row.rowIndex}-${a.payItem.id}`}
                  />
                </HoverCardContent>
              </HoverCard>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

async function runMatcher(row: ParsedRow): Promise<MatchSuggestion[]> {
  const res = await apiRequest("POST", "/api/dot/pay-items/match", {
    description: row.description,
    unit: row.unit || null,
    limit: 5,
  });
  const data = (await res.json()) as MatchResponse;
  return data.matches ?? [];
}

export function BidTabImportDialog({
  estimateId,
  bidId,
  defaultCategory = "OTHER",
  onLineItemsChanged,
}: BidTabImportDialogProps) {
  const { toast } = useToast();
  const { isEnabled } = useFeatureFlags();
  const dotEnabled = isEnabled("DOT_PAY_ITEMS");
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<"upload" | "matching" | "review" | "saving">(
    "upload",
  );
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [matchProgress, setMatchProgress] = useState({ done: 0, total: 0 });
  const [globalCategory, setGlobalCategory] = useState<string>(defaultCategory);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setPhase("upload");
    setRows([]);
    setParseError(null);
    setMatchProgress({ done: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const acceptedCount = useMemo(
    () => rows.filter((r) => r.accepted && r.selectedPayItemId && !r.skipped).length,
    [rows],
  );
  const matchedCount = useMemo(
    () => rows.filter((r) => r.status === "matched").length,
    [rows],
  );
  const importableCount = useMemo(
    () => rows.filter((r) => !r.skipped).length,
    [rows],
  );

  const handleFile = async (file: File) => {
    setParseError(null);
    let parsed: ParsedRow[];
    try {
      parsed = await parseFile(file);
    } catch (err) {
      setParseError(
        err instanceof Error ? err.message : "Failed to read spreadsheet file",
      );
      return;
    }
    if (parsed.length === 0) {
      setParseError(
        "No bid tab rows were found. Make sure your file has a Description column and at least one data row.",
      );
      return;
    }
    setPhase("matching");
    setMatchProgress({ done: 0, total: parsed.length });

    const initial: ReviewRow[] = parsed.map((r) => ({
      ...r,
      status: "pending",
      topMatch: null,
      alternates: [],
      selectedPayItemId: null,
      accepted: false,
      skipped: false,
    }));
    setRows(initial);

    const concurrency = 4;
    const results: ReviewRow[] = [...initial];
    let done = 0;
    const queue = [...parsed];

    async function worker() {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) return;
        try {
          const matches = await runMatcher(next);
          const top = matches[0] ?? null;
          results[next.rowIndex] = {
            ...results[next.rowIndex],
            status: top ? "matched" : "no-match",
            topMatch: top,
            alternates: matches.slice(1),
            selectedPayItemId: top?.payItem.id ?? null,
            accepted: !!top && top.score >= 0.5,
          };
        } catch (err) {
          results[next.rowIndex] = {
            ...results[next.rowIndex],
            status: "error",
            errorMessage:
              err instanceof Error ? err.message : "Matcher request failed",
          };
        } finally {
          done++;
          setMatchProgress({ done, total: parsed.length });
          setRows([...results]);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, parsed.length) }, () => worker()),
    );
    setPhase("review");
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  };

  const toggleAccept = (rowIndex: number, accepted: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, accepted } : r)),
    );
  };

  const toggleSkip = (rowIndex: number, skipped: boolean) => {
    setRows((prev) =>
      prev.map((r) => (r.rowIndex === rowIndex ? { ...r, skipped } : r)),
    );
  };

  const acceptAllMatched = () => {
    setRows((prev) =>
      prev.map((r) =>
        r.status === "matched" && r.selectedPayItemId && !r.skipped
          ? { ...r, accepted: true }
          : r,
      ),
    );
  };

  const rejectAll = () => {
    setRows((prev) => prev.map((r) => ({ ...r, accepted: false })));
  };

  const swapToAlternate = (rowIndex: number, payItemId: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rowIndex !== rowIndex) return r;
        const all = [r.topMatch, ...r.alternates].filter(
          (m): m is MatchSuggestion => !!m,
        );
        const chosen = all.find((m) => m.payItem.id === payItemId);
        if (!chosen) return r;
        const remaining = all.filter((m) => m.payItem.id !== payItemId);
        return {
          ...r,
          topMatch: chosen,
          alternates: remaining,
          selectedPayItemId: chosen.payItem.id,
        };
      }),
    );
  };

  const handleImport = async () => {
    const toImport = rows.filter((r) => !r.skipped);
    if (toImport.length === 0) {
      toast({
        title: "Nothing to import",
        description: "Every row is marked as skipped — uncheck Skip on at least one row.",
        variant: "destructive",
      });
      return;
    }
    setPhase("saving");
    let withDot = 0;
    const payloads = toImport.map((r) => {
      const useDot = r.accepted && r.selectedPayItemId && r.topMatch;
      const match = useDot ? r.topMatch! : null;
      const category = normalizeCategory(match?.payItem.category ?? null, globalCategory);
      const payload: Record<string, unknown> = {
        category,
        description: r.description,
        quantity: r.quantity,
        unit: (match?.payItem.unit || r.unit || "EA"),
        materialCost: 0,
        laborCost: 0,
        laborHours: 0,
        equipmentCost: 0,
        equipmentHours: 0,
        consumablesCost: 0,
        subcontractCost: 0,
        overheadAllocation: 0,
        profitAllocation: 0,
      };
      if (match) {
        payload.dotPayItemId = match.payItem.id;
        payload.dotSpecBookId = match.specBook.id;
        payload.payItemNumber = match.payItem.itemNumber;
        payload.specSection = match.payItem.specSection ?? null;
        withDot++;
      }
      return payload;
    });

    try {
      await apiRequest(
        "POST",
        `/api/estimates/${estimateId}/line-items/bulk`,
        { lineItems: payloads },
      );
      // Task #1164 — record accept/reject decisions for any row that received a
      // top suggestion, so future imports can boost frequently-used items. We
      // only record decisions for rows where the matcher actually had something
      // to suggest (skipped/no-match rows have nothing to learn from).
      const decisions = rows
        .filter((r) => !r.skipped && r.topMatch)
        .map((r) => ({
          description: r.description,
          payItemId: r.topMatch!.payItem.id,
          agencyId: r.topMatch!.agency.id,
          accepted: r.accepted,
        }));
      let feedbackBatchId: string | null = null;
      let feedbackRecorded = 0;
      if (decisions.length > 0) {
        try {
          const fbRes = await apiRequest("POST", "/api/dot/pay-items/match/feedback", { decisions });
          const fbData = (await fbRes.json().catch(() => null)) as
            | { recorded?: number; batchId?: string | null }
            | null;
          feedbackBatchId = fbData?.batchId ?? null;
          feedbackRecorded = fbData?.recorded ?? 0;
          queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/top"] });
          queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/recent"] });
        } catch {
          // Recording feedback is best-effort; never block the import on it.
        }
      }
      if (bidId) {
        await queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
      } else {
        await queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
      }
      onLineItemsChanged?.();
      toast({
        title: "Bid tab imported",
        description: `${payloads.length} line item(s) added — ${withDot} with DOT pay item links, ${payloads.length - withDot} without.`,
      });
      // Task #1247 — separate, undoable toast covers the silent learning step.
      // We surface it as a second toast (not the import description) so the
      // Undo action only affects the learning rows, never the imported lines.
      if (feedbackBatchId && feedbackRecorded > 0) {
        const undoBatchId = feedbackBatchId;
        toast({
          title: "Remembered pay-item choices",
          description: `Saved ${feedbackRecorded} match decision${feedbackRecorded === 1 ? "" : "s"} to improve future suggestions.`,
          action: (
            <ToastAction
              altText="Undo remembered pay-item choices"
              data-testid="button-undo-match-feedback"
              onClick={async () => {
                try {
                  await apiRequest(
                    "DELETE",
                    `/api/dot/pay-items/match/feedback/batch/${encodeURIComponent(undoBatchId)}`,
                  );
                  queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/top"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/dot/pay-items/match-history/recent"] });
                  toast({ title: "Undone", description: "Those match decisions were removed." });
                } catch (e) {
                  toast({
                    title: "Couldn't undo",
                    description: e instanceof Error ? e.message : "Try again from the DOT Library page.",
                    variant: "destructive",
                  });
                }
              }}
            >
              Undo
            </ToastAction>
          ),
        });
      }
      handleOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "The import was rolled back — no line items were saved. Review the rows and try again.";
      toast({
        title: "Bid tab import failed",
        description: message,
        variant: "destructive",
      });
      setPhase("review");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          disabled={!dotEnabled}
          data-testid="button-open-bid-tab-import"
          title={
            dotEnabled
              ? "Import a bid tab spreadsheet and auto-suggest DOT pay items"
              : "Enable the DOT pay items feature to use bid tab import"
          }
        >
          <FileSpreadsheet className="h-4 w-4 mr-2" />
          Import Bid Tab (DOT)
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-6xl max-h-[90vh] flex flex-col"
        data-testid="dialog-bid-tab-import"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Import Bid Tab — Auto-Suggest DOT Pay Items
          </DialogTitle>
          <DialogDescription>
            Upload a CSV or Excel bid tab. We'll match each row to the closest DOT
            pay item so you can accept or reject suggestions in bulk.
          </DialogDescription>
        </DialogHeader>

        {phase === "upload" && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">
                Upload a CSV or Excel bid tab
              </p>
              <p className="text-xs text-muted-foreground mb-4">
                Required column: <span className="font-mono">Description</span>.
                Optional: Quantity, Unit, Item Number.
              </p>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx"
                onChange={onFileChange}
                className="max-w-sm mx-auto"
                data-testid="input-bid-tab-file"
              />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">
                Default line-item category (used when the matched DOT category isn't recognized):
              </span>
              <Select value={globalCategory} onValueChange={setGlobalCategory}>
                <SelectTrigger
                  className="w-48"
                  data-testid="select-default-category"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTIMATE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {parseError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription data-testid="text-bid-tab-parse-error">
                  {parseError}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {phase === "matching" && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm font-medium">
              Matching bid tab rows to DOT pay items…
            </p>
            <p
              className="text-xs text-muted-foreground"
              data-testid="text-bid-tab-match-progress"
            >
              {matchProgress.done} of {matchProgress.total}
            </p>
          </div>
        )}

        {(phase === "review" || phase === "saving") && (
          <>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="secondary" data-testid="badge-rows-total">
                  {rows.length} rows
                </Badge>
                <Badge
                  variant="outline"
                  className="text-green-700 border-green-300 dark:text-green-300 dark:border-green-800"
                  data-testid="badge-rows-matched"
                >
                  {matchedCount} matched
                </Badge>
                <Badge variant="outline" data-testid="badge-rows-accepted">
                  {acceptedCount} accepted (DOT linked)
                </Badge>
                <Badge variant="outline" data-testid="badge-rows-importable">
                  {importableCount} will import
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={acceptAllMatched}
                  disabled={phase === "saving"}
                  data-testid="button-accept-all-matched"
                >
                  Accept all matched
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={rejectAll}
                  disabled={phase === "saving"}
                  data-testid="button-reject-all"
                >
                  Reject all
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1 border rounded-md">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-12" title="Skip this row entirely (it will not be imported)">Skip</TableHead>
                    <TableHead className="w-12" title="Apply the suggested DOT pay item to this line item">Accept</TableHead>
                    <TableHead className="w-[24%]">Your row</TableHead>
                    <TableHead className="w-[7%] text-right">Qty</TableHead>
                    <TableHead className="w-[7%]">Unit</TableHead>
                    <TableHead className="w-[30%]">Suggested DOT pay item</TableHead>
                    <TableHead className="w-[8%]">Score</TableHead>
                    <TableHead className="w-[14%]">Alternates</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow
                      key={r.rowIndex}
                      data-testid={`row-bid-tab-review-${r.rowIndex}`}
                      className={
                        r.skipped
                          ? "opacity-50 bg-muted/30"
                          : r.accepted
                            ? "bg-green-50/40 dark:bg-green-900/10"
                            : ""
                      }
                    >
                      <TableCell>
                        <Checkbox
                          checked={r.skipped}
                          onCheckedChange={(v) => toggleSkip(r.rowIndex, !!v)}
                          disabled={phase === "saving"}
                          data-testid={`checkbox-skip-${r.rowIndex}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={r.accepted && !r.skipped}
                          onCheckedChange={(v) => toggleAccept(r.rowIndex, !!v)}
                          disabled={!r.selectedPayItemId || r.skipped || phase === "saving"}
                          data-testid={`checkbox-accept-${r.rowIndex}`}
                        />
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="line-clamp-2" title={r.description}>
                          {r.description}
                        </div>
                        {r.payItemNumberHint && (
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">
                            hint: {r.payItemNumberHint}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.quantity.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.unit || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.status === "pending" && (
                          <span className="text-muted-foreground italic">
                            <Loader2 className="inline h-3 w-3 animate-spin mr-1" />
                            matching…
                          </span>
                        )}
                        {r.status === "no-match" && (
                          <span
                            className="text-amber-700 dark:text-amber-400 text-xs"
                            data-testid={`text-no-match-${r.rowIndex}`}
                          >
                            No suggestion found — leave unchecked or fix manually after import
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="text-destructive text-xs">
                            {r.errorMessage ?? "Match failed"}
                          </span>
                        )}
                        {r.status === "matched" && r.topMatch && (
                          <HoverCard openDelay={120} closeDelay={80}>
                            <HoverCardTrigger asChild>
                              <button
                                type="button"
                                className="text-left w-full rounded hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring px-1 -mx-1"
                                data-testid={`button-explain-top-match-${r.rowIndex}`}
                                aria-label="Show why this pay item was suggested"
                              >
                                <div className="flex items-center gap-2">
                                  <span
                                    className="font-mono text-xs font-semibold"
                                    data-testid={`text-top-match-number-${r.rowIndex}`}
                                  >
                                    {r.topMatch.payItem.itemNumber}
                                  </span>
                                  <Badge variant="outline" className="text-[10px]">
                                    {r.topMatch.payItem.unit}
                                  </Badge>
                                  {r.topMatch.payItem.specSection && (
                                    <span className="text-[10px] text-muted-foreground">
                                      §{r.topMatch.payItem.specSection}
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="text-xs text-muted-foreground mt-0.5 line-clamp-2"
                                  data-testid={`text-top-match-desc-${r.rowIndex}`}
                                >
                                  {r.topMatch.payItem.description}
                                </div>
                                <div className="mt-1">
                                  <PayItemMatchReasonChips
                                    matchReason={r.topMatch.matchReason === "history" ? "fuzzy" : r.topMatch.matchReason}
                                    aliasText={r.topMatch.aliasText}
                                    matchedTokens={r.topMatch.matchedTokens}
                                    payItem={r.topMatch.payItem}
                                    seedDescription={r.description}
                                    seedUnit={r.unit || null}
                                    seedCategory={null}
                                    testIdPrefix={`bid-tab-${r.rowIndex}`}
                                    size="2xs"
                                  />
                                </div>
                              </button>
                            </HoverCardTrigger>
                            <HoverCardContent
                              align="start"
                              className="w-96"
                              data-testid={`hovercard-top-match-${r.rowIndex}`}
                            >
                              <PayItemMatchExplain
                                suggestion={r.topMatch}
                                seedDescription={r.description}
                                seedUnit={r.unit || null}
                                testIdPrefix={`top-${r.rowIndex}`}
                              />
                            </HoverCardContent>
                          </HoverCard>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.topMatch ? (
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2
                              className={`h-3.5 w-3.5 ${
                                r.topMatch.score >= 0.7
                                  ? "text-green-600"
                                  : r.topMatch.score >= 0.4
                                    ? "text-amber-500"
                                    : "text-muted-foreground"
                              }`}
                            />
                            <span
                              className="text-xs tabular-nums"
                              data-testid={`text-match-score-${r.rowIndex}`}
                            >
                              {(r.topMatch.score * 100).toFixed(0)}%
                            </span>
                            {r.topMatch.matchReason === "alias" && (
                              <Badge variant="secondary" className="text-[10px]" data-testid={`badge-match-reason-${r.rowIndex}`}>
                                alias
                              </Badge>
                            )}
                            {r.topMatch.matchReason === "history" && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                                title={`Your team accepted this item ${r.topMatch.historyAccepts ?? 0} time(s) for the same description`}
                                data-testid={`badge-match-reason-${r.rowIndex}`}
                              >
                                learned
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.alternates.length > 0 ? (
                          <AlternatesPopover
                            row={r}
                            onChoose={(payItemId) => swapToAlternate(r.rowIndex, payItemId)}
                          />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
            <div className="flex items-center justify-between gap-3 pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Every non-skipped row becomes a new line item. Accepted rows also
                save the DOT pay item ID, item number, unit, and spec section.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                  disabled={phase === "saving"}
                  data-testid="button-cancel-bid-tab-import"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={phase === "saving" || importableCount === 0}
                  data-testid="button-confirm-bid-tab-import"
                >
                  {phase === "saving" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    <>
                      Import {importableCount} line item{importableCount === 1 ? "" : "s"}
                      {acceptedCount > 0 ? ` (${acceptedCount} DOT linked)` : ""}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
