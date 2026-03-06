import {
  FileSpreadsheet,
  Hash,
  BarChart3,
  Layers,
  List,
  DollarSign,
  PieChart,
  LayoutList,
  ClipboardList,
  TrendingDown,
} from "lucide-react";

export const TAKEOFF_REPORTS = [
  { id: "takeoff-quantity", label: "Takeoff Quantity", icon: Hash, endpoint: "/api/reports/takeoff/quantity" },
  { id: "takeoff-summary", label: "Takeoff Summary", icon: BarChart3, endpoint: "/api/reports/takeoff/summary" },
  { id: "measurements-by-takeoff", label: "Measurements By Takeoff", icon: Layers, endpoint: "/api/reports/takeoff/by-takeoff" },
  { id: "item-list", label: "Item List", icon: List, endpoint: "/api/reports/takeoff/items" },
  { id: "item-cost", label: "Item Cost", icon: DollarSign, endpoint: "/api/reports/takeoff/item-cost" },
  { id: "item-cost-by-type", label: "Item Cost By Type", icon: PieChart, endpoint: "/api/reports/takeoff/item-cost-by-type" },
  { id: "item-cost-by-takeoff", label: "Item Cost By Takeoff", icon: LayoutList, endpoint: "/api/reports/takeoff/item-cost-by-takeoff" },
] as const;

export const ESTIMATE_REPORTS = [
  { id: "estimate-summary", label: "Estimate Summary", icon: ClipboardList, endpoint: "/api/reports/estimates/summary" },
  { id: "cost-breakdown", label: "Cost Breakdown", icon: TrendingDown, endpoint: "/api/reports/estimates/cost-breakdown" },
] as const;

export type ReportId = typeof TAKEOFF_REPORTS[number]["id"] | typeof ESTIMATE_REPORTS[number]["id"];

export function getReportLabel(reportId: ReportId): string {
  const all = [...TAKEOFF_REPORTS, ...ESTIMATE_REPORTS];
  return all.find(r => r.id === reportId)?.label || reportId;
}

export function getReportEndpoint(reportId: ReportId): string {
  const all = [...TAKEOFF_REPORTS, ...ESTIMATE_REPORTS];
  return all.find(r => r.id === reportId)?.endpoint || "";
}

export function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtInt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function ReportHeader({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-emerald-700 dark:bg-emerald-800 text-white text-sm">
        {children}
      </tr>
    </thead>
  );
}

export function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium whitespace-nowrap ${className}`}>{children}</th>;
}

export function Td({ children, className = "", colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td className={`px-4 py-2 border-b border-border/50 ${className}`} colSpan={colSpan}>{children}</td>;
}

export function EmptyState({ message }: { message?: string }) {
  return (
    <div className="py-12 text-center text-muted-foreground" data-testid="text-empty-report">
      <FileSpreadsheet className="h-10 w-10 mx-auto mb-3 opacity-40" />
      <p className="text-sm">{message || "No data available for this report."}</p>
      <p className="text-xs mt-1">Select a project or adjust filters to view report data.</p>
    </div>
  );
}

export function generateCSV(reportId: ReportId, data: any): string {
  if (!data) return "";

  const escape = (v: any) => {
    const str = String(v ?? "");
    return str.includes(",") || str.includes('"') || str.includes("\n") ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const toCSV = (headers: string[], rows: any[][]) => {
    return [headers.join(","), ...rows.map(r => r.map(escape).join(","))].join("\n");
  };

  switch (reportId) {
    case "takeoff-quantity":
      return toCSV(
        ["Description", "Quantity", "Unit", "Scale"],
        (data as any[]).map(r => [r.description, r.quantity, r.unit, r.scale])
      );
    case "takeoff-summary":
      return toCSV(
        ["Type", "Total Quantity", "Unit", "Measurement Count"],
        (data as any[]).map(r => [r.type, r.totalQuantity, r.unit, r.measurementCount])
      );
    case "measurements-by-takeoff":
      return toCSV(
        ["Sheet Name", "Description", "Quantity", "Unit"],
        (data as any[]).flatMap(g => g.measurements.map((m: any) => [g.sheetName, m.description, m.quantity, m.unit]))
      );
    case "item-list":
      return toCSV(
        ["Description", "Type", "Unit"],
        (data as any[]).map(r => [r.description, r.type, r.unit])
      );
    case "item-cost":
      return toCSV(
        ["Description", "Quantity", "Unit", "Unit Cost", "Total Cost"],
        (data as any[]).map(r => [r.description, r.quantity, r.unit, r.unitCost, r.totalCost])
      );
    case "item-cost-by-type":
      return toCSV(
        ["Type", "Description", "Quantity", "Unit", "Unit Cost", "Total Cost"],
        (data as any[]).flatMap(g => g.items.map((item: any) => [g.type, item.description, item.quantity, item.unit, item.unitCost, item.totalCost]))
      );
    case "item-cost-by-takeoff":
      return toCSV(
        ["Sheet Name", "Description", "Quantity", "Unit", "Unit Cost", "Total Cost"],
        (data as any[]).flatMap(g => g.items.map((item: any) => [g.sheetName, item.description, item.quantity, item.unit, item.unitCost, item.totalCost]))
      );
    case "estimate-summary":
      return toCSV(
        ["Category", "Description", "Quantity", "Unit", "Material Cost", "Labor Cost", "Equipment Cost", "Total Cost"],
        (data as any[]).map(r => [r.category, r.description, r.quantity, r.unit, r.materialCost, r.laborCost, r.equipmentCost, r.totalCost])
      );
    case "cost-breakdown": {
      const cats = data?.categories || [];
      return toCSV(
        ["Category", "Subtotal", "Percentage"],
        cats.map((r: any) => [r.category, r.subtotal, `${r.percentage}%`])
      );
    }
    default:
      return "";
  }
}
