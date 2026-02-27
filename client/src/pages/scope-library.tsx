import { useState, useMemo } from "react";
import { useLibraryData, type Scope, type ComponentWithVariants, type MaterialFamily } from "@/hooks/use-library-data";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, BookOpen, Layers, Package, ChevronDown, ChevronRight, Wrench } from "lucide-react";

export default function ScopeLibraryPage() {
  const { trades, scopes, components, materials, materialGroups, tradeType, isLoading } = useLibraryData();
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("scopes");
  const [expandedTrades, setExpandedTrades] = useState<Set<string>>(new Set());
  const [expandedComponents, setExpandedComponents] = useState<Set<string>>(new Set());
  const [expandedMaterialGroups, setExpandedMaterialGroups] = useState<Set<string>>(new Set());

  const lowerSearch = searchTerm.toLowerCase().trim();

  const filteredScopes = useMemo(() => {
    if (!lowerSearch) return scopes;
    return scopes.filter(
      s =>
        s.scope_name.toLowerCase().includes(lowerSearch) ||
        s.category.toLowerCase().includes(lowerSearch) ||
        s.trade_name.toLowerCase().includes(lowerSearch) ||
        s.uom.toLowerCase().includes(lowerSearch) ||
        s.material_families.some(mf => mf.toLowerCase().includes(lowerSearch))
    );
  }, [scopes, lowerSearch]);

  const scopesByTrade = useMemo(() => {
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

  const filteredComponents = useMemo(() => {
    if (!lowerSearch) return components;
    return components.filter(
      c =>
        c.display_name.toLowerCase().includes(lowerSearch) ||
        (c.description || "").toLowerCase().includes(lowerSearch) ||
        c.trade_name.toLowerCase().includes(lowerSearch) ||
        c.variants.some(v => v.display_name.toLowerCase().includes(lowerSearch))
    );
  }, [components, lowerSearch]);

  const filteredMaterials = useMemo(() => {
    if (!lowerSearch) return materials;
    return materials.filter(
      m =>
        m.display_name.toLowerCase().includes(lowerSearch) ||
        m.group.toLowerCase().includes(lowerSearch) ||
        m.canonical_uom.toLowerCase().includes(lowerSearch)
    );
  }, [materials, lowerSearch]);

  const materialsByGroup = useMemo(() => {
    const groups: Record<string, MaterialFamily[]> = {};
    filteredMaterials.forEach(m => {
      if (!groups[m.group]) {
        groups[m.group] = [];
      }
      groups[m.group].push(m);
    });
    return Object.entries(groups)
      .map(([group, items]) => ({ group, items }))
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [filteredMaterials]);

  const toggleTrade = (tradeId: string) => {
    setExpandedTrades(prev => {
      const next = new Set(prev);
      if (next.has(tradeId)) next.delete(tradeId);
      else next.add(tradeId);
      return next;
    });
  };

  const toggleComponent = (componentId: string) => {
    setExpandedComponents(prev => {
      const next = new Set(prev);
      if (next.has(componentId)) next.delete(componentId);
      else next.add(componentId);
      return next;
    });
  };

  const toggleMaterialGroup = (group: string) => {
    setExpandedMaterialGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-6 max-w-6xl space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-full" />
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-scope-library-title">
            <BookOpen className="h-6 w-6" />
            Scope Library
          </h1>
          {tradeType && (
            <Badge variant="secondary" data-testid="badge-library-trade-type">
              <Wrench className="h-3 w-3 mr-1" />
              {tradeType.replace(/_/g, " ")}
            </Badge>
          )}
        </div>
        <div className="text-sm text-muted-foreground" data-testid="text-library-counts">
          {scopes.length} scopes &middot; {components.length} components &middot; {materials.length} materials
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search scopes, components, materials..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="pl-10"
          data-testid="input-library-search"
        />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="scopes" className="flex items-center gap-2" data-testid="tab-scopes">
            <Layers className="h-4 w-4" />
            Scopes
            <Badge variant="secondary" className="ml-1">{filteredScopes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="components" className="flex items-center gap-2" data-testid="tab-components">
            <Package className="h-4 w-4" />
            Components
            <Badge variant="secondary" className="ml-1">{filteredComponents.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="materials" className="flex items-center gap-2" data-testid="tab-materials">
            <Wrench className="h-4 w-4" />
            Materials
            <Badge variant="secondary" className="ml-1">{filteredMaterials.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="scopes">
          {scopesByTrade.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-scopes">
                No scopes found{lowerSearch ? ` matching "${searchTerm}"` : ""}.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {scopesByTrade.map(group => {
                const isExpanded = expandedTrades.has(group.trade_id);
                return (
                  <Card key={group.trade_id} data-testid={`card-trade-${group.trade_id}`}>
                    <CardHeader
                      className="py-3 cursor-pointer hover-elevate"
                      onClick={() => toggleTrade(group.trade_id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleTrade(group.trade_id); } }}
                      data-testid={`toggle-trade-${group.trade_id}`}
                    >
                      <CardTitle className="text-base flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {group.trade_name}
                        <Badge variant="secondary">{group.scopes.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2 pr-4 font-medium">Scope Name</th>
                                <th className="pb-2 pr-4 font-medium">Category</th>
                                <th className="pb-2 pr-4 font-medium">UOM</th>
                                <th className="pb-2 font-medium">Material Families</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.scopes.map(scope => (
                                <tr key={scope.scope_id} className="border-b last:border-0" data-testid={`row-scope-${scope.scope_id}`}>
                                  <td className="py-2 pr-4 font-medium">{scope.scope_name}</td>
                                  <td className="py-2 pr-4">
                                    <Badge variant="outline">{scope.category}</Badge>
                                  </td>
                                  <td className="py-2 pr-4">
                                    <Badge variant="secondary">{scope.uom}</Badge>
                                  </td>
                                  <td className="py-2">
                                    <div className="flex flex-wrap gap-1">
                                      {scope.material_families.length > 0 ? (
                                        scope.material_families.map(mf => (
                                          <Badge key={mf} variant="outline" className="text-xs">{mf}</Badge>
                                        ))
                                      ) : (
                                        <span className="text-muted-foreground text-xs">None</span>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="components">
          {filteredComponents.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-components">
                No components found{lowerSearch ? ` matching "${searchTerm}"` : ""}.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {filteredComponents.map(comp => {
                const isExpanded = expandedComponents.has(comp.component_id);
                const hasVariants = comp.variants && comp.variants.length > 0;
                return (
                  <Card key={comp.component_id} data-testid={`card-component-${comp.component_id}`}>
                    <CardHeader
                      className={`py-3 ${hasVariants ? "cursor-pointer hover-elevate" : ""}`}
                      onClick={() => hasVariants && toggleComponent(comp.component_id)}
                      role={hasVariants ? "button" : undefined}
                      tabIndex={hasVariants ? 0 : undefined}
                      aria-expanded={hasVariants ? isExpanded : undefined}
                      onKeyDown={hasVariants ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleComponent(comp.component_id); } } : undefined}
                      data-testid={`toggle-component-${comp.component_id}`}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          {hasVariants && (isExpanded ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />)}
                          <div>
                            <CardTitle className="text-base">{comp.display_name}</CardTitle>
                            {comp.description && (
                              <p className="text-sm text-muted-foreground mt-1">{comp.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary">{comp.trade_name}</Badge>
                          {hasVariants && <Badge variant="outline">{comp.variants.length} variants</Badge>}
                        </div>
                      </div>
                    </CardHeader>
                    {isExpanded && hasVariants && (
                      <CardContent>
                        <div className="space-y-2">
                          {comp.variants.map(variant => (
                            <div
                              key={variant.variant_id}
                              className="flex items-start justify-between p-3 rounded-md border bg-muted/30 gap-3 flex-wrap"
                              data-testid={`variant-${variant.variant_id}`}
                            >
                              <div>
                                <span className="font-medium text-sm">{variant.display_name}</span>
                                {Object.keys(variant.qualifiers).length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {Object.entries(variant.qualifiers).map(([key, val]) => (
                                      <Badge key={key} variant="outline" className="text-xs">
                                        {key}: {val}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {Object.keys(variant.default_parameters).length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {Object.entries(variant.default_parameters).map(([key, val]) => (
                                    <Badge key={key} variant="secondary" className="text-xs">
                                      {key}: {String(val)}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="materials">
          {materialsByGroup.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground" data-testid="text-no-materials">
                No materials found{lowerSearch ? ` matching "${searchTerm}"` : ""}.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {materialsByGroup.map(({ group, items }) => {
                const isExpanded = expandedMaterialGroups.has(group);
                return (
                  <Card key={group} data-testid={`card-material-group-${group.toLowerCase().replace(/\s+/g, "-")}`}>
                    <CardHeader
                      className="py-3 cursor-pointer hover-elevate"
                      onClick={() => toggleMaterialGroup(group)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleMaterialGroup(group); } }}
                      data-testid={`toggle-material-group-${group.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <CardTitle className="text-base flex items-center gap-2">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        {group}
                        <Badge variant="secondary">{items.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    {isExpanded && (
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-muted-foreground">
                                <th className="pb-2 pr-4 font-medium">Material</th>
                                <th className="pb-2 pr-4 font-medium">UOM</th>
                                <th className="pb-2 pr-4 font-medium">Attributes</th>
                                <th className="pb-2 font-medium">Notes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map(mat => (
                                <tr key={mat.material_family_id} className="border-b last:border-0" data-testid={`row-material-${mat.material_family_id}`}>
                                  <td className="py-2 pr-4 font-medium">{mat.display_name}</td>
                                  <td className="py-2 pr-4">
                                    <Badge variant="secondary">{mat.canonical_uom}</Badge>
                                  </td>
                                  <td className="py-2 pr-4">
                                    <div className="flex flex-wrap gap-1">
                                      {mat.attributes.length > 0 ? (
                                        mat.attributes.map(attr => (
                                          <Badge key={attr} variant="outline" className="text-xs">{attr}</Badge>
                                        ))
                                      ) : (
                                        <span className="text-muted-foreground text-xs">None</span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 text-muted-foreground text-xs">{mat.notes || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
