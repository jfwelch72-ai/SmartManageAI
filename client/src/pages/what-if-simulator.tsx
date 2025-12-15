import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Calculator, Play, Save, RotateCcw, TrendingUp, TrendingDown,
  DollarSign, Users, Clock, Building2, AlertTriangle, CheckCircle,
  Zap, Target, ArrowRight
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface ScenarioParameter {
  id: string;
  name: string;
  currentValue: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  category: 'revenue' | 'cost' | 'efficiency' | 'growth';
}

interface SimulationResult {
  metric: string;
  current: number;
  projected: number;
  change: number;
  changePercent: number;
  impact: 'positive' | 'negative' | 'neutral';
}

interface SavedScenario {
  id: number;
  name: string;
  parameters: Record<string, number>;
  createdAt: string;
}

const defaultParameters: ScenarioParameter[] = [
  { id: 'bidWinRate', name: 'Bid Win Rate', currentValue: 34, min: 10, max: 60, step: 1, unit: '%', category: 'growth' },
  { id: 'avgProjectValue', name: 'Avg Project Value', currentValue: 150000, min: 50000, max: 500000, step: 10000, unit: '$', category: 'revenue' },
  { id: 'laborCostChange', name: 'Labor Cost Change', currentValue: 0, min: -20, max: 20, step: 1, unit: '%', category: 'cost' },
  { id: 'materialCostChange', name: 'Material Cost Change', currentValue: 0, min: -20, max: 20, step: 1, unit: '%', category: 'cost' },
  { id: 'crewSize', name: 'Crew Size', currentValue: 45, min: 20, max: 100, step: 1, unit: 'people', category: 'efficiency' },
  { id: 'productivityGain', name: 'Productivity Gain', currentValue: 0, min: -10, max: 30, step: 1, unit: '%', category: 'efficiency' },
  { id: 'overheadReduction', name: 'Overhead Reduction', currentValue: 0, min: 0, max: 25, step: 1, unit: '%', category: 'cost' },
  { id: 'newMarkets', name: 'New Markets Entered', currentValue: 0, min: 0, max: 5, step: 1, unit: '', category: 'growth' },
];

function formatValue(value: number, unit: string): string {
  if (unit === '$') {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value}`;
  }
  return `${value}${unit}`;
}

function ParameterSlider({ 
  param, 
  value, 
  onChange 
}: { 
  param: ScenarioParameter; 
  value: number; 
  onChange: (value: number) => void;
}) {
  const categoryColors = {
    revenue: 'text-green-500',
    cost: 'text-red-500',
    efficiency: 'text-blue-500',
    growth: 'text-purple-500'
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className={`text-sm ${categoryColors[param.category]}`}>
          {param.name}
        </Label>
        <span className="text-sm font-medium">
          {formatValue(value, param.unit)}
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(v) => onChange(v[0])}
        min={param.min}
        max={param.max}
        step={param.step}
        className="w-full"
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatValue(param.min, param.unit)}</span>
        <span>{formatValue(param.max, param.unit)}</span>
      </div>
    </div>
  );
}

function ResultCard({ result }: { result: SimulationResult }) {
  const impactColors = {
    positive: 'border-l-green-500 bg-green-500/5',
    negative: 'border-l-red-500 bg-red-500/5',
    neutral: 'border-l-blue-500 bg-blue-500/5'
  };

  return (
    <div className={`p-4 rounded-lg border-l-4 ${impactColors[result.impact]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{result.metric}</span>
        {result.impact === 'positive' && <TrendingUp className="h-4 w-4 text-green-500" />}
        {result.impact === 'negative' && <TrendingDown className="h-4 w-4 text-red-500" />}
      </div>
      <div className="mt-2 flex items-end gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Current</p>
          <p className="text-lg font-semibold">{formatValue(result.current, '$')}</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground mb-2" />
        <div>
          <p className="text-xs text-muted-foreground">Projected</p>
          <p className="text-lg font-semibold">{formatValue(result.projected, '$')}</p>
        </div>
        <Badge 
          variant={result.impact === 'positive' ? 'default' : result.impact === 'negative' ? 'destructive' : 'secondary'}
          className="ml-auto"
        >
          {result.changePercent > 0 ? '+' : ''}{result.changePercent.toFixed(1)}%
        </Badge>
      </div>
    </div>
  );
}

export default function WhatIfSimulatorPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [parameters, setParameters] = useState<Record<string, number>>(
    Object.fromEntries(defaultParameters.map(p => [p.id, p.currentValue]))
  );
  const [scenarioName, setScenarioName] = useState("");
  const [isSimulating, setIsSimulating] = useState(false);

  const { data: savedScenarios } = useQuery<SavedScenario[]>({
    queryKey: ["/api/executive/scenarios"],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'HUSTLER'),
  });

  const updateParameter = (id: string, value: number) => {
    setParameters(prev => ({ ...prev, [id]: value }));
  };

  const resetParameters = () => {
    setParameters(Object.fromEntries(defaultParameters.map(p => [p.id, p.currentValue])));
  };

  const runSimulation = async () => {
    setIsSimulating(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    setIsSimulating(false);
    toast({ title: "Simulation complete" });
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background p-8 text-center">
        <p className="text-muted-foreground">Please log in to access the simulator</p>
      </div>
    );
  }

  if (user.role !== 'ADMIN' && user.role !== 'MANAGER' && user.role !== 'HUSTLER') {
    return (
      <div className="min-h-screen bg-background p-8 text-center">
        <p className="text-muted-foreground">Executive access required</p>
      </div>
    );
  }

  const calculateResults = (): SimulationResult[] => {
    const bidWinRateChange = (parameters.bidWinRate - 34) / 34;
    const avgValueChange = (parameters.avgProjectValue - 150000) / 150000;
    const laborChange = parameters.laborCostChange / 100;
    const materialChange = parameters.materialCostChange / 100;
    const productivityChange = parameters.productivityGain / 100;
    const overheadChange = parameters.overheadReduction / 100;
    const crewChange = (parameters.crewSize - 45) / 45;
    const marketGrowth = parameters.newMarkets * 0.08;

    const baseRevenue = 2400000;
    const baseCosts = 2000000;
    const baseProfit = 400000;

    const revenueMultiplier = 1 + bidWinRateChange * 0.5 + avgValueChange * 0.3 + marketGrowth;
    const costMultiplier = 1 + laborChange * 0.4 + materialChange * 0.35 - productivityChange * 0.2 - overheadChange * 0.15 + crewChange * 0.3;

    const projectedRevenue = baseRevenue * revenueMultiplier;
    const projectedCosts = baseCosts * costMultiplier;
    const projectedProfit = projectedRevenue - projectedCosts;

    return [
      {
        metric: 'Annual Revenue',
        current: baseRevenue,
        projected: projectedRevenue,
        change: projectedRevenue - baseRevenue,
        changePercent: ((projectedRevenue - baseRevenue) / baseRevenue) * 100,
        impact: projectedRevenue > baseRevenue ? 'positive' : projectedRevenue < baseRevenue ? 'negative' : 'neutral'
      },
      {
        metric: 'Operating Costs',
        current: baseCosts,
        projected: projectedCosts,
        change: projectedCosts - baseCosts,
        changePercent: ((projectedCosts - baseCosts) / baseCosts) * 100,
        impact: projectedCosts < baseCosts ? 'positive' : projectedCosts > baseCosts ? 'negative' : 'neutral'
      },
      {
        metric: 'Net Profit',
        current: baseProfit,
        projected: projectedProfit,
        change: projectedProfit - baseProfit,
        changePercent: ((projectedProfit - baseProfit) / baseProfit) * 100,
        impact: projectedProfit > baseProfit ? 'positive' : projectedProfit < baseProfit ? 'negative' : 'neutral'
      },
      {
        metric: 'Profit Margin',
        current: (baseProfit / baseRevenue) * 100,
        projected: (projectedProfit / projectedRevenue) * 100,
        change: (projectedProfit / projectedRevenue) * 100 - (baseProfit / baseRevenue) * 100,
        changePercent: (((projectedProfit / projectedRevenue) - (baseProfit / baseRevenue)) / (baseProfit / baseRevenue)) * 100,
        impact: (projectedProfit / projectedRevenue) > (baseProfit / baseRevenue) ? 'positive' : 'negative'
      }
    ];
  };

  const results = calculateResults();

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Calculator className="h-6 w-6" />
            What-If Scenario Simulator
          </h1>
          <p className="text-muted-foreground">Model business scenarios and financial outcomes</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={resetParameters} data-testid="button-reset">
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button 
            size="sm" 
            onClick={runSimulation}
            disabled={isSimulating}
            data-testid="button-simulate"
          >
            <Play className={`h-4 w-4 mr-2 ${isSimulating ? 'animate-pulse' : ''}`} />
            {isSimulating ? 'Simulating...' : 'Run Simulation'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Scenario Parameters</CardTitle>
              <CardDescription>Adjust variables to model different business scenarios</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="growth">
                <TabsList className="mb-4">
                  <TabsTrigger value="growth" className="flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" />
                    Growth
                  </TabsTrigger>
                  <TabsTrigger value="revenue" className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3" />
                    Revenue
                  </TabsTrigger>
                  <TabsTrigger value="cost" className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Costs
                  </TabsTrigger>
                  <TabsTrigger value="efficiency" className="flex items-center gap-1">
                    <Zap className="h-3 w-3" />
                    Efficiency
                  </TabsTrigger>
                </TabsList>

                {['growth', 'revenue', 'cost', 'efficiency'].map(category => (
                  <TabsContent key={category} value={category} className="space-y-6">
                    {defaultParameters
                      .filter(p => p.category === category)
                      .map(param => (
                        <ParameterSlider
                          key={param.id}
                          param={param}
                          value={parameters[param.id]}
                          onChange={(v) => updateParameter(param.id, v)}
                        />
                      ))}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Projected Outcomes
              </CardTitle>
              <CardDescription>Financial impact based on current parameters</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {results.map((result, i) => (
                  <ResultCard key={i} result={result} />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Save Scenario</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Scenario Name</Label>
                <Input 
                  placeholder="e.g., Aggressive Growth Q1"
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  data-testid="input-scenario-name"
                />
              </div>
              <Button className="w-full" disabled={!scenarioName} data-testid="button-save-scenario">
                <Save className="h-4 w-4 mr-2" />
                Save Scenario
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saved Scenarios</CardTitle>
              <CardDescription>Load a previous scenario</CardDescription>
            </CardHeader>
            <CardContent>
              {savedScenarios && savedScenarios.length > 0 ? (
                <div className="space-y-2">
                  {savedScenarios.map(scenario => (
                    <Button 
                      key={scenario.id} 
                      variant="outline" 
                      className="w-full justify-start text-left"
                      onClick={() => setParameters(scenario.parameters)}
                    >
                      <Building2 className="h-4 w-4 mr-2" />
                      {scenario.name}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No saved scenarios yet</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                Quick Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {results[2].changePercent > 10 && (
                <div className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>Strong profit improvement projected ({results[2].changePercent.toFixed(1)}% gain)</span>
                </div>
              )}
              {results[2].changePercent < -10 && (
                <div className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                  <span>Significant profit reduction risk ({Math.abs(results[2].changePercent).toFixed(1)}% decline)</span>
                </div>
              )}
              {parameters.laborCostChange > 10 && (
                <div className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="h-4 w-4 text-yellow-500 mt-0.5" />
                  <span>High labor cost increase may impact margins</span>
                </div>
              )}
              {parameters.productivityGain > 15 && (
                <div className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-500 mt-0.5" />
                  <span>Significant productivity gains offset cost increases</span>
                </div>
              )}
              {parameters.bidWinRate > 45 && (
                <div className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-blue-500 mt-0.5" />
                  <span>High win rate drives revenue growth</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
