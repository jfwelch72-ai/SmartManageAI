import { useState, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ReportHeader, Th, Td, EmptyState, fmt, fmtInt } from "./report-utils";

export function ItemCostReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const grandTotal = data.reduce((s: number, r: any) => s + (r.totalCost || 0), 0);
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-item-cost">
        <ReportHeader>
          <Th className="text-left">Description</Th>
          <Th className="text-right">Quantity</Th>
          <Th className="text-right">Unit Cost</Th>
          <Th className="text-right">Total Cost</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id || i} className="hover:bg-muted/30" data-testid={`row-cost-${i}`}>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-right font-mono">{fmtInt(row.quantity)} {row.unit}</Td>
              <Td className="text-right font-mono">${fmt(row.unitCost)}</Td>
              <Td className="text-right font-mono font-medium">${fmt(row.totalCost)}</Td>
            </tr>
          ))}
          <tr className="bg-muted/40 font-semibold">
            <Td className="text-left" colSpan={3}>Grand Total</Td>
            <Td className="text-right font-mono">${fmt(grandTotal)}</Td>
          </tr>
        </tbody>
      </table>
      {isMobile && (
        <div className="p-3 space-y-2">
          {data.map((row: any, i: number) => (
            <div key={row.id || i} className="border rounded-lg p-3 space-y-1" data-testid={`card-cost-${i}`}>
              <p className="font-medium text-sm">{row.description}</p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Qty</span>
                  <p className="font-mono">{fmtInt(row.quantity)} {row.unit}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Unit Cost</span>
                  <p className="font-mono">${fmt(row.unitCost)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Total</span>
                  <p className="font-mono font-semibold">${fmt(row.totalCost)}</p>
                </div>
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

export function ItemCostByTypeReport({ data, expanded, isMobile }: { data: any[]; expanded: boolean; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const [openTypes, setOpenTypes] = useState<Set<string>>(expanded ? new Set(data.map((g: any) => g.type)) : new Set());

  const toggleType = (t: string) => {
    setOpenTypes(prev => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  };

  return (
    <div className={isMobile ? "p-3 space-y-2" : ""}>
      {!isMobile && (
        <table className="w-full text-sm" data-testid="table-item-cost-by-type">
          <ReportHeader>
            <Th className="text-left">Type</Th>
            <Th className="text-left">Description</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Unit Cost</Th>
            <Th className="text-right">Total Cost</Th>
          </ReportHeader>
          <tbody>
            {data.map((group: any) => (
              <Fragment key={group.type}>
                <tr
                  className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                  onClick={() => toggleType(group.type)}
                  data-testid={`row-type-group-${group.type}`}
                >
                  <Td className="text-left font-semibold" colSpan={4}>
                    <span className="flex items-center gap-2">
                      {openTypes.has(group.type) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Badge variant="outline">{group.type}</Badge>
                      <span className="text-xs text-muted-foreground">({group.items.length} items)</span>
                    </span>
                  </Td>
                  <Td className="text-right font-mono font-semibold">${fmt(group.subtotal)}</Td>
                </tr>
                {(openTypes.has(group.type) || expanded) && group.items.map((item: any, j: number) => (
                  <tr key={item.id || j} className="hover:bg-muted/20">
                    <Td className="text-left pl-10 text-muted-foreground">{group.type}</Td>
                    <Td className="text-left">{item.description}</Td>
                    <Td className="text-right font-mono">{fmtInt(item.quantity)} {item.unit}</Td>
                    <Td className="text-right font-mono">${fmt(item.unitCost)}</Td>
                    <Td className="text-right font-mono">${fmt(item.totalCost)}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {isMobile && data.map((group: any) => (
        <div key={group.type} className="border rounded-lg overflow-hidden" data-testid={`card-type-group-${group.type}`}>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40"
            onClick={() => toggleType(group.type)}
          >
            <span className="flex items-center gap-2 text-sm">
              {openTypes.has(group.type) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Badge variant="outline">{group.type}</Badge>
              <span className="text-xs text-muted-foreground">({group.items.length})</span>
            </span>
            <span className="text-sm font-mono font-semibold">${fmt(group.subtotal)}</span>
          </button>
          {(openTypes.has(group.type) || expanded) && (
            <div className="divide-y">
              {group.items.map((item: any, j: number) => (
                <div key={item.id || j} className="px-3 py-2 space-y-1">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{fmtInt(item.quantity)} {item.unit} × ${fmt(item.unitCost)}</span>
                    <span className="font-mono font-medium text-foreground">${fmt(item.totalCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ItemCostByTakeoffReport({ data, expanded, isMobile }: { data: any[]; expanded: boolean; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  const [openSheets, setOpenSheets] = useState<Set<string>>(expanded ? new Set(data.map((g: any) => g.sheetName)) : new Set());

  const toggleSheet = (name: string) => {
    setOpenSheets(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  return (
    <div className={isMobile ? "p-3 space-y-2" : ""}>
      {!isMobile && (
        <table className="w-full text-sm" data-testid="table-item-cost-by-takeoff">
          <ReportHeader>
            <Th className="text-left">Takeoff Sheet</Th>
            <Th className="text-left">Description</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Unit Cost</Th>
            <Th className="text-right">Total Cost</Th>
          </ReportHeader>
          <tbody>
            {data.map((group: any) => (
              <Fragment key={group.sheetName}>
                <tr
                  className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                  onClick={() => toggleSheet(group.sheetName)}
                  data-testid={`row-takeoff-group-${group.sheetName}`}
                >
                  <Td className="text-left font-semibold" colSpan={4}>
                    <span className="flex items-center gap-2">
                      {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {group.sheetName}
                      <Badge variant="secondary" className="text-xs">{group.items.length}</Badge>
                    </span>
                  </Td>
                  <Td className="text-right font-mono font-semibold">${fmt(group.subtotal)}</Td>
                </tr>
                {(openSheets.has(group.sheetName) || expanded) && group.items.map((item: any, j: number) => (
                  <tr key={item.id || j} className="hover:bg-muted/20">
                    <Td className="text-left pl-10 text-muted-foreground">{group.sheetName}</Td>
                    <Td className="text-left">{item.description}</Td>
                    <Td className="text-right font-mono">{fmtInt(item.quantity)} {item.unit}</Td>
                    <Td className="text-right font-mono">${fmt(item.unitCost)}</Td>
                    <Td className="text-right font-mono">${fmt(item.totalCost)}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {isMobile && data.map((group: any) => (
        <div key={group.sheetName} className="border rounded-lg overflow-hidden" data-testid={`card-takeoff-group-${group.sheetName}`}>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40"
            onClick={() => toggleSheet(group.sheetName)}
          >
            <span className="flex items-center gap-2 text-sm">
              {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <span className="font-semibold truncate">{group.sheetName}</span>
              <Badge variant="secondary" className="text-xs">{group.items.length}</Badge>
            </span>
            <span className="text-sm font-mono font-semibold flex-shrink-0">${fmt(group.subtotal)}</span>
          </button>
          {(openSheets.has(group.sheetName) || expanded) && (
            <div className="divide-y">
              {group.items.map((item: any, j: number) => (
                <div key={item.id || j} className="px-3 py-2 space-y-1">
                  <p className="text-sm font-medium truncate">{item.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{fmtInt(item.quantity)} {item.unit} × ${fmt(item.unitCost)}</span>
                    <span className="font-mono font-medium text-foreground">${fmt(item.totalCost)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
