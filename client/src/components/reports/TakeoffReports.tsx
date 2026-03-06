import { useState, Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ReportHeader, Th, Td, EmptyState, fmt, fmtInt } from "./report-utils";

export function TakeoffQuantityReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-takeoff-quantity">
        <ReportHeader>
          <Th className="text-left">Takeoff Description</Th>
          <Th className="text-right">Takeoff Quantity</Th>
          <Th className="text-left">Takeoff Unit</Th>
          <Th className="text-left">Scale</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.id || i} className="hover:bg-muted/30" data-testid={`row-quantity-${i}`}>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-right font-mono">{fmtInt(row.quantity)}</Td>
              <Td className="text-left">{row.unit}</Td>
              <Td className="text-left text-muted-foreground">{row.scale}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {isMobile && (
        <div className="space-y-2 p-3">
          {data.map((row: any, i: number) => (
            <div key={row.id || i} className="border rounded-lg p-3 space-y-1" data-testid={`card-quantity-${i}`}>
              <p className="font-medium text-sm">{row.description}</p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Qty: <span className="font-mono text-foreground">{fmtInt(row.quantity)} {row.unit}</span></span>
                <span className="text-muted-foreground">Scale: {row.scale}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function TakeoffSummaryReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-takeoff-summary">
        <ReportHeader>
          <Th className="text-left">Type</Th>
          <Th className="text-right">Total Quantity</Th>
          <Th className="text-left">Unit</Th>
          <Th className="text-right">Measurement Count</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={row.type || i} className="hover:bg-muted/30" data-testid={`row-summary-${i}`}>
              <Td className="text-left"><Badge variant="outline">{row.type}</Badge></Td>
              <Td className="text-right font-mono font-medium">{fmtInt(row.totalQuantity)}</Td>
              <Td className="text-left">{row.unit}</Td>
              <Td className="text-right">{row.measurementCount}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {isMobile && (
        <div className="space-y-2 p-3">
          {data.map((row: any, i: number) => (
            <div key={row.type || i} className="border rounded-lg p-3" data-testid={`card-summary-${i}`}>
              <div className="flex items-center justify-between mb-1">
                <Badge variant="outline">{row.type}</Badge>
                <span className="text-xs text-muted-foreground">{row.measurementCount} measurements</span>
              </div>
              <p className="font-mono font-semibold text-lg">{fmtInt(row.totalQuantity)} <span className="text-sm font-normal text-muted-foreground">{row.unit}</span></p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function MeasurementsByTakeoffReport({ data, expanded, isMobile }: { data: any[]; expanded: boolean; isMobile: boolean }) {
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
        <table className="w-full text-sm" data-testid="table-measurements-by-takeoff">
          <ReportHeader>
            <Th className="text-left">Takeoff Sheet</Th>
            <Th className="text-left">Description</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-left">Unit</Th>
          </ReportHeader>
          <tbody>
            {data.map((group: any) => (
              <Fragment key={group.sheetName}>
                <tr
                  className="bg-muted/40 cursor-pointer hover:bg-muted/60"
                  onClick={() => toggleSheet(group.sheetName)}
                  data-testid={`row-sheet-group-${group.sheetName}`}
                >
                  <Td className="text-left font-semibold" colSpan={4}>
                    <span className="flex items-center gap-2">
                      {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {group.sheetName}
                      <Badge variant="secondary" className="text-xs">{group.measurements.length}</Badge>
                    </span>
                  </Td>
                </tr>
                {(openSheets.has(group.sheetName) || expanded) && group.measurements.map((m: any, j: number) => (
                  <tr key={m.id || j} className="hover:bg-muted/20">
                    <Td className="text-left pl-10 text-muted-foreground">{group.sheetName}</Td>
                    <Td className="text-left">{m.description}</Td>
                    <Td className="text-right font-mono">{fmtInt(m.quantity)}</Td>
                    <Td className="text-left">{m.unit}</Td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
      {isMobile && data.map((group: any) => (
        <div key={group.sheetName} className="border rounded-lg overflow-hidden" data-testid={`card-sheet-group-${group.sheetName}`}>
          <button
            className="w-full flex items-center justify-between p-3 bg-muted/40"
            onClick={() => toggleSheet(group.sheetName)}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {openSheets.has(group.sheetName) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              {group.sheetName}
            </span>
            <Badge variant="secondary" className="text-xs">{group.measurements.length}</Badge>
          </button>
          {(openSheets.has(group.sheetName) || expanded) && (
            <div className="divide-y">
              {group.measurements.map((m: any, j: number) => (
                <div key={m.id || j} className="px-3 py-2 flex items-center justify-between">
                  <span className="text-sm truncate mr-2">{m.description}</span>
                  <span className="text-xs font-mono flex-shrink-0">{fmtInt(m.quantity)} {m.unit}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function ItemListReport({ data, isMobile }: { data: any[]; isMobile: boolean }) {
  if (!data || data.length === 0) return <EmptyState />;
  return (
    <>
      <table className={`w-full text-sm ${isMobile ? "hidden" : ""}`} data-testid="table-item-list">
        <ReportHeader>
          <Th className="text-left">Description</Th>
          <Th className="text-left">Type</Th>
          <Th className="text-left">Unit</Th>
        </ReportHeader>
        <tbody>
          {data.map((row: any, i: number) => (
            <tr key={i} className="hover:bg-muted/30" data-testid={`row-item-${i}`}>
              <Td className="text-left font-medium">{row.description}</Td>
              <Td className="text-left"><Badge variant="outline">{row.type}</Badge></Td>
              <Td className="text-left">{row.unit}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      {isMobile && (
        <div className="space-y-2 p-3">
          {data.map((row: any, i: number) => (
            <div key={i} className="border rounded-lg p-3 flex items-center justify-between" data-testid={`card-item-${i}`}>
              <span className="text-sm font-medium truncate mr-2">{row.description}</span>
              <div className="flex gap-1.5 flex-shrink-0">
                <Badge variant="outline" className="text-xs">{row.type}</Badge>
                <Badge variant="secondary" className="text-xs">{row.unit}</Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
