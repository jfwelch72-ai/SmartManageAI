import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  FileText, RefreshCw, Mail, Download, Calendar, Clock,
  TrendingUp, TrendingDown, AlertTriangle, CheckCircle, 
  Lightbulb, Target, DollarSign, Users
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface DigestSection {
  title: string;
  icon: 'financial' | 'operational' | 'risk' | 'opportunity';
  summary: string;
  bullets: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
}

interface ExecutiveDigest {
  id: number;
  generatedAt: string;
  period: 'daily' | 'weekly' | 'monthly';
  executiveSummary: string;
  keyHighlights: string[];
  sections: DigestSection[];
  actionItems: {
    priority: 'high' | 'medium' | 'low';
    description: string;
    dueBy?: string;
  }[];
  kpiSnapshot: {
    name: string;
    current: number;
    previous: number;
    unit: string;
    trend: 'up' | 'down' | 'stable';
  }[];
}

function SectionIcon({ icon }: { icon: DigestSection['icon'] }) {
  switch (icon) {
    case 'financial':
      return <DollarSign className="h-5 w-5 text-green-500" />;
    case 'operational':
      return <Target className="h-5 w-5 text-blue-500" />;
    case 'risk':
      return <AlertTriangle className="h-5 w-5 text-red-500" />;
    case 'opportunity':
      return <Lightbulb className="h-5 w-5 text-yellow-500" />;
    default:
      return <FileText className="h-5 w-5" />;
  }
}

function DigestSectionCard({ section }: { section: DigestSection }) {
  const sentimentColors = {
    positive: 'border-l-green-500',
    neutral: 'border-l-blue-500',
    negative: 'border-l-red-500'
  };

  return (
    <Card className={`border-l-4 ${sentimentColors[section.sentiment]}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <SectionIcon icon={section.icon} />
          {section.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">{section.summary}</p>
        <ul className="space-y-1">
          {section.bullets.map((bullet, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-primary mt-1">•</span>
              {bullet}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default function ExecutiveDigestPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [selectedPeriod, setSelectedPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const { data: digest, isLoading, refetch } = useQuery<ExecutiveDigest>({
    queryKey: ["/api/executive/digest", selectedPeriod],
    enabled: !!user && (user.role === 'ADMIN' || user.role === 'MANAGER' || user.role === 'HUSTLER'),
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      return apiRequest('POST', `/api/executive/digest/generate`, { period: selectedPeriod });
    },
    onSuccess: () => {
      toast({ title: "Digest generated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/executive/digest"], exact: false });
    },
    onError: () => {
      toast({ title: "Failed to generate digest", variant: "destructive" });
    }
  });

  if (!user) {
    return (
      <div className="min-h-screen bg-background p-8 text-center">
        <p className="text-muted-foreground">Please log in to view executive digest</p>
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <FileText className="h-6 w-6" />
            Executive Digest
          </h1>
          <p className="text-muted-foreground">AI-generated business intelligence summary</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs value={selectedPeriod} onValueChange={(v) => setSelectedPeriod(v as typeof selectedPeriod)}>
            <TabsList>
              <TabsTrigger value="daily" data-testid="tab-daily">Daily</TabsTrigger>
              <TabsTrigger value="weekly" data-testid="tab-weekly">Weekly</TabsTrigger>
              <TabsTrigger value="monthly" data-testid="tab-monthly">Monthly</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            data-testid="button-generate-digest"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
            Generate New
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      ) : !digest ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2" data-testid="text-no-digest">No digest available for this period</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Click "Generate New" to create an AI-powered executive digest for the selected {selectedPeriod} period.
            </p>
            <Button 
              variant="default" 
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              data-testid="button-generate-first-digest"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? 'animate-spin' : ''}`} />
              Generate Digest
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-gradient-to-r from-primary/10 to-primary/5">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Executive Summary</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  {new Date(digest.generatedAt).toLocaleString()}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed">{digest.executiveSummary}</p>
              <div className="flex flex-wrap gap-2">
                {digest.keyHighlights.map((highlight, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {highlight}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {digest.kpiSnapshot.map((kpi, i) => (
              <Card key={i}>
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">{kpi.name}</p>
                  <p className="text-xl font-bold">
                    {kpi.unit === '$' ? `$${(kpi.current / 1000).toFixed(0)}K` : `${kpi.current}${kpi.unit}`}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    {kpi.trend === 'up' && <TrendingUp className="h-3 w-3 text-green-500" />}
                    {kpi.trend === 'down' && <TrendingDown className="h-3 w-3 text-red-500" />}
                    <span className={`text-xs ${kpi.trend === 'up' ? 'text-green-500' : kpi.trend === 'down' ? 'text-red-500' : 'text-muted-foreground'}`}>
                      vs {kpi.unit === '$' ? `$${(kpi.previous / 1000).toFixed(0)}K` : `${kpi.previous}${kpi.unit}`}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <h2 className="text-lg font-semibold">Detailed Analysis</h2>
              {digest.sections.map((section, i) => (
                <DigestSectionCard key={i} section={section} />
              ))}
            </div>

            <div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Action Items
                  </CardTitle>
                  <CardDescription>Items requiring your attention</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-3">
                      {digest.actionItems.map((item, i) => (
                        <div 
                          key={i} 
                          className="p-3 rounded-lg border bg-card"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="text-sm">{item.description}</p>
                              {item.dueBy && (
                                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Due: {item.dueBy}
                                </p>
                              )}
                            </div>
                            <Badge 
                              variant={
                                item.priority === 'high' ? 'destructive' : 
                                item.priority === 'medium' ? 'secondary' : 'outline'
                              }
                              className="text-xs"
                            >
                              {item.priority}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
