import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  Box,
  BrickWall,
  TreePine,
  Home,
  LayoutGrid,
  Square,
  Paintbrush,
  Mountain,
  Triangle,
  TrendingUp,
  Calculator,
  Users,
} from "lucide-react";
import UnitConverter from "@/components/calculators/UnitConverter";
import MasonryCalculator from "@/components/calculators/MasonryCalculator";
import LumberCalculator from "@/components/calculators/LumberCalculator";
import RoofingCalculator from "@/components/calculators/RoofingCalculator";
import TilingCalculator from "@/components/calculators/TilingCalculator";
import DrywallCalculator from "@/components/calculators/DrywallCalculator";
import PaintCalculator from "@/components/calculators/PaintCalculator";
import AggregatesCalculator from "@/components/calculators/AggregatesCalculator";
import GeometryCalculator from "@/components/calculators/GeometryCalculator";
import MaterialEstimatorCalculator from "@/components/calculators/MaterialEstimatorCalculator";
import ProfitMarginCalculator from "@/components/calculators/ProfitMarginCalculator";
import MarkupCalculator from "@/components/calculators/MarkupCalculator";
import LaborCostEstimator from "@/components/calculators/LaborCostEstimator";

const allCategories = [
  { id: "unit-converter", label: "Unit Converter", icon: ArrowLeftRight, component: UnitConverter },
  { id: "material-estimator", label: "Concrete & Materials", icon: Box, component: MaterialEstimatorCalculator },
  { id: "masonry", label: "Masonry", icon: BrickWall, component: MasonryCalculator },
  { id: "lumber", label: "Lumber & Framing", icon: TreePine, component: LumberCalculator },
  { id: "roofing", label: "Roofing", icon: Home, component: RoofingCalculator },
  { id: "tiling", label: "Tiling & Flooring", icon: LayoutGrid, component: TilingCalculator },
  { id: "drywall", label: "Drywall", icon: Square, component: DrywallCalculator },
  { id: "paint", label: "Paint & Coating", icon: Paintbrush, component: PaintCalculator },
  { id: "aggregates", label: "Aggregates", icon: Mountain, component: AggregatesCalculator },
  { id: "geometry", label: "Geometry", icon: Triangle, component: GeometryCalculator },
  { id: "profit-margin", label: "Profit Margin", icon: TrendingUp, component: ProfitMarginCalculator },
  { id: "markup", label: "Markup", icon: Calculator, component: MarkupCalculator },
  { id: "labor-cost", label: "Labor Cost", icon: Users, component: LaborCostEstimator },
];

const UNIVERSAL_CALCULATORS = ["unit-converter", "geometry", "profit-margin", "markup", "labor-cost"];

const TRADE_CALCULATOR_MAP: Record<string, string[]> = {
  GENERAL_CONTRACTOR: allCategories.map((c) => c.id),
  CONCRETE: ["material-estimator", "masonry", "aggregates"],
  MASONRY: ["masonry", "material-estimator", "aggregates"],
  ROOFING: ["roofing", "material-estimator", "lumber", "aggregates"],
  FRAMING: ["lumber", "material-estimator", "roofing"],
  DRYWALL: ["drywall", "paint", "material-estimator"],
  PAINTING: ["paint", "drywall"],
  FLOORING: ["tiling", "material-estimator"],
  TILE: ["tiling", "material-estimator", "masonry"],
  ELECTRICAL: ["material-estimator"],
  PLUMBING: ["material-estimator"],
  HVAC: ["material-estimator"],
  LANDSCAPING: ["material-estimator", "aggregates", "masonry"],
  DEMOLITION: ["material-estimator", "aggregates"],
  INSULATION: ["drywall", "lumber", "material-estimator"],
  WINDOWS_DOORS: ["lumber", "material-estimator"],
  SIDING: ["lumber", "material-estimator", "paint"],
  CABINETRY: ["lumber"],
  COUNTERTOPS: ["tiling", "material-estimator"],
  FENCING: ["material-estimator", "lumber", "aggregates"],
  DECKING: ["lumber", "material-estimator"],
  SOLAR: ["roofing", "material-estimator"],
  OTHER: allCategories.map((c) => c.id),
};

function getCalculatorsForTrade(tradeType: string | null | undefined): typeof allCategories {
  if (!tradeType) return allCategories;
  const tradeSpecific = TRADE_CALCULATOR_MAP[tradeType] || allCategories.map((c) => c.id);
  const allowedIds = new Set([...UNIVERSAL_CALCULATORS, ...tradeSpecific]);
  return allCategories.filter((c) => allowedIds.has(c.id));
}

export default function CalculatorPage() {
  const { data: tradeConfig } = useQuery<{ organization: { tradeType: string } }>({
    queryKey: ["/api/organization/trade-config"],
  });

  const tradeType = tradeConfig?.organization?.tradeType || null;
  const categories = useMemo(() => getCalculatorsForTrade(tradeType), [tradeType]);

  const [activeCategory, setActiveCategory] = useState<string>("unit-converter");

  const effectiveCategory = categories.some((c) => c.id === activeCategory)
    ? activeCategory
    : categories[0]?.id || "unit-converter";
  const active = categories.find((c) => c.id === effectiveCategory) ?? categories[0];
  const ActiveComponent = active.component;

  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8" data-testid="calculator-header">
          <h1 className="text-2xl font-bold text-foreground" data-testid="text-calculator-title">
            Construction Calculator
          </h1>
          <p className="text-muted-foreground mt-1" data-testid="text-calculator-description">
            Professional construction calculations with unit conversion, material estimating, and cost analysis
          </p>
        </div>

        <div className="md:hidden mb-4" data-testid="mobile-category-tabs">
          <div className="flex overflow-x-auto gap-2 pb-2 -mx-4 px-4 scrollbar-none">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isActive = effectiveCategory === cat.id;
              return (
                <Button
                  key={cat.id}
                  variant="ghost"
                  className={`shrink-0 toggle-elevate ${isActive ? "toggle-elevated" : ""}`}
                  onClick={() => setActiveCategory(cat.id)}
                  data-testid={`button-mobile-category-${cat.id}`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {cat.label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="hidden md:block w-64 shrink-0" data-testid="sidebar-categories">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Categories</CardTitle>
                <CardDescription>Select a calculator type</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-1">
                {categories.map((cat) => {
                  const Icon = cat.icon;
                  const isActive = effectiveCategory === cat.id;
                  return (
                    <Button
                      key={cat.id}
                      variant="ghost"
                      className={`justify-start toggle-elevate ${isActive ? "toggle-elevated" : ""}`}
                      onClick={() => setActiveCategory(cat.id)}
                      data-testid={`button-category-${cat.id}`}
                    >
                      <Icon className="w-4 h-4 mr-2" />
                      {cat.label}
                    </Button>
                  );
                })}
              </CardContent>
            </Card>
          </div>

          <div className="flex-1 min-w-0" data-testid="calculator-content">
            <ActiveComponent />
          </div>
        </div>
      </main>
    </div>
  );
}
