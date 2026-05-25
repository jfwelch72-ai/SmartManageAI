import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Loader2, Sparkles, Check, Pencil, X, ChevronDown, ChevronRight, AlertTriangle, HelpCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LineItemPayload {
  description: string;
  costCode?: string | null;
  quantity?: string | null;
  unit?: string | null;
  manualUnitCostMaterial?: string | null;
  manualUnitCostLabor?: string | null;
  manualProductionRate?: string | null;
  notes?: string | null;
  mode?: "AUTO" | "ON_DEMAND";
}

interface ProjectContextPayload {
  projectType?: string | null;
  projectSize?: string | null;
  location?: string | null;
  laborType?: string | null;
  bidDate?: string | null;
  relevantSpecSections?: string | null;
  relevantDrawingData?: string | null;
  seismicZone?: string | null;
  soilClass?: string | null;
  specialConditions?: string | null;
}

interface EnrichmentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItem: LineItemPayload;
  projectContext?: ProjectContextPayload;
  estimateLineItemId?: string | null;
  onFieldAccepted?: (fieldName: string, value: string) => void;
}

type Confidence = "HIGH" | "MEDIUM" | "LOW";

interface EnrichmentSpec {
  specifiedMaterialStandard?: string | null;
  specifiedProductGrade?: string | null;
  _source?: string | null;
  _confidence?: Confidence | null;
  applicableSpecSections?: string[];
  drawingReferences?: string[];
}

interface EnrichmentMaterial {
  suggestedUnitCostMaterial?: string | null;
  _source?: string | null;
  _confidence?: Confidence | null;
  priceDate?: string | null;
  volatilityFlag?: string | null;
  leadTimeFlag?: string | null;
  manualVsBenchmarkVariance?: string | null;
}

interface EnrichmentLabor {
  suggestedUnitCostLabor?: string | null;
  suggestedProductionRate?: string | null;
  _source?: string | null;
  _confidence?: Confidence | null;
  crewComposition?: string | null;
  laborBasis?: string | null;
  manualVsBenchmarkVariance?: string | null;
}

interface EnrichmentModifier {
  modifierType?: string | null;
  _confidence?: Confidence | null;
  suggestedFactor?: string | null;
  reasoning?: string | null;
  drawingOrSpecBasis?: string | null;
}

interface EnrichmentSow {
  inclusions?: string[];
  exclusions?: string[];
  interfaceNotes?: string[];
}

interface EnrichmentOrg {
  historicalRangeMaterial?: string | null;
  historicalRangeLabor?: string | null;
  projectCount?: string | number | null;
  winRateNote?: string | null;
  historicalModifiersNote?: string | null;
}

interface EnrichmentBench {
  benchmarkRangeMaterial?: string | null;
  benchmarkRangeLabor?: string | null;
  benchmarkSource?: string | null;
  estimateVsBenchmark?: string | null;
  varianceNote?: string | null;
}

interface EnrichmentClarify {
  id?: string | null;
  urgency?: string | null;
  description?: string | null;
  resolutionNeeded?: string | null;
}

interface EnrichmentConflict {
  id?: string | null;
  description?: string | null;
  basis?: string | null;
}

interface EnrichmentData {
  enrichmentLogId?: string | null;
  enrichmentSummary?: string | null;
  enrichmentConfidence?: Confidence | null;
  enrichmentConfidenceReason?: string | null;
  specGrounding?: EnrichmentSpec;
  materialSuggestion?: EnrichmentMaterial;
  laborSuggestion?: EnrichmentLabor;
  contextualModifiers?: EnrichmentModifier[];
  sowLanguage?: EnrichmentSow;
  orgHistoryInsights?: EnrichmentOrg;
  benchmarkComparison?: EnrichmentBench;
  clarificationEntries?: EnrichmentClarify[];
  conflictFlags?: EnrichmentConflict[];
}

function ConfidenceBadge({ confidence }: { confidence?: Confidence | null }) {
  if (!confidence) return null;
  const map: Record<Confidence, { label: string; className: string }> = {
    HIGH: { label: "✓ HIGH", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800" },
    MEDIUM: { label: "⚠ MEDIUM", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
    LOW: { label: "● LOW", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800" },
  };
  const { label, className } = map[confidence];
  return (
    <Badge variant="outline" className={`text-xs font-mono ${className}`} data-testid={`badge-confidence-${confidence.toLowerCase()}`}>
      {label}
    </Badge>
  );
}

interface SuggestionRowProps {
  label: string;
  value: string | null | undefined;
  source?: string | null;
  confidence?: Confidence | null;
  enrichmentLogId: string | null;
  costCode?: string | null;
  projectContext?: ProjectContextPayload;
  fieldName: string;
  onAccept?: (value: string) => void;
}

function SuggestionRow({
  label,
  value,
  source,
  confidence,
  enrichmentLogId,
  costCode,
  projectContext,
  fieldName,
  onAccept,
}: SuggestionRowProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value ?? "");
  const [dismissed, setDismissed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const { toast } = useToast();

  const feedbackMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      apiRequest("POST", "/api/line-items/enrich/feedback", payload),
  });

  const sendFeedback = (outcome: "ACCEPTED_AS_IS" | "MODIFIED" | "REJECTED", acceptedVal?: string) => {
    feedbackMutation.mutate({
      enrichmentLogId: enrichmentLogId ?? undefined,
      costCode: costCode ?? undefined,
      projectType: projectContext?.projectType ?? undefined,
      location: projectContext?.location ?? undefined,
      laborType: projectContext?.laborType ?? undefined,
      fieldName,
      outcome,
      suggestedValue: value,
      acceptedValue: acceptedVal ?? value,
    });
  };

  if (dismissed) return null;

  return (
    <div className="flex flex-col gap-1 py-2 border-b last:border-b-0" data-testid={`enrichment-row-${fieldName}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
        <ConfidenceBadge confidence={confidence} />
      </div>

      {editing ? (
        <div className="flex flex-col gap-2 mt-1">
          <Textarea
            className="text-sm min-h-[60px]"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            data-testid={`textarea-enrich-edit-${fieldName}`}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                setAccepted(true);
                setEditing(false);
                sendFeedback("MODIFIED", editValue);
                onAccept?.(editValue);
                toast({ title: "Suggestion modified and accepted" });
              }}
              data-testid={`button-enrich-accept-edit-${fieldName}`}
            >
              <Check className="h-3 w-3 mr-1" /> Accept edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={`text-sm ${accepted ? "line-through text-muted-foreground" : ""}`}>
              {value ?? <span className="text-muted-foreground italic">No data available</span>}
            </p>
            {source && (
              <p className="text-xs text-muted-foreground mt-0.5 italic">{source}</p>
            )}
          </div>
          {!accepted && value && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                onClick={() => {
                  setAccepted(true);
                  sendFeedback("ACCEPTED_AS_IS");
                  onAccept?.(value);
                  toast({ title: "Suggestion accepted" });
                }}
                data-testid={`button-enrich-accept-${fieldName}`}
              >
                <Check className="h-3 w-3 mr-1" /> Accept
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                onClick={() => {
                  setEditValue(value);
                  setEditing(true);
                }}
                data-testid={`button-enrich-modify-${fieldName}`}
              >
                <Pencil className="h-3 w-3 mr-1" /> Modify
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => {
                  setDismissed(true);
                  sendFeedback("REJECTED");
                  toast({ title: "Suggestion dismissed", variant: "default" });
                }}
                data-testid={`button-enrich-dismiss-${fieldName}`}
              >
                <X className="h-3 w-3 mr-1" /> Dismiss
              </Button>
            </div>
          )}
          {accepted && (
            <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50 dark:bg-green-900/20 shrink-0">
              Accepted
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function SectionCollapsible({
  title,
  icon,
  defaultOpen = true,
  children,
  testId,
}: {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          className="flex items-center gap-2 w-full text-left py-2 font-semibold text-sm hover:text-primary transition-colors"
          data-testid={testId}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          {icon}
          {title}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-2 pb-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function EnrichmentDrawer({
  open,
  onOpenChange,
  lineItem,
  projectContext,
  estimateLineItemId,
  onFieldAccepted,
}: EnrichmentDrawerProps) {
  const [enrichmentData, setEnrichmentData] = useState<EnrichmentData | null>(null);
  const [enrichmentLogId, setEnrichmentLogId] = useState<string | null>(null);
  const { toast } = useToast();

  const enrichMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/line-items/enrich", {
        lineItem: { ...lineItem, mode: "ON_DEMAND" },
        projectContext: projectContext ?? {},
        estimateLineItemId: estimateLineItemId ?? null,
      }).then((r) => r.json() as Promise<EnrichmentData>),
    onSuccess: (data: EnrichmentData) => {
      setEnrichmentLogId(data.enrichmentLogId ?? null);
      setEnrichmentData(data);
    },
    onError: () => {
      toast({
        title: "Enrichment failed",
        description: "Claude could not process this request. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleOpen = (val: boolean) => {
    onOpenChange(val);
    if (!val) {
      setEnrichmentData(null);
      setEnrichmentLogId(null);
      enrichMutation.reset();
    }
  };

  const d = enrichmentData;
  const spec = d?.specGrounding;
  const mat = d?.materialSuggestion;
  const lab = d?.laborSuggestion;
  const mods = d?.contextualModifiers ?? [];
  const sow = d?.sowLanguage;
  const org = d?.orgHistoryInsights;
  const bench = d?.benchmarkComparison;
  const clarifies = d?.clarificationEntries ?? [];
  const conflicts = d?.conflictFlags ?? [];

  const sharedRowProps = { enrichmentLogId, costCode: lineItem.costCode, projectContext };

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-6 py-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Line Item Enrichment
          </SheetTitle>
          <SheetDescription className="text-sm">
            Advisory suggestions for <span className="font-medium">{lineItem.description}</span>
            {lineItem.costCode && <span className="text-muted-foreground"> · {lineItem.costCode}</span>}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 overflow-y-auto">
          <div className="px-6 py-4 space-y-1">
            {!enrichmentData && !enrichMutation.isPending && (
              <div className="flex flex-col items-center gap-4 py-12">
                <Sparkles className="h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground text-center max-w-xs">
                  Claude will analyze this line item against project specs, drawings, your org history, and live market data.
                </p>
                <Button
                  onClick={() => enrichMutation.mutate()}
                  data-testid="button-run-enrichment"
                  className="mt-2"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Run Enrichment
                </Button>
              </div>
            )}

            {enrichMutation.isPending && (
              <div className="flex flex-col items-center gap-4 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Analyzing line item…</p>
                <p className="text-xs text-muted-foreground">Web search may take up to 30 seconds</p>
              </div>
            )}

            {enrichmentData && (
              <div className="space-y-1">
                {d?.enrichmentSummary && (
                  <div className="rounded-md bg-primary/5 border border-primary/20 p-3 mb-4">
                    <p className="text-sm" data-testid="text-enrichment-summary">
                      {d.enrichmentSummary}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-muted-foreground">Overall confidence:</span>
                      <ConfidenceBadge confidence={d?.enrichmentConfidence} />
                    </div>
                    {d?.enrichmentConfidenceReason && (
                      <p className="text-xs text-muted-foreground mt-1 italic">
                        {d.enrichmentConfidenceReason}
                      </p>
                    )}
                  </div>
                )}

                {spec && (
                  <>
                    <SectionCollapsible title="Spec Grounding" testId="section-spec-grounding">
                      <SuggestionRow
                        label="Material Standard"
                        value={spec.specifiedMaterialStandard}
                        source={spec._source}
                        confidence={spec._confidence}
                        fieldName="specifiedMaterialStandard"
                        {...sharedRowProps}
                      />
                      <SuggestionRow
                        label="Product Grade"
                        value={spec.specifiedProductGrade}
                        source={spec._source}
                        confidence={spec._confidence}
                        fieldName="specifiedProductGrade"
                        {...sharedRowProps}
                      />
                      {spec.applicableSpecSections && spec.applicableSpecSections.length > 0 && (
                        <div className="py-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Applicable Spec Sections</p>
                          <ul className="text-sm space-y-0.5">
                            {spec.applicableSpecSections.map((s, i) => (
                              <li key={i} className="text-sm" data-testid={`text-spec-section-${i}`}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {spec.drawingReferences && spec.drawingReferences.length > 0 && (
                        <div className="py-2 border-t">
                          <p className="text-xs font-medium text-muted-foreground uppercase mb-1">Drawing References</p>
                          <ul className="text-sm space-y-0.5">
                            {spec.drawingReferences.map((r, i) => (
                              <li key={i} className="text-sm" data-testid={`text-drawing-ref-${i}`}>{r}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {mat && (
                  <>
                    <SectionCollapsible title="Material Suggestion" testId="section-material">
                      <SuggestionRow
                        label="Suggested Unit Cost (Material)"
                        value={mat.suggestedUnitCostMaterial}
                        source={`${mat._source ?? ""} · Price date: ${mat.priceDate ?? "unknown"}`}
                        confidence={mat._confidence}
                        fieldName="suggestedUnitCostMaterial"
                        onAccept={onFieldAccepted ? (v) => onFieldAccepted("suggestedUnitCostMaterial", v) : undefined}
                        {...sharedRowProps}
                      />
                      {mat.volatilityFlag && (
                        <div className="py-1 text-xs text-muted-foreground">
                          Volatility: <span className="font-medium">{mat.volatilityFlag}</span>
                        </div>
                      )}
                      {mat.leadTimeFlag && (
                        <div className="py-1 text-xs text-muted-foreground">
                          Lead time: <span className="font-medium">{mat.leadTimeFlag}</span>
                        </div>
                      )}
                      {mat.manualVsBenchmarkVariance && (
                        <div className="py-1 text-xs text-amber-600 dark:text-amber-400">
                          Manual vs benchmark: {mat.manualVsBenchmarkVariance}
                        </div>
                      )}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {lab && (
                  <>
                    <SectionCollapsible title="Labor Suggestion" testId="section-labor">
                      <SuggestionRow
                        label="Suggested Unit Cost (Labor)"
                        value={lab.suggestedUnitCostLabor}
                        source={lab._source}
                        confidence={lab._confidence}
                        fieldName="suggestedUnitCostLabor"
                        onAccept={onFieldAccepted ? (v) => onFieldAccepted("suggestedUnitCostLabor", v) : undefined}
                        {...sharedRowProps}
                      />
                      <SuggestionRow
                        label="Production Rate"
                        value={lab.suggestedProductionRate}
                        source={lab._source}
                        confidence={lab._confidence}
                        fieldName="suggestedProductionRate"
                        onAccept={onFieldAccepted ? (v) => onFieldAccepted("suggestedProductionRate", v) : undefined}
                        {...sharedRowProps}
                      />
                      {lab.crewComposition && (
                        <div className="py-1 text-xs text-muted-foreground">
                          Crew: <span className="font-medium">{lab.crewComposition}</span>
                        </div>
                      )}
                      {lab.laborBasis && (
                        <div className="py-1 text-xs text-muted-foreground">
                          Labor basis: <span className="font-medium">{lab.laborBasis}</span>
                        </div>
                      )}
                      {lab.manualVsBenchmarkVariance && (
                        <div className="py-1 text-xs text-amber-600 dark:text-amber-400">
                          Manual vs benchmark: {lab.manualVsBenchmarkVariance}
                        </div>
                      )}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {mods.length > 0 && (
                  <>
                    <SectionCollapsible title={`Contextual Modifiers (${mods.length})`} testId="section-modifiers">
                      {mods.map((mod, i) => (
                        <div key={i} className="py-2 border-b last:border-b-0" data-testid={`enrichment-modifier-${i}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-sm font-medium">{mod.modifierType}</span>
                            <div className="flex items-center gap-1">
                              <ConfidenceBadge confidence={mod._confidence} />
                              {mod.suggestedFactor && (
                                <Badge variant="outline" className="text-xs font-mono">
                                  ×{mod.suggestedFactor}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">{mod.reasoning}</p>
                          {mod.drawingOrSpecBasis && (
                            <p className="text-xs text-muted-foreground italic mt-0.5">Basis: {mod.drawingOrSpecBasis}</p>
                          )}
                        </div>
                      ))}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {sow && (
                  <>
                    <SectionCollapsible title="SOW Language" defaultOpen={false} testId="section-sow">
                      {sow.inclusions && sow.inclusions.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-green-700 dark:text-green-400 mb-1">INCLUDES</p>
                          <ul className="space-y-0.5">
                            {sow.inclusions.map((inc, i) => (
                              <li key={i} className="text-sm pl-3 border-l-2 border-green-300 dark:border-green-700" data-testid={`text-sow-inclusion-${i}`}>
                                {inc}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {sow.exclusions && sow.exclusions.length > 0 && (
                        <div className="mb-2">
                          <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">EXCLUDES</p>
                          <ul className="space-y-0.5">
                            {sow.exclusions.map((exc, i) => (
                              <li key={i} className="text-sm pl-3 border-l-2 border-red-300 dark:border-red-700" data-testid={`text-sow-exclusion-${i}`}>
                                {exc}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {sow.interfaceNotes && sow.interfaceNotes.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">INTERFACE NOTES</p>
                          <ul className="space-y-0.5">
                            {sow.interfaceNotes.map((note, i) => (
                              <li key={i} className="text-sm pl-3 border-l-2 border-blue-300 dark:border-blue-700" data-testid={`text-sow-interface-${i}`}>
                                {note}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {org && (
                  <>
                    <SectionCollapsible title="Org History" defaultOpen={false} testId="section-org-history">
                      <div className="grid grid-cols-2 gap-3 py-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Historical Material</p>
                          <p className="text-sm font-medium" data-testid="text-org-material-range">
                            {org.historicalRangeMaterial || "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Historical Labor</p>
                          <p className="text-sm font-medium" data-testid="text-org-labor-range">
                            {org.historicalRangeLabor || "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Projects</p>
                          <p className="text-sm font-medium">{org.projectCount ?? "0"}</p>
                        </div>
                      </div>
                      {org.winRateNote && (
                        <p className="text-xs text-muted-foreground italic" data-testid="text-org-win-rate">
                          {org.winRateNote}
                        </p>
                      )}
                      {org.historicalModifiersNote && (
                        <p className="text-xs text-muted-foreground italic mt-1">
                          {org.historicalModifiersNote}
                        </p>
                      )}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {bench && (
                  <>
                    <SectionCollapsible title="Benchmark Comparison" defaultOpen={false} testId="section-benchmark">
                      <div className="grid grid-cols-2 gap-3 py-2">
                        <div>
                          <p className="text-xs text-muted-foreground">Benchmark Material</p>
                          <p className="text-sm font-medium" data-testid="text-bench-material">
                            {bench.benchmarkRangeMaterial || "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Benchmark Labor</p>
                          <p className="text-sm font-medium" data-testid="text-bench-labor">
                            {bench.benchmarkRangeLabor || "—"}
                          </p>
                        </div>
                      </div>
                      {bench.benchmarkSource && (
                        <p className="text-xs text-muted-foreground">Source: {bench.benchmarkSource}</p>
                      )}
                      {bench.estimateVsBenchmark && (
                        <Badge
                          variant="outline"
                          className={
                            bench.estimateVsBenchmark === "WITHIN RANGE"
                              ? "text-green-700 border-green-300 bg-green-50 dark:bg-green-900/20"
                              : "text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-900/20"
                          }
                          data-testid="badge-benchmark-status"
                        >
                          {bench.estimateVsBenchmark}
                        </Badge>
                      )}
                      {bench.varianceNote && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{bench.varianceNote}</p>
                      )}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {clarifies.length > 0 && (
                  <>
                    <SectionCollapsible
                      title={`Clarifications Needed (${clarifies.length})`}
                      icon={<HelpCircle className="h-4 w-4 text-amber-500" />}
                      testId="section-clarifications"
                    >
                      {clarifies.map((c, i) => (
                        <div key={i} className="py-2 border-b last:border-b-0" data-testid={`enrichment-clarify-${i}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-mono text-muted-foreground">{c.id}</span>
                            <Badge variant="outline" className="text-xs">{c.urgency}</Badge>
                          </div>
                          <p className="text-sm mt-1">{c.description}</p>
                          {c.resolutionNeeded && (
                            <p className="text-xs text-muted-foreground mt-0.5 italic">
                              Needs: {c.resolutionNeeded}
                            </p>
                          )}
                        </div>
                      ))}
                    </SectionCollapsible>
                    <Separator />
                  </>
                )}

                {conflicts.length > 0 && (
                  <SectionCollapsible
                    title={`Conflicts (${conflicts.length})`}
                    icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
                    testId="section-conflicts"
                  >
                    {conflicts.map((c, i) => (
                      <div key={i} className="py-2 border-b last:border-b-0" data-testid={`enrichment-conflict-${i}`}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-muted-foreground">{c.id}</span>
                          <ConfidenceBadge confidence="LOW" />
                        </div>
                        <p className="text-sm mt-1">{c.description}</p>
                        {c.basis && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">
                            Fallback: {c.basis}
                          </p>
                        )}
                      </div>
                    ))}
                  </SectionCollapsible>
                )}

                <div className="py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEnrichmentData(null);
                      setEnrichmentLogId(null);
                      enrichMutation.reset();
                    }}
                    data-testid="button-re-run-enrichment"
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    Re-run enrichment
                  </Button>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
