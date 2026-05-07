import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Archive, ClipboardList, FileCheck2, AlertTriangle } from "lucide-react";

type Dashboard = {
  submittals: { total: number; open: number; overdue: number };
  punchList: { total: number; open: number; overdue: number; verified: number; percentComplete: number };
  closeout: { hasChecklist: boolean; total: number; complete: number; percentComplete: number };
};

interface Props {
  projectCode: string;
  onOpenCloseout?: () => void;
  onOpenPunchList?: () => void;
  onOpenSubmittals?: () => void;
}

function Bar({ pct }: { pct: number }) {
  const v = Math.max(0, Math.min(100, pct));
  return (
    <div className="w-full h-1.5 mt-2 rounded bg-muted overflow-hidden">
      <div className="h-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  );
}

export default function CloseoutReadinessCard({ projectCode, onOpenCloseout, onOpenPunchList, onOpenSubmittals }: Props) {
  const query = useQuery<Dashboard>({
    queryKey: ["/api/projects", projectCode, "closeout/dashboard"],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${encodeURIComponent(projectCode)}/closeout/dashboard`, { credentials: "include" });
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      return (await r.json()) as Dashboard;
    },
  });
  const data = query.data;
  const isLoading = query.isLoading;

  return (
    <Card data-testid="card-closeout-readiness">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Archive className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Closeout Readiness</CardTitle>
        </div>
        <CardDescription>Submittals, punch list, and closeout package status at a glance.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !data ? (
          <div className="text-sm text-muted-foreground" data-testid="text-closeout-loading">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-md border p-3" data-testid="tile-submittals">
              <div className="flex items-center gap-2 mb-1">
                <FileCheck2 className="h-4 w-4" />
                <span className="text-sm font-medium">Submittals</span>
              </div>
              <div className="text-2xl font-semibold" data-testid="text-submittals-open">{data.submittals.open}</div>
              <div className="text-xs text-muted-foreground">open / {data.submittals.total} total</div>
              {data.submittals.overdue > 0 ? (
                <Badge variant="destructive" className="mt-2" data-testid="badge-submittals-overdue">
                  <AlertTriangle className="h-3 w-3 mr-1" />{data.submittals.overdue} overdue
                </Badge>
              ) : null}
              {onOpenSubmittals ? (
                <Button variant="ghost" size="sm" className="px-0 mt-1 h-auto text-primary" onClick={onOpenSubmittals} data-testid="button-open-submittals">View</Button>
              ) : null}
            </div>

            <div className="rounded-md border p-3" data-testid="tile-punch-list">
              <div className="flex items-center gap-2 mb-1">
                <ClipboardList className="h-4 w-4" />
                <span className="text-sm font-medium">Punch List</span>
              </div>
              <div className="text-2xl font-semibold" data-testid="text-punch-open">{data.punchList.open}</div>
              <div className="text-xs text-muted-foreground">open / {data.punchList.total} total · {data.punchList.verified} verified</div>
              <Bar pct={data.punchList.percentComplete} />
              {data.punchList.overdue > 0 ? (
                <Badge variant="destructive" className="mt-2" data-testid="badge-punch-overdue">
                  <AlertTriangle className="h-3 w-3 mr-1" />{data.punchList.overdue} overdue
                </Badge>
              ) : null}
              {onOpenPunchList ? (
                <Button variant="ghost" size="sm" className="px-0 mt-1 h-auto text-primary" onClick={onOpenPunchList} data-testid="button-open-punch-list">View</Button>
              ) : null}
            </div>

            <div className="rounded-md border p-3" data-testid="tile-closeout">
              <div className="flex items-center gap-2 mb-1">
                <Archive className="h-4 w-4" />
                <span className="text-sm font-medium">Closeout Package</span>
              </div>
              {data.closeout.hasChecklist ? (
                <>
                  <div className="text-2xl font-semibold" data-testid="text-closeout-percent">{data.closeout.percentComplete}%</div>
                  <div className="text-xs text-muted-foreground">{data.closeout.complete} / {data.closeout.total} items complete</div>
                  <Bar pct={data.closeout.percentComplete} />
                </>
              ) : (
                <div className="text-sm text-muted-foreground" data-testid="text-closeout-not-initialized">Not initialized</div>
              )}
              {onOpenCloseout ? (
                <Button variant="ghost" size="sm" className="px-0 mt-1 h-auto text-primary" onClick={onOpenCloseout} data-testid="button-open-closeout">Open</Button>
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
