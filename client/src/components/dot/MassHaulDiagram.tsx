import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Brush,
} from "recharts";
import { Loader2, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface MassHaulMovement {
  source: string | null;
  destination: string | null;
  fromStation: number | null;
  toStation: number | null;
  haulDistanceFt: number | null;
  materialClass: string;
  materialKind: "CUT" | "FILL" | "OTHER";
  unit: string;
  totalQty: number;
  totalCost: number;
  tickets: number;
}

interface MassHaulSeriesResponse {
  movements: MassHaulMovement[];
  massHaulCurve: { station: number; cut: number; fill: number; cumulative: number }[];
  totals: { cut: number; fill: number; balance: number };
  hasStationData: boolean;
}

interface MassHaulDiagramProps {
  projectId: string;
  freeHaulFt?: number;
}

function fmtStation(value: number): string {
  const stations = Math.floor(value / 100);
  const offset = value - stations * 100;
  return `${stations}+${offset.toString().padStart(2, "0")}`;
}

export function MassHaulDiagram({ projectId, freeHaulFt = 1000 }: MassHaulDiagramProps) {
  const { data, isLoading, error } = useQuery<MassHaulSeriesResponse>({
    queryKey: ["/api/dot/mass-haul", projectId, "series"],
    queryFn: async () => {
      const r = await fetch(`/api/dot/mass-haul/${projectId}/series`, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load mass-haul series");
      return r.json() as Promise<MassHaulSeriesResponse>;
    },
  });

  // Compute free-haul / over-haul split based on cumulative balance points.
  // Balance point = where cumulative crosses zero between two stations.
  const { freeHaulYd, overHaulYd, freeHaulCost, overHaulCost, balancePoints } = useMemo(() => {
    if (!data?.massHaulCurve?.length) return { freeHaulYd: 0, overHaulYd: 0, freeHaulCost: 0, overHaulCost: 0, balancePoints: [] as number[] };
    const curve = data.massHaulCurve;
    const balances: number[] = [];
    for (let i = 1; i < curve.length; i++) {
      const a = curve[i - 1].cumulative;
      const b = curve[i].cumulative;
      if ((a >= 0 && b <= 0) || (a <= 0 && b >= 0)) {
        if (a !== b) {
          const t = a / (a - b);
          balances.push(curve[i - 1].station + t * (curve[i].station - curve[i - 1].station));
        }
      }
    }
    let free = 0;
    let over = 0;
    let freeCost = 0;
    let overCost = 0;
    for (const m of data.movements) {
      if (m.materialKind !== "FILL" && m.materialKind !== "CUT") continue;
      if (m.haulDistanceFt == null) continue;
      if (m.haulDistanceFt <= freeHaulFt) {
        free += m.totalQty;
        freeCost += Number(m.totalCost) || 0;
      } else {
        over += m.totalQty;
        overCost += Number(m.totalCost) || 0;
      }
    }
    return { freeHaulYd: free, overHaulYd: over, freeHaulCost: freeCost, overHaulCost: overCost, balancePoints: balances };
  }, [data, freeHaulFt]);

  // Zoom/pan window state — applied to the Brush control on the chart.
  const [zoomWindow, setZoomWindow] = useState<{ start: number; end: number } | null>(null);
  const totalPoints = data?.massHaulCurve?.length ?? 0;
  useEffect(() => {
    setZoomWindow(null);
  }, [projectId, totalPoints]);

  const brushStart = zoomWindow?.start ?? 0;
  const brushEnd = zoomWindow?.end ?? Math.max(0, totalPoints - 1);

  const zoomIn = () => {
    if (totalPoints < 4) return;
    const start = brushStart;
    const end = brushEnd;
    const span = end - start;
    if (span <= 2) return;
    const shrink = Math.max(1, Math.floor(span * 0.2));
    setZoomWindow({ start: start + shrink, end: end - shrink });
  };
  const zoomOut = () => {
    if (totalPoints < 2) return;
    const start = brushStart;
    const end = brushEnd;
    const span = end - start;
    const grow = Math.max(1, Math.floor(span * 0.25));
    setZoomWindow({
      start: Math.max(0, start - grow),
      end: Math.min(totalPoints - 1, end + grow),
    });
  };
  const zoomReset = () => setZoomWindow(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-muted-foreground" data-testid="mass-haul-diagram-loading">
        <Loader2 className="h-5 w-5 mr-2 animate-spin" />Loading haul movement data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-4" data-testid="mass-haul-diagram-error">
        Could not load mass-haul series.
      </div>
    );
  }

  if (!data || data.movements.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4" data-testid="mass-haul-diagram-empty">
        No haul tickets recorded yet — capture haul tickets in the field to populate this diagram.
      </div>
    );
  }

  if (!data.hasStationData) {
    // Fallback: source → destination cut/fill bars
    const fallback = data.movements
      .map((m, i) => ({
        key: `${m.source || "?"} → ${m.destination || "?"} (${m.materialClass})`,
        idx: i,
        cut: m.materialKind === "CUT" ? m.totalQty : 0,
        fill: m.materialKind === "FILL" ? m.totalQty : 0,
        other: m.materialKind === "OTHER" ? m.totalQty : 0,
      }))
      .slice(0, 20);
    return (
      <div className="space-y-3" data-testid="mass-haul-diagram-fallback">
        <p className="text-xs text-muted-foreground">
          Source/destination text on these tickets does not include station markers (e.g. "STA 12+34"),
          so we cannot draw a true mass-haul curve. Showing aggregated cut/fill quantities by location
          instead. Tip: include station references in haul-ticket source/destination fields to unlock
          the mass-haul curve.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={fallback} margin={{ top: 10, right: 20, left: 10, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="key" angle={-25} textAnchor="end" interval={0} height={70} fontSize={10} />
            <YAxis fontSize={10} label={{ value: "Quantity", angle: -90, position: "insideLeft", fontSize: 10 }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="cut" stackId="a" fill="#dc2626" name="Cut" />
            <Bar dataKey="fill" stackId="a" fill="#16a34a" name="Fill" />
            <Bar dataKey="other" stackId="a" fill="#94a3b8" name="Other" />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-3 gap-2 text-xs" data-testid="mass-haul-totals">
          <div className="rounded border p-2"><div className="text-muted-foreground">Total Cut</div><div className="font-semibold" data-testid="text-mass-haul-total-cut">{data.totals.cut.toLocaleString()}</div></div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Total Fill</div><div className="font-semibold" data-testid="text-mass-haul-total-fill">{data.totals.fill.toLocaleString()}</div></div>
          <div className="rounded border p-2"><div className="text-muted-foreground">Net Balance</div><div className="font-semibold" data-testid="text-mass-haul-balance">{data.totals.balance.toLocaleString()}</div></div>
        </div>
      </div>
    );
  }

  const chartData = data.massHaulCurve.map(p => ({
    stationLabel: fmtStation(p.station),
    station: p.station,
    cut: p.cut,
    fill: p.fill,
    cumulative: p.cumulative,
  }));

  return (
    <div className="space-y-3" data-testid="mass-haul-diagram">
      <div className="flex items-center justify-end gap-1" data-testid="mass-haul-zoom-controls">
        <span className="text-xs text-muted-foreground mr-2">Drag the brush handles to pan; use buttons to zoom</span>
        <Button type="button" size="sm" variant="outline" onClick={zoomIn} data-testid="button-mass-haul-zoom-in" aria-label="Zoom in">
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={zoomOut} data-testid="button-mass-haul-zoom-out" aria-label="Zoom out">
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={zoomReset} data-testid="button-mass-haul-zoom-reset" aria-label="Reset zoom">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 30 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="stationLabel"
            label={{ value: "Station", position: "insideBottom", offset: -10, fontSize: 11 }}
            fontSize={10}
          />
          <YAxis
            yAxisId="left"
            label={{ value: "Cut / Fill", angle: -90, position: "insideLeft", fontSize: 11 }}
            fontSize={10}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            label={{ value: "Cumulative", angle: 90, position: "insideRight", fontSize: 11 }}
            fontSize={10}
          />
          <Tooltip
            formatter={(value: number, name: string) => [Number(value).toLocaleString(), name]}
            labelFormatter={(label) => `STA ${label}`}
          />
          <Legend />
          <ReferenceLine yAxisId="right" y={0} stroke="#64748b" strokeDasharray="4 2" label={{ value: "Balance line", position: "right", fontSize: 10 }} />
          {balancePoints.map((bp, i) => (
            <ReferenceLine
              key={`bp-${i}`}
              x={fmtStation(Math.round(bp))}
              stroke="#0ea5e9"
              strokeDasharray="2 4"
              label={{ value: `Balance ${fmtStation(Math.round(bp))}`, fontSize: 9, position: "top" }}
            />
          ))}
          <Bar yAxisId="left" dataKey="cut" fill="#dc2626" name="Cut" />
          <Bar yAxisId="left" dataKey="fill" fill="#16a34a" name="Fill (negative)" />
          <Line yAxisId="right" type="monotone" dataKey="cumulative" stroke="#1d4ed8" strokeWidth={2} name="Cumulative mass-haul" dot={false} />
          {totalPoints > 1 && (
            <Brush
              dataKey="stationLabel"
              height={22}
              stroke="#1d4ed8"
              startIndex={brushStart}
              endIndex={brushEnd}
              onChange={(range: any) => {
                if (range && typeof range.startIndex === "number" && typeof range.endIndex === "number") {
                  setZoomWindow({ start: range.startIndex, end: range.endIndex });
                }
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
        <div className="rounded border p-2"><div className="text-muted-foreground">Total Cut</div><div className="font-semibold" data-testid="text-mass-haul-total-cut">{data.totals.cut.toLocaleString()}</div></div>
        <div className="rounded border p-2"><div className="text-muted-foreground">Total Fill</div><div className="font-semibold" data-testid="text-mass-haul-total-fill">{data.totals.fill.toLocaleString()}</div></div>
        <div className="rounded border p-2" data-testid="card-free-haul"><div className="text-muted-foreground">Free Haul (≤{freeHaulFt}ft)</div><div className="font-semibold">{freeHaulYd.toLocaleString()}</div></div>
        <div className="rounded border p-2" data-testid="card-over-haul"><div className="text-muted-foreground">Over Haul (&gt;{freeHaulFt}ft)</div><div className="font-semibold">{overHaulYd.toLocaleString()}</div></div>
        <div className="rounded border p-2" data-testid="card-free-haul-cost"><div className="text-muted-foreground">Free Haul Cost</div><div className="font-semibold">${freeHaulCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
        <div className="rounded border p-2" data-testid="card-over-haul-cost"><div className="text-muted-foreground">Over Haul Cost</div><div className="font-semibold">${overHaulCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
      </div>
      {balancePoints.length > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-balance-points">
          {balancePoints.length} balance point{balancePoints.length === 1 ? "" : "s"} detected at stations: {balancePoints.map(bp => fmtStation(Math.round(bp))).join(", ")}
        </p>
      )}
    </div>
  );
}
