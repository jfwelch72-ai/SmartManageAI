import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText } from "lucide-react";

interface ProjectPayrollSummary {
  laborCostToDate: number;
  budget: number;
  laborVsBudget: number;
  totalRegularHours: number;
  totalOvertimeHours: number;
  overtimePercent: number;
  totalEntries: number;
  workers: { userId: string; name: string; role: string; regularHours: number; overtimeHours: number }[];
}

type PrevailingRateSource = "PROJECT_OVERRIDE" | "DOL_FEED";

interface PrevailingWageClassification {
  classificationId: string;
  classificationName: string;
  wageRate: number;
  fringeRate: number | null;
  totalRate: number | null;
  overtimeMultiplier: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  wageDecision: string | null;
  source: PrevailingRateSource;
}

interface PrevailingWageSummary {
  projectId: string;
  wageDecision: string | null;
  wageDecisionCached: boolean | null;
  classifications: PrevailingWageClassification[];
}

const formatCurrency = (val: number | null | undefined) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val || 0);

function SourceBadge({ source }: { source: PrevailingRateSource }) {
  if (source === "PROJECT_OVERRIDE") {
    return (
      <Badge variant="default" className="text-xs" data-testid={`badge-source-project-override`}>
        Project override
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="text-xs" data-testid={`badge-source-dol-feed`}>
      DOL feed
    </Badge>
  );
}

function PrevailingWagePanel({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery<PrevailingWageSummary>({
    queryKey: ["/api/projects", projectId, "prevailing-wage-summary"],
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="w-5 h-5" /> Prevailing Wage Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const showMissingWarning =
    !!data.wageDecision && data.wageDecisionCached === false;

  const overrideCount = data.classifications.filter(c => c.source === "PROJECT_OVERRIDE").length;
  const dolCount = data.classifications.filter(c => c.source === "DOL_FEED").length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5" /> Prevailing Wage Rates
        </CardTitle>
        <CardDescription>
          Source for each classification's rate. Project overrides take precedence over the cached DOL Davis-Bacon feed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.wageDecision && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Project wage decision:</span>
            <span className="font-mono font-medium" data-testid="text-project-wage-decision">
              {data.wageDecision}
            </span>
            {data.wageDecisionCached === true && (
              <Badge variant="outline" className="text-xs" data-testid="badge-decision-cached">
                Cached from DOL
              </Badge>
            )}
          </div>
        )}

        {showMissingWarning && (
          <div
            className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
            data-testid="banner-missing-wage-decision"
          >
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 dark:text-red-300">
              <p className="font-medium">
                Wage decision not yet imported from DOL
              </p>
              <p className="mt-1">
                <span className="font-mono">{data.wageDecision}</span> is referenced by this project but has not been
                synced. Run a Davis-Bacon sync so prevailing wage rates are applied automatically.
              </p>
            </div>
          </div>
        )}

        {data.classifications.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-no-pw-rates">
            No prevailing wage classifications resolved for this project.
            {data.wageDecision
              ? " Add project overrides or sync the wage decision from DOL."
              : " Set a wage decision on the project or add project-specific overrides."}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span data-testid="text-count-project-override">{overrideCount} project override{overrideCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span data-testid="text-count-dol-feed">{dolCount} from DOL feed</span>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Classification</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead className="text-right">Wage Rate</TableHead>
                    <TableHead className="text-right">Fringe</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Effective</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.classifications.map((c) => (
                    <TableRow key={c.classificationId} data-testid={`row-pw-classification-${c.classificationId}`}>
                      <TableCell className="font-medium">
                        <div>{c.classificationName}</div>
                        {c.wageDecision && c.source === "DOL_FEED" && (
                          <div className="text-[10px] text-muted-foreground font-mono mt-0.5" data-testid={`text-pw-decision-${c.classificationId}`}>
                            {c.wageDecision}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <SourceBadge source={c.source} />
                      </TableCell>
                      <TableCell className="text-right font-mono" data-testid={`text-pw-wage-rate-${c.classificationId}`}>
                        {formatCurrency(c.wageRate)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {c.fringeRate != null ? formatCurrency(c.fringeRate) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        {c.totalRate != null ? formatCurrency(c.totalRate) : "\u2014"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.effectiveDate || "\u2014"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ProjectPayrollTab({ projectId }: { projectId: string }) {
  const { data: summary, isLoading } = useQuery<ProjectPayrollSummary>({
    queryKey: ["/api/projects", projectId, "payroll-summary"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }

  if (!summary) {
    return <div className="text-center py-8 text-muted-foreground">No payroll data available</div>;
  }

  const budgetUsedPercent = summary.laborVsBudget;
  const budgetBarColor = budgetUsedPercent > 90 ? "bg-red-500" : budgetUsedPercent > 70 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor Cost to Date</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-cost">{formatCurrency(summary.laborCostToDate)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Labor vs Budget</p>
            <p className="text-2xl font-bold" data-testid="text-project-labor-budget">
              {summary.budget > 0 ? `${budgetUsedPercent.toFixed(1)}%` : "N/A"}
            </p>
            {summary.budget > 0 && (
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                <div className={`${budgetBarColor} h-2 rounded-full transition-all`} style={{ width: `${Math.min(budgetUsedPercent, 100)}%` }} />
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Overtime %</p>
            <p className="text-2xl font-bold" data-testid="text-project-overtime-pct">{summary.overtimePercent}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.totalOvertimeHours.toFixed(1)} OT / {(summary.totalRegularHours + summary.totalOvertimeHours).toFixed(1)} total hrs
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Workers Assigned</p>
            <p className="text-2xl font-bold" data-testid="text-project-workers">{summary.workers.length}</p>
            <p className="text-xs text-muted-foreground mt-1">{summary.totalEntries} time entries</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Workers on This Project</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.workers.length === 0 ? (
            <p className="text-center py-6 text-muted-foreground">No workers have logged time on this project</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Regular Hours</TableHead>
                  <TableHead>OT Hours</TableHead>
                  <TableHead>Total Hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.workers.map(w => (
                  <TableRow key={w.userId} data-testid={`row-project-worker-${w.userId}`}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{w.role}</Badge>
                    </TableCell>
                    <TableCell>{w.regularHours.toFixed(1)}</TableCell>
                    <TableCell>{w.overtimeHours > 0 ? w.overtimeHours.toFixed(1) : "\u2014"}</TableCell>
                    <TableCell className="font-medium">{(w.regularHours + w.overtimeHours).toFixed(1)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PrevailingWagePanel projectId={projectId} />
    </div>
  );
}
