import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronDown, Search, Star, Plus, Sparkles, Globe, Building2, Lightbulb,
  X, TrendingUp, ArrowUpRight, Check, AlertTriangle, Info, Loader2
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface LayerModifier {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  code: string;
  displayOrder: number;
  description?: string;
  isCustom?: boolean;
  factorMin?: number;
  factorMax?: number;
  effectType?: string;
}

interface ModifierCategory {
  id: string;
  name: string;
  displayOrder: number;
  description?: string;
  modifiers: LayerModifier[];
}

interface SuggestedModifier {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  matchPattern: string;
  layer: string;
}

interface ForScopeResponse {
  universal: ModifierCategory[];
  trade: ModifierCategory[];
  suggested: SuggestedModifier[];
  tradeType: string;
  persistenceEnabled?: boolean;
}

export interface ModifierSelection {
  modifierId: string;
  modifierName: string;
  modifierCode: string;
  categoryName: string;
  layer: "universal" | "trade" | "suggested";
  selectedFactor: number;
  costImpactType: string;
}

interface AiCustomModifier {
  name: string;
  category: string;
  effect_type: "labor" | "material" | "mixed";
  labor_factor_min: number;
  labor_factor_max: number;
  material_factor_min: number;
  material_factor_max: number;
  duration_factor_min: number;
  duration_factor_max: number;
  waste_factor_min: number;
  waste_factor_max: number;
  confidence: number;
  reasoning: string;
  ai_tags: string[];
}

interface AiSuggestResponse {
  suggested_modifier_categories: Array<{
    category: string;
    layer: "universal" | "trade" | "scope";
    reason: string;
  }>;
  custom_modifiers: AiCustomModifier[];
  warnings: string[];
  assumptions: string[];
}

interface ModifierSelectorProps {
  trade?: string;
  scopeName?: string;
  lineItemId?: string;
  onSelectionsChange?: (selections: ModifierSelection[]) => void;
  onAcceptAiModifier?: (modifier: AiCustomModifier) => void;
  onSaveToLibrary?: (modifier: AiCustomModifier) => void;
  autoSuggest?: boolean;
  uom?: string;
  materialFamilies?: string[];
  estimatorNotes?: string;
  description?: string;
}

export type { AiCustomModifier };

const COST_IMPACT_OPTIONS = [
  { value: "labor", label: "Labor" },
  { value: "material", label: "Material" },
  { value: "both", label: "Both" },
  { value: "equipment", label: "Equipment" },
];

function getConfidenceLabel(confidence: number): { label: string; variant: "default" | "secondary" | "outline" } {
  if (confidence > 0.8) return { label: "High", variant: "default" };
  if (confidence >= 0.5) return { label: "Medium", variant: "secondary" };
  return { label: "Low", variant: "outline" };
}

function formatFactorRange(min: number, max: number, isWaste?: boolean): string {
  if (isWaste) {
    if (min === 0 && max === 0) return "—";
    return `${(min * 100).toFixed(0)}–${(max * 100).toFixed(0)}%`;
  }
  if (min === 1 && max === 1) return "—";
  return `${min.toFixed(2)}–${max.toFixed(2)}x`;
}

export default function ModifierSelector({
  trade,
  scopeName,
  lineItemId,
  onSelectionsChange,
  onAcceptAiModifier,
  onSaveToLibrary,
  autoSuggest = false,
  uom,
  materialFamilies = [],
  estimatorNotes,
  description,
}: ModifierSelectorProps) {
  const { toast } = useToast();
  const [selections, setSelections] = useState<Map<string, ModifierSelection>>(new Map());
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [customFactor, setCustomFactor] = useState("1.00");
  const [customCostType, setCustomCostType] = useState("labor");
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const [prevScopeKey, setPrevScopeKey] = useState("");

  const [aiResponse, setAiResponse] = useState<AiSuggestResponse | null>(null);
  const [acceptedNames, setAcceptedNames] = useState<Set<string>>(new Set());
  const [dismissedNames, setDismissedNames] = useState<Set<string>>(new Set());
  const [showInfoSection, setShowInfoSection] = useState(false);
  const autoSuggestTriggered = useRef(false);
  const autoSuggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoSuggestCancelled, setAutoSuggestCancelled] = useState(false);
  const [autoSuggestPending, setAutoSuggestPending] = useState(false);

  const scopeKey = `${trade || ""}|${scopeName || ""}|${lineItemId || ""}`;
  useEffect(() => {
    if (scopeKey !== prevScopeKey && prevScopeKey !== "") {
      setSelections(new Map());
      setInitialLoadDone(false);
      setSuggestionsApplied(false);
      setSearchQuery("");
      setExpandedCategories(new Set());
      onSelectionsChange?.([]);
      setAiResponse(null);
      setAcceptedNames(new Set());
      setDismissedNames(new Set());
      autoSuggestTriggered.current = false;
      setAutoSuggestCancelled(false);
    }
    setPrevScopeKey(scopeKey);
  }, [scopeKey]);

  const queryParams = new URLSearchParams();
  if (trade) queryParams.set("trade", trade);
  if (scopeName) queryParams.set("scopeName", scopeName);
  const forScopeUrl = `/api/modifiers/for-scope?${queryParams.toString()}`;

  const { data: modifierData, isLoading } = useQuery<ForScopeResponse>({
    queryKey: [forScopeUrl],
    enabled: true,
  });

  const savedSelectionsUrl = lineItemId ? `/api/bid-modifier-selections/${lineItemId}` : "";
  const { data: savedSelections } = useQuery<any[]>({
    queryKey: [savedSelectionsUrl],
    enabled: !!lineItemId,
  });

  const canPersist = !!lineItemId && !!modifierData?.persistenceEnabled;

  const saveMutation = useMutation({
    mutationFn: async (sels: ModifierSelection[]) => {
      if (!canPersist) return null;
      const persistable = sels.filter(s => !s.modifierId.startsWith("custom-") && !s.modifierId.startsWith("ai-"));
      const response = await apiRequest("POST", "/api/bid-modifier-selections", {
        lineItemId,
        selections: persistable.map(s => ({
          modifierId: s.modifierId,
          selectedFactor: s.selectedFactor,
          notes: `${s.layer}|${s.costImpactType}`,
        })),
      });
      return response.json();
    },
    onSuccess: () => {
      if (lineItemId) {
        queryClient.invalidateQueries({ queryKey: [`/api/bid-modifier-selections/${lineItemId}`] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Could not save modifier selections",
        description: error.message || "Selections are preserved locally but could not be saved to the database.",
        variant: "destructive",
      });
    },
  });

  const aiSuggestMutation = useMutation({
    mutationFn: async () => {
      const realModifierIds = Array.from(selections.keys()).filter(
        id => !id.startsWith("custom-") && !id.startsWith("ai-")
      );
      const res = await apiRequest("POST", "/api/modifiers/ai-suggest", {
        trade_name: trade || "",
        scope_name: scopeName || "",
        uom: uom || "EA",
        material_families: materialFamilies,
        estimator_notes: estimatorNotes,
        description,
        existing_modifier_ids: realModifierIds,
      });
      return res.json() as Promise<AiSuggestResponse>;
    },
    onSuccess: (data) => {
      setAiResponse(data);
      setAcceptedNames(new Set());
      setDismissedNames(new Set());
    },
    onError: (error: Error) => {
      const msg = error.message || "Failed to get AI suggestions";
      if (msg.includes("429")) {
        toast({
          title: "AI Usage Limit Reached",
          description: "Your organization has reached its daily AI usage limit. Try again tomorrow.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "AI Suggestion Error",
          description: msg,
          variant: "destructive",
        });
      }
    },
  });

  useEffect(() => {
    if (savedSelections && savedSelections.length > 0 && !initialLoadDone) {
      const loaded = new Map<string, ModifierSelection>();
      for (const sel of savedSelections) {
        const notesParts = (sel.notes || "").split("|");
        const layer = (notesParts[0] || "universal") as "universal" | "trade" | "suggested";
        const costImpactType = notesParts[1] || "labor";
        loaded.set(sel.modifierId, {
          modifierId: sel.modifierId,
          modifierName: sel.modifierName || "",
          modifierCode: sel.modifierId.slice(0, 8),
          categoryName: sel.modifierCategory || "",
          layer,
          selectedFactor: typeof sel.selectedFactor === "number" ? sel.selectedFactor : (parseFloat(sel.selectedFactor) || 1.0),
          costImpactType,
        });
      }
      setSelections(loaded);
      setInitialLoadDone(true);
      onSelectionsChange?.(Array.from(loaded.values()));
    }
  }, [savedSelections, initialLoadDone]);

  useEffect(() => {
    if (modifierData?.suggested && modifierData.suggested.length > 0 && !initialLoadDone && !suggestionsApplied && (!savedSelections || savedSelections.length === 0)) {
      const newSelections = new Map(selections);
      for (const suggested of modifierData.suggested) {
        if (!newSelections.has(suggested.id)) {
          newSelections.set(suggested.id, {
            modifierId: suggested.id,
            modifierName: suggested.name,
            modifierCode: suggested.code,
            categoryName: suggested.categoryName,
            layer: "suggested",
            selectedFactor: 1.0,
            costImpactType: "labor",
          });
        }
      }
      setSelections(newSelections);
      setSuggestionsApplied(true);
      onSelectionsChange?.(Array.from(newSelections.values()));
    }
  }, [modifierData?.suggested, initialLoadDone, suggestionsApplied, savedSelections]);

  useEffect(() => {
    if (!autoSuggest || autoSuggestTriggered.current || autoSuggestCancelled) return;
    if (!scopeName || !trade) return;
    if (!modifierData || isLoading) return;
    const suggested = modifierData.suggested || [];
    if (suggested.length > 0) return;

    autoSuggestTriggered.current = true;
    setAutoSuggestPending(true);
    autoSuggestTimer.current = setTimeout(() => {
      if (!autoSuggestCancelled) {
        aiSuggestMutation.mutate();
      }
      setAutoSuggestPending(false);
    }, 1500);

    return () => {
      if (autoSuggestTimer.current) {
        clearTimeout(autoSuggestTimer.current);
        setAutoSuggestPending(false);
      }
    };
  }, [autoSuggest, scopeName, trade, modifierData, isLoading, autoSuggestCancelled]);

  const handleCancelAutoSuggest = () => {
    setAutoSuggestCancelled(true);
    setAutoSuggestPending(false);
    if (autoSuggestTimer.current) {
      clearTimeout(autoSuggestTimer.current);
      autoSuggestTimer.current = null;
    }
  };

  const handleAcceptAiModifier = (modifier: AiCustomModifier) => {
    setAcceptedNames((prev) => new Set(prev).add(modifier.name));

    const aiModId = `ai-${modifier.name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    const costType = modifier.effect_type === "mixed" ? "both" : modifier.effect_type;
    const factor = modifier.effect_type === "labor"
      ? (modifier.labor_factor_min + modifier.labor_factor_max) / 2
      : modifier.effect_type === "material"
        ? (modifier.material_factor_min + modifier.material_factor_max) / 2
        : (modifier.labor_factor_min + modifier.labor_factor_max) / 2;

    setSelections(prev => {
      const next = new Map(prev);
      next.set(aiModId, {
        modifierId: aiModId,
        modifierName: modifier.name,
        modifierCode: modifier.name.toLowerCase().replace(/\s+/g, "_"),
        categoryName: modifier.category,
        layer: "suggested",
        selectedFactor: Math.round(factor * 100) / 100,
        costImpactType: costType,
      });
      emitChanges(next);
      return next;
    });

    onAcceptAiModifier?.(modifier);
  };

  const handleDismissAiModifier = (modifierName: string) => {
    setDismissedNames((prev) => new Set(prev).add(modifierName));
  };

  const handleSaveToLibrary = (modifier: AiCustomModifier) => {
    if (onSaveToLibrary) {
      onSaveToLibrary(modifier);
      toast({
        title: "Saved to Library",
        description: `"${modifier.name}" has been saved as an org-specific modifier.`,
      });
    }
  };

  const visibleAiModifiers = aiResponse?.custom_modifiers.filter(
    (m) => !dismissedNames.has(m.name)
  ) || [];

  const showAutoSuggestIndicator =
    autoSuggest &&
    !autoSuggestCancelled &&
    autoSuggestTriggered.current &&
    (autoSuggestPending || aiSuggestMutation.isPending);

  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitChanges = useCallback((newSelections: Map<string, ModifierSelection>) => {
    const arr = Array.from(newSelections.values());
    onSelectionsChange?.(arr);
    if (canPersist) {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = setTimeout(() => {
        saveMutation.mutate(arr);
      }, 1500);
    }
  }, [onSelectionsChange, canPersist, saveMutation]);

  const toggleModifier = useCallback((mod: LayerModifier, layer: "universal" | "trade" | "suggested") => {
    setSelections(prev => {
      const next = new Map(prev);
      if (next.has(mod.id)) {
        next.delete(mod.id);
      } else {
        next.set(mod.id, {
          modifierId: mod.id,
          modifierName: mod.name,
          modifierCode: mod.code,
          categoryName: mod.categoryName,
          layer,
          selectedFactor: 1.0,
          costImpactType: "labor",
        });
      }
      emitChanges(next);
      return next;
    });
  }, [emitChanges]);

  const updateFactor = useCallback((modId: string, factor: number) => {
    setSelections(prev => {
      const next = new Map(prev);
      const existing = next.get(modId);
      if (existing) {
        next.set(modId, { ...existing, selectedFactor: factor });
      }
      emitChanges(next);
      return next;
    });
  }, [emitChanges]);

  const updateCostType = useCallback((modId: string, costType: string) => {
    setSelections(prev => {
      const next = new Map(prev);
      const existing = next.get(modId);
      if (existing) {
        next.set(modId, { ...existing, costImpactType: costType });
      }
      emitChanges(next);
      return next;
    });
  }, [emitChanges]);

  const removeSelection = useCallback((modId: string) => {
    setSelections(prev => {
      const next = new Map(prev);
      next.delete(modId);
      emitChanges(next);
      return next;
    });
  }, [emitChanges]);

  const toggleCategory = useCallback((catId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(catId)) {
        next.delete(catId);
      } else {
        next.add(catId);
      }
      return next;
    });
  }, []);

  const handleAddCustom = useCallback(() => {
    if (!customName.trim()) return;
    const customId = `custom-${Date.now()}`;
    setSelections(prev => {
      const next = new Map(prev);
      next.set(customId, {
        modifierId: customId,
        modifierName: customName.trim(),
        modifierCode: customName.trim().toLowerCase().replace(/\s+/g, "_"),
        categoryName: customCategory || "Custom",
        layer: "universal",
        selectedFactor: parseFloat(customFactor) || 1.0,
        costImpactType: customCostType,
      });
      emitChanges(next);
      return next;
    });
    setCustomDialogOpen(false);
    setCustomName("");
    setCustomCategory("");
    setCustomFactor("1.00");
    setCustomCostType("labor");
  }, [customName, customCategory, customFactor, customCostType, emitChanges]);

  const filterModifiers = useCallback((modifiers: LayerModifier[]): LayerModifier[] => {
    if (!searchQuery.trim()) return modifiers;
    const q = searchQuery.toLowerCase();
    return modifiers.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.code.toLowerCase().includes(q) ||
      m.categoryName?.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const costSummary = useMemo(() => {
    const summary: Record<string, number> = {};
    for (const sel of selections.values()) {
      if (sel.selectedFactor !== 1.0) {
        const impact = ((sel.selectedFactor - 1.0) * 100);
        const type = sel.costImpactType || "labor";
        if (type === "both") {
          summary["labor"] = (summary["labor"] || 0) + impact;
          summary["material"] = (summary["material"] || 0) + impact;
        } else {
          summary[type] = (summary[type] || 0) + impact;
        }
      }
    }
    return summary;
  }, [selections]);

  const selectedCount = selections.size;

  const suggestedIds = useMemo(() => {
    return new Set(modifierData?.suggested?.map(s => s.id) || []);
  }, [modifierData?.suggested]);

  const renderModifierItem = (mod: LayerModifier, layer: "universal" | "trade" | "suggested") => {
    const isSelected = selections.has(mod.id);
    const selection = selections.get(mod.id);
    const isSuggested = suggestedIds.has(mod.id);

    return (
      <div key={mod.id} className="space-y-1">
        <label className="flex items-center gap-2 p-2 rounded-md hover:bg-muted/30 cursor-pointer text-sm">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => toggleModifier(mod, layer)}
            data-testid={`checkbox-modifier-${mod.id}`}
          />
          <span className="flex-1">{mod.name}</span>
          {isSelected && selection && (
            <span className="text-xs text-muted-foreground flex items-center gap-0.5" data-testid={`indicator-cost-impact-${mod.id}`}>
              <ArrowUpRight className="h-3 w-3" />
              {selection.costImpactType === "both" ? "Labor+Mat" : selection.costImpactType.charAt(0).toUpperCase() + selection.costImpactType.slice(1)}
              {selection.selectedFactor !== 1.0 && (
                <span className="text-amber-600 dark:text-amber-400 ml-0.5">
                  {selection.selectedFactor > 1 ? `+${((selection.selectedFactor - 1) * 100).toFixed(0)}%` : `${((selection.selectedFactor - 1) * 100).toFixed(0)}%`}
                </span>
              )}
            </span>
          )}
          {isSuggested && (
            <Badge variant="outline" className="text-xs bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800 gap-1" data-testid={`badge-suggested-${mod.id}`}>
              <Star className="h-3 w-3" />
              Suggested
            </Badge>
          )}
          <span className="text-muted-foreground text-xs">({mod.code})</span>
        </label>
        {isSelected && selection && (
          <div className="ml-8 mr-2 p-2 bg-muted/20 rounded-md border flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Factor:</Label>
              <Input
                type="number"
                min={mod.factorMin ?? 0.5}
                max={mod.factorMax ?? 3.0}
                step="0.05"
                value={selection.selectedFactor}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 1.0;
                  const clamped = Math.min(Math.max(val, mod.factorMin ?? 0.5), mod.factorMax ?? 3.0);
                  updateFactor(mod.id, clamped);
                }}
                className="h-7 w-20 text-xs"
                data-testid={`input-factor-${mod.id}`}
                title={`Range: ${mod.factorMin ?? 0.5} - ${mod.factorMax ?? 3.0}`}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">Affects:</Label>
              <Select value={selection.costImpactType} onValueChange={(v) => updateCostType(mod.id, v)}>
                <SelectTrigger className="h-7 w-24 text-xs" data-testid={`select-cost-type-${mod.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COST_IMPACT_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selection.selectedFactor !== 1.0 && (
              <span className="text-amber-600 dark:text-amber-400 flex items-center gap-0.5">
                <TrendingUp className="h-3 w-3" />
                {selection.selectedFactor > 1
                  ? `+${((selection.selectedFactor - 1) * 100).toFixed(0)}%`
                  : `${((selection.selectedFactor - 1) * 100).toFixed(0)}%`}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderCategoryAccordion = (
    category: ModifierCategory,
    layer: "universal" | "trade",
    filteredMods: LayerModifier[]
  ) => {
    if (filteredMods.length === 0) return null;
    const selectedInCategory = filteredMods.filter(m => selections.has(m.id)).length;

    return (
      <Collapsible
        key={category.id}
        open={expandedCategories.has(category.id)}
        onOpenChange={() => toggleCategory(category.id)}
      >
        <CollapsibleTrigger
          className="flex items-center gap-2 w-full p-2 rounded hover:bg-muted/50 text-sm"
          data-testid={`button-modifier-category-${category.id}`}
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${expandedCategories.has(category.id) ? "rotate-180" : ""}`} />
          <span className="font-medium flex-1 text-left">{category.name}</span>
          {selectedInCategory > 0 && (
            <Badge variant="secondary" className="text-xs">
              {selectedInCategory}
            </Badge>
          )}
          <span className="text-muted-foreground text-xs">({filteredMods.length})</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="pl-4 space-y-0.5 py-1">
          {filteredMods.map(mod => renderModifierItem(mod, layer))}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="text-sm text-muted-foreground text-center">Loading modifiers...</div>
        </CardContent>
      </Card>
    );
  }

  const universal = modifierData?.universal || [];
  const tradeData = modifierData?.trade || [];
  const suggested = modifierData?.suggested || [];

  return (
    <div className="space-y-3" data-testid="modifier-selector">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search modifiers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
            data-testid="input-modifier-search"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setCustomDialogOpen(true)}
          data-testid="button-add-custom-modifier"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Custom
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => aiSuggestMutation.mutate()}
          disabled={aiSuggestMutation.isPending || !trade || !scopeName}
          data-testid="button-ai-suggest-modifiers"
        >
          {aiSuggestMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          AI Suggest
        </Button>

        {showAutoSuggestIndicator && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>AI analyzing scope...</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={handleCancelAutoSuggest}
              data-testid="button-cancel-auto-suggest"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {aiResponse && visibleAiModifiers.length > 0 && (
        <Card className="border-purple-200 dark:border-purple-800 bg-purple-50/30 dark:bg-purple-950/10">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm flex items-center gap-2 text-purple-700 dark:text-purple-400">
              <Sparkles className="h-4 w-4" />
              AI-Suggested Modifiers
              <Badge variant="outline" className="ml-auto text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-300 dark:border-purple-700">
                {visibleAiModifiers.length} suggestions
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            {visibleAiModifiers.map((mod) => {
              const conf = getConfidenceLabel(mod.confidence);
              const isAccepted = acceptedNames.has(mod.name);

              return (
                <div
                  key={mod.name}
                  className={`p-3 rounded-lg border ${
                    isAccepted
                      ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
                      : "bg-background border-border"
                  }`}
                  data-testid={`ai-modifier-${mod.name.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{mod.name}</span>
                        <Badge variant={conf.variant} className="text-xs" data-testid={`badge-confidence-${mod.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          {conf.label} ({(mod.confidence * 100).toFixed(0)}%)
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {mod.effect_type}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {mod.category}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {mod.reasoning}
                      </p>
                      <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                        {formatFactorRange(mod.labor_factor_min, mod.labor_factor_max) !== "—" && (
                          <span>Labor: {formatFactorRange(mod.labor_factor_min, mod.labor_factor_max)}</span>
                        )}
                        {formatFactorRange(mod.material_factor_min, mod.material_factor_max) !== "—" && (
                          <span>Material: {formatFactorRange(mod.material_factor_min, mod.material_factor_max)}</span>
                        )}
                        {formatFactorRange(mod.duration_factor_min, mod.duration_factor_max) !== "—" && (
                          <span>Duration: {formatFactorRange(mod.duration_factor_min, mod.duration_factor_max)}</span>
                        )}
                        {formatFactorRange(mod.waste_factor_min, mod.waste_factor_max, true) !== "—" && (
                          <span>Waste: {formatFactorRange(mod.waste_factor_min, mod.waste_factor_max, true)}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!isAccepted ? (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-green-600 hover:text-green-700 hover:bg-green-100 dark:hover:bg-green-900/30"
                            onClick={() => handleAcceptAiModifier(mod)}
                            title="Accept modifier"
                            data-testid={`button-accept-${mod.name.replace(/\s+/g, "-").toLowerCase()}`}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-red-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30"
                            onClick={() => handleDismissAiModifier(mod.name)}
                            title="Dismiss"
                            data-testid={`button-dismiss-${mod.name.replace(/\s+/g, "-").toLowerCase()}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <div className="flex items-center gap-1">
                          <Badge variant="default" className="text-xs bg-green-600">
                            <Check className="h-3 w-3 mr-1" />
                            Accepted
                          </Badge>
                          {onSaveToLibrary && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleSaveToLibrary(mod)}
                              data-testid={`button-save-library-${mod.name.replace(/\s+/g, "-").toLowerCase()}`}
                            >
                              Save to Library
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {(aiResponse.warnings.length > 0 || aiResponse.assumptions.length > 0) && (
              <Collapsible open={showInfoSection} onOpenChange={setShowInfoSection}>
                <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2" data-testid="button-toggle-ai-info">
                  <Info className="h-3 w-3" />
                  <span>Warnings & Assumptions</span>
                  <ChevronDown className={`h-3 w-3 transition-transform ${showInfoSection ? "rotate-180" : ""}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 space-y-2">
                  {aiResponse.warnings.length > 0 && (
                    <div className="p-2 rounded bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                      <div className="flex items-center gap-1 text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                        <AlertTriangle className="h-3 w-3" />
                        Warnings
                      </div>
                      <ul className="text-xs text-yellow-600 dark:text-yellow-300 space-y-0.5">
                        {aiResponse.warnings.map((w, i) => (
                          <li key={i} data-testid={`text-warning-${i}`}>• {w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {aiResponse.assumptions.length > 0 && (
                    <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">
                        <Info className="h-3 w-3" />
                        Assumptions
                      </div>
                      <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-0.5">
                        {aiResponse.assumptions.map((a, i) => (
                          <li key={i} data-testid={`text-assumption-${i}`}>• {a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </Card>
      )}

      {aiResponse && visibleAiModifiers.length === 0 && (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground italic">
            All AI suggestions have been addressed.
          </div>
          {(aiResponse.warnings.length > 0 || aiResponse.assumptions.length > 0) && (
            <Collapsible open={showInfoSection} onOpenChange={setShowInfoSection}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" data-testid="button-toggle-ai-info-standalone">
                <Info className="h-3 w-3" />
                <span>Warnings & Assumptions</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${showInfoSection ? "rotate-180" : ""}`} />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 space-y-2">
                {aiResponse.warnings.length > 0 && (
                  <div className="p-2 rounded bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800">
                    <div className="flex items-center gap-1 text-xs font-medium text-yellow-700 dark:text-yellow-400 mb-1">
                      <AlertTriangle className="h-3 w-3" />
                      Warnings
                    </div>
                    <ul className="text-xs text-yellow-600 dark:text-yellow-300 space-y-0.5">
                      {aiResponse.warnings.map((w, i) => (
                        <li key={i}>• {w}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {aiResponse.assumptions.length > 0 && (
                  <div className="p-2 rounded bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                    <div className="flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-400 mb-1">
                      <Info className="h-3 w-3" />
                      Assumptions
                    </div>
                    <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-0.5">
                      {aiResponse.assumptions.map((a, i) => (
                        <li key={i}>• {a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      )}

      {suggested.length > 0 && (() => {
        const filteredSuggested = suggested.filter(s => {
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          return s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q) || s.categoryName.toLowerCase().includes(q);
        });
        if (filteredSuggested.length === 0) return null;
        return (
          <Card className="border-green-200 dark:border-green-800 bg-green-50/30 dark:bg-green-950/10">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-sm flex items-center gap-2 text-green-700 dark:text-green-400">
                <Lightbulb className="h-4 w-4" />
                Scope-Suggested Modifiers
                <Badge variant="outline" className="ml-auto text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-300 dark:border-green-700">
                  {filteredSuggested.length} suggested
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-1">
              {filteredSuggested.map(s => {
                const mod: LayerModifier = {
                  id: s.id,
                  categoryId: "",
                  categoryName: s.categoryName,
                  name: s.name,
                  code: s.code,
                  displayOrder: 0,
                };
                return (
                  <div key={s.id} title={s.matchPattern}>
                    {renderModifierItem(mod, "suggested")}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {tradeData.length > 0 && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10">
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm flex items-center gap-2 text-blue-700 dark:text-blue-400">
              <Building2 className="h-4 w-4" />
              Trade Modifiers
              <Badge variant="outline" className="text-xs ml-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-300 dark:border-blue-700">
                {modifierData?.tradeType}
              </Badge>
              {tradeData.reduce((acc, c) => acc + filterModifiers(c.modifiers).filter(m => selections.has(m.id)).length, 0) > 0 && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  {tradeData.reduce((acc, c) => acc + filterModifiers(c.modifiers).filter(m => selections.has(m.id)).length, 0)} selected
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {tradeData.map(cat => renderCategoryAccordion(cat, "trade", filterModifiers(cat.modifiers)))}
          </CardContent>
        </Card>
      )}
      {tradeData.length === 0 && !isLoading && (
        <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-950/10">
          <CardContent className="py-4 text-center">
            <p className="text-sm text-muted-foreground">No trade modifiers available for this trade type.</p>
          </CardContent>
        </Card>
      )}

      {universal.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              Universal Modifiers
              {universal.reduce((acc, c) => acc + filterModifiers(c.modifiers).filter(m => selections.has(m.id)).length, 0) > 0 && (
                <Badge variant="secondary" className="ml-auto text-xs">
                  {universal.reduce((acc, c) => acc + filterModifiers(c.modifiers).filter(m => selections.has(m.id)).length, 0)} selected
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1">
            {universal.map(cat => renderCategoryAccordion(cat, "universal", filterModifiers(cat.modifiers)))}
          </CardContent>
        </Card>
      )}

      {selectedCount > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-medium flex items-center gap-1.5">
                  <ArrowUpRight className="h-4 w-4 text-primary" />
                  {selectedCount} modifier{selectedCount !== 1 ? "s" : ""} selected
                </div>
                {Object.keys(costSummary).length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(costSummary).map(([type, pct]) => (
                      <span key={type} className={pct > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
                        {type.charAt(0).toUpperCase() + type.slice(1)} {pct > 0 ? "+" : ""}{pct.toFixed(0)}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {selections.size > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selections.values()).slice(0, 5).map(sel => (
                      <Badge
                        key={sel.modifierId}
                        variant="secondary"
                        className="text-xs cursor-pointer hover:bg-destructive/20 gap-1"
                        onClick={() => removeSelection(sel.modifierId)}
                        data-testid={`badge-selected-${sel.modifierId}`}
                      >
                        {sel.modifierName}
                        <X className="h-3 w-3" />
                      </Badge>
                    ))}
                    {selections.size > 5 && (
                      <Badge variant="outline" className="text-xs">
                        +{selections.size - 5} more
                      </Badge>
                    )}
                  </div>
                )}
                {canPersist && saveMutation.isPending && (
                  <span className="text-xs text-muted-foreground" data-testid="status-modifier-auto-saving">Saving...</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={customDialogOpen} onOpenChange={setCustomDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Modifier</DialogTitle>
            <DialogDescription>
              Create a one-off modifier for this scope item.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Modifier Name</Label>
              <Input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="e.g., Heavy Reinforcement"
                data-testid="input-custom-modifier-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Input
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="e.g., Reinforcement"
                data-testid="input-custom-modifier-category"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Cost Factor</Label>
                <Input
                  type="number"
                  min="0.5"
                  max="3.0"
                  step="0.05"
                  value={customFactor}
                  onChange={(e) => setCustomFactor(e.target.value)}
                  data-testid="input-custom-modifier-factor"
                />
              </div>
              <div className="space-y-2">
                <Label>Cost Impact</Label>
                <Select value={customCostType} onValueChange={setCustomCostType}>
                  <SelectTrigger data-testid="select-custom-modifier-cost-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COST_IMPACT_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCustomDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleAddCustom} disabled={!customName.trim()} data-testid="button-confirm-custom-modifier">
              Add Modifier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
