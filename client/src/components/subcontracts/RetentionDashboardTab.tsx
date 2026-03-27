import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Shield, DollarSign, CheckCircle2, Loader2 } from "lucide-react";

interface RetentionSummary {
  totals: {
    totalRetentionHeld: string;
    totalReleased: string;
    balanceRemaining: string;
  };
  contracts: Array<{
    contractId: string;
    contractNumber: string;
    subcontractorName: string;
    projectName: string;
    retentionPercent: string;
    totalRetentionHeld: string;
    totalReleased: string;
    balanceRemaining: string;
  }>;
}

export function RetentionDashboardTab() {
  const fmt = (v: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(typeof v === "string" ? parseFloat(v) : v);

  const { data, isLoading, isError, error, refetch } = useQuery<RetentionSummary>({
    queryKey: ["/api/subcontracts/retention/summary"],
    retry: 1,
  });

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading retention data...</div>;
  }

  if (isError) {
    return <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground"><p>Failed to load retention summary.</p>{error?.message && <p className="text-sm">{error.message}</p>}<Button variant="outline" onClick={() => refetch()}>Retry</Button></div>;
  }

  const totals = data?.totals;
  const contracts = data?.contracts || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-total-retention-held">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><Shield className="h-4 w-4" />Total Retention Held</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{fmt(totals?.totalRetentionHeld || "0")}</p></CardContent>
        </Card>
        <Card data-testid="card-total-released">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Total Released</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-green-600">{fmt(totals?.totalReleased || "0")}</p></CardContent>
        </Card>
        <Card data-testid="card-total-balance">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground flex items-center gap-2"><DollarSign className="h-4 w-4" />Balance Remaining</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-yellow-600">{fmt(totals?.balanceRemaining || "0")}</p></CardContent>
        </Card>
      </div>

      {contracts.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground">No retention data available. Retention is tracked when subcontractor pay applications are approved.</CardContent></Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Retention by Subcontractor</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contract</TableHead>
                  <TableHead>Subcontractor</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-center">Rate</TableHead>
                  <TableHead className="text-right">Held</TableHead>
                  <TableHead className="text-right">Released</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contracts.map(c => (
                  <TableRow key={c.contractId} data-testid={`row-retention-${c.contractId}`}>
                    <TableCell className="font-mono text-sm">{c.contractNumber}</TableCell>
                    <TableCell className="font-medium">{c.subcontractorName}</TableCell>
                    <TableCell>{c.projectName}</TableCell>
                    <TableCell className="text-center">{c.retentionPercent}%</TableCell>
                    <TableCell className="text-right">{fmt(c.totalRetentionHeld)}</TableCell>
                    <TableCell className="text-right text-green-600">{fmt(c.totalReleased)}</TableCell>
                    <TableCell className="text-right font-semibold text-yellow-600">{fmt(c.balanceRemaining)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
