import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export interface MissingWageDecision {
  projectId: string;
  projectName: string;
  wageDecision: string;
}

interface MissingWageDecisionsResponse {
  items: MissingWageDecision[];
}

export function MissingWageDecisionsBanner() {
  const { toast } = useToast();
  const { data } = useQuery<MissingWageDecisionsResponse>({
    queryKey: ["/api/payroll/missing-wage-decisions"],
  });

  const importDecisionMutation = useMutation({
    mutationFn: async (decisionNumber: string) => {
      const resp = await apiRequest("POST", "/api/payroll/wage-decisions/sync", {
        decisionNumber,
      });
      return (await resp.json()) as { status: string; decisionNumber: string };
    },
    onSuccess: (result) => {
      const alreadyCached = result.status === "cached";
      toast({
        title: alreadyCached ? "Wage decision already imported" : "Wage decision imported",
        description: alreadyCached
          ? `${result.decisionNumber} was already cached from the DOL feed.`
          : `${result.decisionNumber} is now cached from the DOL feed.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/missing-wage-decisions"] });
    },
    onError: (err) => {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });

  const items = data?.items ?? [];
  if (items.length === 0) return null;

  const pendingDecision = importDecisionMutation.isPending
    ? importDecisionMutation.variables
    : null;

  return (
    <div
      className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg"
      data-testid="banner-payroll-missing-wage-decisions"
    >
      <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
      <div className="flex-1 text-sm text-red-700 dark:text-red-300">
        <p className="font-medium" data-testid="text-missing-wage-decisions-title">
          {items.length === 1
            ? "1 project references a wage decision that hasn't been imported"
            : `${items.length} projects reference wage decisions that haven't been imported`}
        </p>
        <ul className="mt-1 space-y-1">
          {items.map((m, i) => {
            const isPending = pendingDecision === m.wageDecision;
            return (
              <li
                key={`${m.projectId}-${m.wageDecision}`}
                className="flex flex-wrap items-center gap-2"
                data-testid={`text-payroll-missing-decision-${i}`}
              >
                <span>
                  {m.projectName ? `${m.projectName}: ` : ""}
                  <span className="font-mono">{m.wageDecision}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs"
                  disabled={importDecisionMutation.isPending}
                  onClick={() => importDecisionMutation.mutate(m.wageDecision)}
                  data-testid={`button-payroll-import-decision-${i}`}
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Importing…
                    </>
                  ) : (
                    "Import now"
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <Link
            href="/integrations"
            className="inline-flex items-center gap-1 underline hover:no-underline"
            data-testid="link-davis-bacon-import"
          >
            Open the Davis-Bacon (DOL/SAM.gov) integration
            <ExternalLink className="w-3 h-3" />
          </Link>
          <span>to connect a feed and run an import before generating certified payroll.</span>
        </div>
      </div>
    </div>
  );
}
