import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
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
import { useFeatureFlags } from "@/hooks/use-feature-flags";

interface BidTabImportDialogProps {
  estimateId: string;
  bidId?: string;
  defaultCategory?: string;
}

interface ParsedRow {
  rowIndex: number;
  description: string;
  quantity: number;
  unit: string;
  payItemNumberHint?: string | null;
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
  matchReason: "alias" | "fuzzy";
  aliasText: string | null;
  matchedTokens: string[];
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

const COLUMN_ALIASES: Record<string, string> = {
  description: "description",
  desc: "description",
  item: "description",
  "item description": "description",
  "pay item description": "description",
  "work description": "description",
  quantity: "quantity",
  qty: "quantity",
  "estimated quantity": "quantity",
  unit: "unit",
  uom: "unit",
  "unit of measure": "unit",
  "pay item": "payItemNumber",
  "item number": "payItemNumber",
  "item no": "payItemNumber",
  "item #": "payItemNumber",
};

function detectColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((h, idx) => {
    const norm = (h ?? "").toString().trim().toLowerCase();
    const key = COLUMN_ALIASES[norm];
    if (key && map[key] === undefined) map[key] = idx;
  });
  return map;
}

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

async function parseFile(file: File): Promise<ParsedRow[]> {
  const isCsv =
    file.name.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/csv";

  let rows: any[][] = [];

  if (isCsv) {
    const text = await file.text();
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    rows = result.data as string[][];
  } else {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return [];
    const ws = wb.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });
  }

  if (rows.length === 0) return [];

  // Find the header row — first row (within the first 10) that has a recognizable column
  let headerRowIdx: number | null = null;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const headers = (rows[i] ?? []).map((c) =>
      (c ?? "").toString().trim().toLowerCase(),
    );
    if (headers.some((h) => COLUMN_ALIASES[h] === "description")) {
      headerRowIdx = i;
      break;
    }
  }
  const headers =
    headerRowIdx !== null
      ? (rows[headerRowIdx] ?? []).map((c) => (c ?? "").toString())
      : [];
  const cols = detectColumns(headers);

  if (headerRowIdx === null) {
    // No header detected — assume first column is description, parse from row 0
    cols.description = 0;
    const widestRow = rows.reduce(
      (max, r) => Math.max(max, (r ?? []).length),
      0,
    );
    if (cols.quantity === undefined && widestRow > 1) cols.quantity = 1;
    if (cols.unit === undefined && widestRow > 2) cols.unit = 2;
  }

  const startRow = headerRowIdx === null ? 0 : headerRowIdx + 1;
  const out: ParsedRow[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const description = (row[cols.description] ?? "").toString().trim();
    if (!description) continue;
    const qtyRaw = cols.quantity !== undefined ? (row[cols.quantity] ?? "") : "";
    const qty = parseFloat(qtyRaw.toString().replace(/,/g, ""));
    const unit = cols.unit !== undefined ? (row[cols.unit] ?? "").toString().trim() : "";
    const payItemHint =
      cols.payItemNumber !== undefined
        ? (row[cols.payItemNumber] ?? "").toString().trim()
        : "";
    out.push({
      rowIndex: out.length,
      description,
      quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
      unit,
      payItemNumberHint: payItemHint || null,
    });
  }
  return out;
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
    let succeeded = 0;
    let withDot = 0;
    let failed = 0;
    for (const r of toImport) {
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
      }
      try {
        await apiRequest("POST", `/api/estimates/${estimateId}/line-items`, payload);
        succeeded++;
        if (match) withDot++;
      } catch (err) {
        failed++;
      }
    }
    if (bidId) {
      await queryClient.invalidateQueries({ queryKey: bidEstimateKey(bidId) });
    } else {
      await queryClient.invalidateQueries({ queryKey: ["/api/estimates", estimateId] });
    }
    toast({
      title: failed === 0 ? "Bid tab imported" : "Bid tab import finished with errors",
      description:
        failed === 0
          ? `${succeeded} line item(s) added — ${withDot} with DOT pay item links, ${succeeded - withDot} without.`
          : `${succeeded} added (${withDot} with DOT links), ${failed} failed. Review and retry the failed rows.`,
      variant: failed === 0 ? "default" : "destructive",
    });
    if (failed === 0) {
      handleOpenChange(false);
    } else {
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
                          <div>
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
                          </div>
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
                              <Badge variant="secondary" className="text-[10px]">
                                alias
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.alternates.length > 0 ? (
                          <Select
                            onValueChange={(v) => swapToAlternate(r.rowIndex, v)}
                          >
                            <SelectTrigger
                              className="h-8 text-xs"
                              data-testid={`select-alternate-${r.rowIndex}`}
                            >
                              <SelectValue placeholder={`${r.alternates.length} other`} />
                            </SelectTrigger>
                            <SelectContent>
                              {r.alternates.map((a) => (
                                <SelectItem key={a.payItem.id} value={a.payItem.id}>
                                  <span className="font-mono">{a.payItem.itemNumber}</span>{" "}
                                  · {(a.score * 100).toFixed(0)}% ·{" "}
                                  <span className="text-muted-foreground">
                                    {a.payItem.description.slice(0, 40)}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
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
