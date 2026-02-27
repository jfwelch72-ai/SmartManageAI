import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

interface Trade {
  trade_id: string;
  trade_name: string;
  trade_category: string;
  aliases: string[];
  default_scope_tags: string[];
}

interface Scope {
  scope_id: string;
  trade_id: string;
  trade_name: string;
  category: string;
  scope_name: string;
  uom: string;
  required_parameters: string[];
  optional_parameters: string[];
  material_families: string[];
  quantity_formula_id: string;
  labor_formula_id: string;
  duration_formula_id: string;
  line_item_name_pattern: string;
}

interface MaterialFamily {
  material_family_id: string;
  display_name: string;
  group: string;
  canonical_uom: string;
  attributes: string[];
  notes: string;
}

interface ComponentWithVariants {
  component_id: string;
  display_name: string;
  description: string;
  applicable_scope_ids: string[];
  trade_id: string;
  trade_name: string;
  variants: Variant[];
}

interface Variant {
  variant_id: string;
  display_name: string;
  qualifiers: Record<string, string>;
  default_parameters: Record<string, number | string>;
}

interface LibraryDataResponse {
  tradeType: string;
  trades: Trade[];
  scopes: Scope[];
  components: ComponentWithVariants[];
  materials: {
    groups: string[];
    materials: MaterialFamily[];
  };
}

export type { Trade, Scope, MaterialFamily, ComponentWithVariants, Variant, LibraryDataResponse };

export function useLibraryData() {
  const { data, isLoading, error } = useQuery<LibraryDataResponse>({
    queryKey: ["/api/onboarding-library/for-org"],
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });

  return {
    trades: data?.trades ?? [],
    scopes: data?.scopes ?? [],
    components: data?.components ?? [],
    materials: data?.materials?.materials ?? [],
    materialGroups: data?.materials?.groups ?? [],
    tradeType: data?.tradeType ?? "",
    isLoading,
    error,
  };
}

export function useLibraryScopes(searchTerm?: string) {
  const { scopes, isLoading, tradeType } = useLibraryData();

  const filteredScopes = useMemo(() => {
    if (!searchTerm || searchTerm.trim() === "") return scopes;
    const lower = searchTerm.toLowerCase();
    return scopes.filter(
      s =>
        s.scope_name.toLowerCase().includes(lower) ||
        s.category.toLowerCase().includes(lower) ||
        s.trade_name.toLowerCase().includes(lower) ||
        s.scope_id.toLowerCase().includes(lower)
    );
  }, [scopes, searchTerm]);

  const groupedByTrade = useMemo(() => {
    const groups: Record<string, { trade_name: string; scopes: Scope[] }> = {};
    filteredScopes.forEach(s => {
      if (!groups[s.trade_id]) {
        groups[s.trade_id] = { trade_name: s.trade_name, scopes: [] };
      }
      groups[s.trade_id].scopes.push(s);
    });
    return Object.entries(groups)
      .map(([trade_id, data]) => ({ trade_id, ...data }))
      .sort((a, b) => a.trade_name.localeCompare(b.trade_name));
  }, [filteredScopes]);

  return { scopes: filteredScopes, groupedByTrade, isLoading, tradeType };
}
