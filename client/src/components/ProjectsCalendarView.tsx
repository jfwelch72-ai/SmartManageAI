import { useState, useMemo } from "react";
import type { ProjectWithNames } from "@/hooks/use-data";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import StaleDrawingsBadge from "./StaleDrawingsBadge";
import { useDrawingSetStaleSummary } from "@/hooks/use-drawing-set-stale-summary";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  format,
  isSameMonth,
  isSameDay,
  differenceInCalendarDays,
  isWithinInterval,
} from "date-fns";
import type { Project } from "@shared/schema";

type ProjectStatus = Project["status"];

const STATUS_BAR_COLORS: Record<ProjectStatus, string> = {
  BID: "bg-amber-500 hover:bg-amber-600",
  PLANNING: "bg-blue-500 hover:bg-blue-600",
  ACTIVE: "bg-emerald-500 hover:bg-emerald-600",
  COMPLETE: "bg-purple-500 hover:bg-purple-600",
  CLOSED: "bg-slate-500 hover:bg-slate-600",
};

interface Props {
  projects: ProjectWithNames[];
  onProjectClick: (project: ProjectWithNames) => void;
}

interface ProjectBar {
  project: ProjectWithNames;
  start: Date;
  end: Date;
}

export default function ProjectsCalendarView({ projects, onProjectClick }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));

  // Task #1915 — reuse the org-scoped roll-up that already powers the table
  // and kanban views so flipping into the calendar doesn't trigger extra
  // /compare requests.
  const { data: staleSummaryData } = useDrawingSetStaleSummary(projects.length > 0);
  const staleSummary = staleSummaryData?.summary ?? {};

  const projectBars: ProjectBar[] = useMemo(() => {
    return projects
      .map((p) => {
        const start = p.startDate ? new Date(p.startDate) : null;
        const endValue = p.endDate ?? p.estimatedCompletionDate;
        const end = endValue ? new Date(endValue) : null;
        if (!start && !end) return null;
        return { project: p, start: start || end!, end: end || start! };
      })
      .filter((b): b is ProjectBar => b !== null && !isNaN(b.start.getTime()) && !isNaN(b.end.getTime()));
  }, [projects]);

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const weeks: Date[][] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor);
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  }

  // For each week, compute which project bars overlap and assign rows
  const weekBars = weeks.map((week) => {
    const weekStart = week[0];
    const weekEnd = week[6];
    const overlapping = projectBars.filter((b) =>
      b.end >= weekStart && b.start <= weekEnd,
    );

    type Placed = { bar: ProjectBar; startCol: number; span: number; row: number };
    const placed: Placed[] = [];
    const rowOccupancy: number[][] = []; // rowOccupancy[row] = list of cols used

    overlapping
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .forEach((bar) => {
        const startCol = Math.max(0, differenceInCalendarDays(bar.start, weekStart));
        const endCol = Math.min(6, differenceInCalendarDays(bar.end, weekStart));
        const span = endCol - startCol + 1;
        let row = 0;
        while (true) {
          const occ = rowOccupancy[row] || [];
          const collide = occ.some((c) => c >= startCol && c <= endCol);
          if (!collide) {
            for (let c = startCol; c <= endCol; c++) (rowOccupancy[row] ||= []).push(c);
            placed.push({ bar, startCol, span, row });
            return;
          }
          row++;
        }
      });

    const maxRows = rowOccupancy.length;
    return { week, placed, maxRows };
  });

  const today = new Date();

  return (
    <div className="space-y-3" data-testid="view-calendar">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" data-testid="calendar-month-label">{format(currentMonth, "MMMM yyyy")}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} data-testid="calendar-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(startOfMonth(new Date()))} data-testid="calendar-today">
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} data-testid="calendar-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border overflow-hidden">
        <div className="grid grid-cols-7 bg-muted/40 text-xs font-medium text-muted-foreground">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="px-2 py-1.5 text-center border-r last:border-r-0">{d}</div>
          ))}
        </div>
        <div className="divide-y">
          {weekBars.map(({ week, placed, maxRows }, wi) => {
            const rowHeight = 18;
            const headerHeight = 22;
            const padding = 6;
            const minHeight = headerHeight + Math.max(maxRows, 1) * rowHeight + padding;
            return (
              <div key={wi} className="relative grid grid-cols-7" style={{ minHeight }}>
                {week.map((day, di) => {
                  const inMonth = isSameMonth(day, currentMonth);
                  const isToday = isSameDay(day, today);
                  return (
                    <div
                      key={di}
                      className={`border-r last:border-r-0 px-1.5 pt-1 ${inMonth ? "bg-background" : "bg-muted/20"}`}
                    >
                      <div className={`text-xs ${isToday ? "inline-flex w-5 h-5 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                        {format(day, "d")}
                      </div>
                    </div>
                  );
                })}
                {placed.map(({ bar, startCol, span, row }, idx) => {
                  const status = bar.project.status;
                  const color = STATUS_BAR_COLORS[status] || "bg-slate-500 hover:bg-slate-600";
                  const summary = staleSummary[bar.project.id];
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => onProjectClick(bar.project)}
                      className={`absolute flex items-center gap-1 text-[11px] text-white px-1.5 py-0.5 rounded text-left ${color}`}
                      style={{
                        left: `calc(${(startCol / 7) * 100}% + 2px)`,
                        width: `calc(${(span / 7) * 100}% - 4px)`,
                        top: headerHeight + row * rowHeight,
                        height: rowHeight - 2,
                      }}
                      title={`${bar.project.name} (${bar.project.code})`}
                      data-testid={`calendar-bar-${bar.project.code}`}
                    >
                      <span className="flex-1 min-w-0 truncate">{bar.project.name}</span>
                      <StaleDrawingsBadge
                        projectCode={bar.project.code}
                        summary={summary}
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {(Object.keys(STATUS_BAR_COLORS) as ProjectStatus[]).map((s) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className={`inline-block w-3 h-3 rounded ${STATUS_BAR_COLORS[s].split(" ")[0]}`} />
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
