import { Badge } from "@/components/ui/badge";
import { ReportHeader, Th, Td, EmptyState, fmt, fmtInt } from "./report-utils";

export function EstimateSummaryReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState message="No estimate data. Select a project with estimates using Data Filters." />;
  const totals = data.reduce((acc: any, r: any) => ({
    material: acc.material + (r.materialCost || 0),
    labor: acc.labor + (r.laborCost || 0),
    equipment: acc.equipment + (r.equipmentCost || 0),
    total: acc.total + (r.totalCost || 0),
  }), { material: 0, labor: 0, equipment: 0, total: 0 });

  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-estimate-summary">
        <ReportHeader>
          <Th className="text-left">Category</Th>
          <Th className="text-left">Description</Th>
          <Th className="text-right">Qty</Th>
          <Th className="text-left">Unit</Th>
          <Th className="text-right">Material</Th>
          <Th className="text-right">Labor</Th>
          <Th className="text-right">Equipment</Th>
          <Th className="text-right">Total Cost</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id || i} className="hover:bg-muted/30" data-testid={`row-estimate-${i}`}>
              <Td className="text-left"><Badge variant="outline" className="text-xs">{row.category}</Badge></Td>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-right font-mono">{fmtInt(row.quantity)}</Td>
              <Td className="text-left">{row.unit}</Td>
              <Td className="text-right font-mono">${fmt(row.materialCost)}</Td>
              <Td className="text-right font-mono">${fmt(row.laborCost)}</Td>
              <Td className="text-right font-mono">${fmt(row.equipmentCost)}</Td>
              <Td className="text-right font-mono font-medium">${fmt(row.totalCost)}</Td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <Td className="text-left" colSpan={4}>Totals</Td>
            <Td className="text-right font-mono">${fmt(totals.material)}</Td>
            <Td className="text-right font-mono">${fmt(totals.labor)}</Td>
            <Td className="text-right font-mono">${fmt(totals.equipment)}</Td>
            <Td className="text-right font-mono">${fmt(totals.total)}</Td>
          </tr>
        </tbody>
      </table>
      {isMobile && (
        <div className="p-3 space-y-2">
          {data.map((row: any, i: number) => (
            <div key={row.id || i} className="border rounded-lg p-3 space-y-2" data-testid={`card-estimate-${i}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{row.description}</p>
                  <Badge variant="outline" className="text-xs mt-0.5">{row.category}</Badge>
                </div>
                <p className="font-mono font-semibold text-sm flex-shrink-0">${fmt(row.totalCost)}</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Qty</span>
                  <span className="font-mono">{fmtInt(row.quantity)} {row.unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Material</span>
                  <span className="font-mono">${fmt(row.materialCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Labor</span>
                  <span className="font-mono">${fmt(row.laborCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Equipment</span>
                  <span className="font-mono">${fmt(row.equipmentCost)}</span>
                </div>
              </div>
            </div>
          ))}
          <div className="border-t pt-3 space-y-1 text-sm">
            <div className="flex justify-between font-semibold">
              <span>Grand Total</span>
              <span className="font-mono">${fmt(totals.total)}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div className="text-center">
                <p className="font-mono text-foreground">${fmt(totals.material)}</p>
                <p>Material</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-foreground">${fmt(totals.labor)}</p>
                <p>Labor</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-foreground">${fmt(totals.equipment)}</p>
                <p>Equipment</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function CostBreakdownReport({ data, isMobile }: { data: any; isMobile: boolean }) {
  const categories = data?.categories || [];
  const grandTotal = data?.grandTotal || 0;
  if (categories.length === 0) return <EmptyState message="No estimate data. Select a project with estimates using Data Filters." />;

  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-cost-breakdown">
        <ReportHeader>
          <Th className="text-left">Category</Th>
          <Th className="text-right">Subtotal</Th>
          <Th className="text-right">% of Total</Th>
        </ReportHeader>
        <tbody>
          {categories.map((row: any, i: number) => (
            <tr key={row.category || i} className="hover:bg-muted/30" data-testid={`row-breakdown-${i}`}>
              <Td className="text-left font-medium">{row.category}</Td>
              <Td className="text-right font-mono">${fmt(row.subtotal)}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <div className="w-16 bg-muted rounded-full h-2 overflow-hidden">
                    <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                  </div>
                  <span className="font-mono text-xs w-12 text-right">{row.percentage}%</span>
                </div>
              </Td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <Td className="text-left">Grand Total</Td>
            <Td className="text-right font-mono">${fmt(grandTotal)}</Td>
            <Td className="text-right font-mono">100%</Td>
          </tr>
        </tbody>
      </table>
      {isMobile && (
        <div className="p-3 space-y-2">
          {categories.map((row: any, i: number) => (
            <div key={row.category || i} className="border rounded-lg p-3" data-testid={`card-breakdown-${i}`}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium">{row.category}</span>
                <span className="font-mono font-semibold text-sm">${fmt(row.subtotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full transition-all" style={{ width: `${Math.min(row.percentage, 100)}%` }} />
                </div>
                <span className="text-xs font-mono w-12 text-right">{row.percentage}%</span>
              </div>
            </div>
          ))}
          <div className="border-t pt-2 flex items-center justify-between text-sm font-semibold">
            <span>Grand Total</span>
            <span className="font-mono">${fmt(grandTotal)}</span>
          </div>
        </div>
      )}
    </>
  );
}
