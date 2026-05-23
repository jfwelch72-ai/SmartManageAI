import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Sparkles, Check, ChevronDown, ChevronRight, ExternalLink, FileText, FileSpreadsheet, Image, FileQuestion, ClipboardList } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { pollJobUntilDone } from "@/lib/jobs";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

interface DraftLine {
  description: string;
  costCode: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  laborHours: number | null;
  totalCost: number;
  rationale: string;
  citationIds: string[];
  /** Task #3036 — V2.0 per-line confidence rating from Phase 5 CSI output. */
  confidence?: "HIGH" | "MEDIUM" | "LOW";
}

interface SkillApplied {
  id: string;
  name: string;
  scope: string;
  scopeValue: string | null;
}

interface ReadFileRef {
  fileName: string;
  fileType: "pdf_plan" | "pdf_spec" | "spreadsheet" | "image" | "other";
  source: "bid_document" | "plan_document" | "quote_document";
}

interface DraftResult {
  lines: DraftLine[];
  notes: string;
  confidence: number;
  citations?: Array<{ id: string; sourceType: string; title: string }>;
  skillsApplied?: SkillApplied[];
  filesRead?: ReadFileRef[];
  /** Task #3037 — V2.0 Phase 6 audit summary blocks. */
  conflictLog?: string;
  scopeGapLog?: string;
  clarificationList?: string;
  exclusionsList?: string;
  assumptionLog?: string;
  benchmarkSummary?: string;
  overallConfidence?: string;
}

interface Props {
  bidId: string;
  estimateId?: string;
}

/** Returns the badge label and Tailwind classes for a per-line confidence rating. */
function ConfidenceBadge({ level }: { level: "HIGH" | "MEDIUM" | "LOW" | undefined }) {
  if (!level) return null;
  const map = {
    HIGH: { label: "✅ HIGH", className: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-200 dark:border-green-800" },
    MEDIUM: { label: "⚠️ MED", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800" },
    LOW: { label: "🔴 LOW", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800" },
  } as const;
  const { label, className } = map[level];
  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1 py-0 shrink-0 ${className}`}
      data-testid={`badge-confidence-${level.toLowerCase()}`}
    >
      {label}
    </Badge>
  );
}

/** A single collapsible block inside the AI Audit panel. */
function AuditBlock({ title, content, testId }: { title: string; content: string; testId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-t first:border-t-0" data-testid={testId}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium hover:bg-muted/50 transition-colors text-left"
        data-testid={`${testId}-toggle`}
      >
        <span>{title}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed" data-testid={`${testId}-content`}>
          {content}
        </div>
      )}
    </div>
  );
}

export function GenerateDraftEstimateButton({ bidId, estimateId }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [scopeNotes, setScopeNotes] = useState("");
  const [draft, setDraft] = useState<DraftResult | null>(null);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [auditExpanded, setAuditExpanded] = useState(false);

  // Task #2517 — POST enqueues an `ai_estimator_draft` job and returns
  // `{ jobId }`. Poll `/api/jobs/:id` until terminal then unwrap the
  // draft from `output`.
  const generate = useMutation({
    mutationFn: async (): Promise<DraftResult & { fallback?: boolean; message?: string }> => {
      const r = await apiRequest("POST", "/api/ai-estimator/draft-estimate", {
        bidId,
        scopeNotes: scopeNotes.trim() || undefined,
      });
      const enq = (await r.json()) as { jobId?: string };
      if (!enq.jobId) throw new Error("Server did not return a job id");
      const status = await pollJobUntilDone<DraftResult & { fallback?: boolean; message?: string }>(
        enq.jobId,
        { intervalMs: 2000, timeoutMs: 10 * 60_000 },
      );
      if (status.state !== "completed") {
        throw new Error(status.error || `Draft job ${status.state}`);
      }
      if (!status.output) throw new Error("Draft job returned no output");
      return status.output;
    },
    onSuccess: (data: DraftResult & { fallback?: boolean; message?: string }) => {
      if (data.fallback) {
        toast({ title: "No draft generated", description: data.message ?? "AI returned no usable draft", variant: "destructive" });
        return;
      }
      setDraft(data);
    },
    onError: (err: Error) => toast({ title: "Draft failed", description: err.message, variant: "destructive" }),
  });

  const sendFeedback = useMutation({
    mutationFn: async (outcome: "ACCEPTED" | "REJECTED") =>
      apiRequest("POST", "/api/ai-estimator/feedback", {
        surface: "estimate_draft",
        outcome,
        targetType: "draft_estimate",
        bidId,
        estimateId,
        comment: scopeNotes || undefined,
      }),
  });

  /** True when at least one Phase 6 audit block has content. */
  const hasAuditData = (d: DraftResult) =>
    !!(d.conflictLog || d.scopeGapLog || d.clarificationList || d.exclusionsList || d.assumptionLog || d.benchmarkSummary || d.overallConfidence);

  /** Whether any line has a confidence rating (so we show the column at all). */
  const hasConfidenceRatings = (d: DraftResult) => d.lines.some((l) => l.confidence);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="button-generate-draft-estimate"
      >
        <Sparkles className="h-4 w-4 mr-2" />
        Generate draft
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Generate draft estimate
            </DialogTitle>
            <DialogDescription>
              Pulls quantities from the linked takeoff and unit costs from your org's learned rates. You stay in
              control: nothing is added to the estimate until you copy it in.
            </DialogDescription>
          </DialogHeader>

          {!draft && (
            <div className="space-y-3 py-2">
              <label className="text-sm font-medium">Scope notes (optional)</label>
              <Textarea
                value={scopeNotes}
                onChange={(e) => setScopeNotes(e.target.value)}
                placeholder="e.g. Concrete sidewalk replacement, Phase 2 only — no curb work."
                className="min-h-[100px]"
                data-testid="input-scope-notes"
              />
            </div>
          )}

          {draft && (
            <ScrollArea className="flex-1 pr-2">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Confidence: {draft.confidence}%</Badge>
                  <Badge variant="outline">{draft.lines.length} line items</Badge>
                </div>
                {draft.notes && <p className="text-sm text-muted-foreground">{draft.notes}</p>}
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Description</th>
                        <th className="text-left p-2">Cost code</th>
                        <th className="text-right p-2">Qty</th>
                        <th className="text-left p-2">Unit</th>
                        <th className="text-right p-2">Unit cost</th>
                        <th className="text-right p-2">Total</th>
                        {hasConfidenceRatings(draft) && (
                          <th className="text-center p-2">Confidence</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {draft.lines.map((l, i) => (
                        <tr key={i} className="border-t" data-testid={`row-draft-line-${i}`}>
                          <td className="p-2">{l.description}</td>
                          <td className="p-2 font-mono">{l.costCode ?? "—"}</td>
                          <td className="p-2 text-right">{l.quantity}</td>
                          <td className="p-2">{l.unit}</td>
                          <td className="p-2 text-right">${l.unitCost.toFixed(2)}</td>
                          <td className="p-2 text-right">${l.totalCost.toFixed(2)}</td>
                          {hasConfidenceRatings(draft) && (
                            <td className="p-2 text-center">
                              <ConfidenceBadge level={l.confidence} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {draft.skillsApplied && draft.skillsApplied.length > 0 && (
                  <div className="border rounded-md overflow-hidden" data-testid="section-skills-applied">
                    <button
                      type="button"
                      onClick={() => setSkillsExpanded((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-muted/50 hover:bg-muted transition-colors"
                      data-testid="button-toggle-skills-applied"
                    >
                      <span className="flex items-center gap-1.5">
                        <Check className="h-3 w-3 text-primary" />
                        Skills applied ({draft.skillsApplied.length})
                      </span>
                      {skillsExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    {skillsExpanded && (
                      <ul className="divide-y text-xs" data-testid="list-skills-applied">
                        {draft.skillsApplied.map((s) => (
                          <li key={s.id} className="flex items-center px-3 py-2 gap-2" data-testid={`item-skill-${s.id}`}>
                            <span
                              className="shrink-0"
                              aria-label={s.scope === "global" ? "Global scope" : s.scope === "trade" ? "Trade scope" : "Project scope"}
                              title={s.scope === "global" ? "Global scope" : s.scope === "trade" ? "Trade scope" : "Project scope"}
                            >
                              {s.scope === "global" ? "🌐" : s.scope === "trade" ? "🔧" : "📋"}
                            </span>
                            <a
                              href="/ai-estimator/admin?tab=skills"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate font-medium hover:text-primary hover:underline transition-colors flex items-center gap-1"
                              title="View in AI Estimator Admin → Skills"
                              data-testid={`link-skill-admin-${s.id}`}
                            >
                              {s.name}
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-50" />
                            </a>
                            {s.scopeValue && (
                              <Badge variant="outline" className="text-[10px] shrink-0 ml-auto">{s.scopeValue}</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {/* Task #2957 — Files analyzed panel */}
                {draft.filesRead && draft.filesRead.length > 0 ? (
                  <div className="border rounded-md overflow-hidden" data-testid="section-files-read">
                    <button
                      type="button"
                      onClick={() => setFilesExpanded((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-muted/50 hover:bg-muted transition-colors"
                      data-testid="button-toggle-files-read"
                    >
                      <span>Files analyzed ({draft.filesRead.length})</span>
                      {filesExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    {filesExpanded && (
                      <ul className="divide-y text-xs" data-testid="list-files-read">
                        {draft.filesRead.map((f, idx) => {
                          const isSpreadsheet = f.fileType === "spreadsheet";
                          const isImage = f.fileType === "image";
                          const Icon = isSpreadsheet
                            ? FileSpreadsheet
                            : isImage
                            ? Image
                            : f.fileType === "other"
                            ? FileQuestion
                            : FileText;
                          const sourceLabel =
                            f.source === "bid_document"
                              ? "bid"
                              : f.source === "quote_document"
                              ? "quote"
                              : "project";
                          return (
                            <li
                              key={idx}
                              className="flex items-center gap-2 px-3 py-1.5"
                              data-testid={`item-read-file-${idx}`}
                            >
                              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="truncate flex-1" title={f.fileName}>
                                {f.fileName}
                              </span>
                              <span className="text-muted-foreground shrink-0 capitalize">
                                {sourceLabel}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : draft.filesRead !== undefined ? (
                  <p className="text-xs text-muted-foreground px-1" data-testid="text-no-files-read">
                    No extra files were read. Upload PDFs, spreadsheets, or drawings to the bid to give the AI more context.
                  </p>
                ) : null}
                {draft.citations && draft.citations.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Sources</div>
                    {draft.citations.map((c) => (
                      <Badge key={c.id} variant="secondary" className="text-[10px] mr-1">
                        {c.sourceType}: {c.title}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Task #3037 — AI Audit panel: Phase 6 summary blocks. Hidden for legacy estimates. */}
                {hasAuditData(draft) && (
                  <div className="border rounded-md overflow-hidden" data-testid="section-ai-audit">
                    <button
                      type="button"
                      onClick={() => setAuditExpanded((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-muted/50 hover:bg-muted transition-colors"
                      data-testid="button-toggle-ai-audit"
                    >
                      <span className="flex items-center gap-1.5">
                        <ClipboardList className="h-3 w-3 text-primary" />
                        AI Audit
                      </span>
                      {auditExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                    {auditExpanded && (
                      <div className="divide-y text-xs" data-testid="panel-ai-audit">
                        {draft.conflictLog && (
                          <AuditBlock
                            title="Conflict Log"
                            content={draft.conflictLog}
                            testId="audit-block-conflict-log"
                          />
                        )}
                        {draft.scopeGapLog && (
                          <AuditBlock
                            title="Scope Gap Log"
                            content={draft.scopeGapLog}
                            testId="audit-block-scope-gap-log"
                          />
                        )}
                        {draft.clarificationList && (
                          <AuditBlock
                            title="Clarification List"
                            content={draft.clarificationList}
                            testId="audit-block-clarification-list"
                          />
                        )}
                        {draft.exclusionsList && (
                          <AuditBlock
                            title="Exclusions"
                            content={draft.exclusionsList}
                            testId="audit-block-exclusions-list"
                          />
                        )}
                        {draft.assumptionLog && (
                          <AuditBlock
                            title="Assumption Log"
                            content={draft.assumptionLog}
                            testId="audit-block-assumption-log"
                          />
                        )}
                        {draft.benchmarkSummary && (
                          <AuditBlock
                            title="Benchmark Verification"
                            content={draft.benchmarkSummary}
                            testId="audit-block-benchmark-summary"
                          />
                        )}
                        {draft.overallConfidence && (
                          <AuditBlock
                            title="Overall Confidence Reasoning"
                            content={draft.overallConfidence}
                            testId="audit-block-overall-confidence"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          <DialogFooter>
            {!draft ? (
              <Button onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="button-run-draft">
                {generate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                Generate
              </Button>
            ) : (
              <div className="flex gap-2 w-full justify-end">
                <Button
                  variant="ghost"
                  onClick={() => {
                    sendFeedback.mutate("REJECTED");
                    setDraft(null);
                    setOpen(false);
                  }}
                  data-testid="button-discard-draft"
                >
                  Discard
                </Button>
                <Button
                  onClick={() => {
                    sendFeedback.mutate("ACCEPTED");
                    toast({
                      title: "Draft kept open",
                      description:
                        "Copy line items into your estimate from this dialog. Your acceptance is being recorded for future learning.",
                    });
                  }}
                  data-testid="button-accept-draft"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Mark as accepted
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
