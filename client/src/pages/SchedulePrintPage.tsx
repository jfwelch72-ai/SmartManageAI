import { useEffect, useMemo, useState } from "react";
import { useParams, useSearch } from "wouter";
import { differenceInDays, format, parseISO } from "date-fns";

interface ScheduleTask {
  id: string;
  name: string;
  description?: string;
  tradeType: string;
  plannedStartDate: string;
  plannedEndDate: string;
  baselineStartDate?: string;
  baselineEndDate?: string;
  durationDays: number;
  dependencies: string[];
  isCriticalPath: boolean;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETE" | "DELAYED" | "ON_HOLD";
  percentComplete: number;
  parentTaskId?: string | null;
  sortOrder: number;
}

interface ProjectSchedule {
  id: string;
  name: string;
  generatedBy: string;
  baselineStartDate: string;
  baselineEndDate?: string;
  projectedCompletionDate?: string;
  workingDays: number[];
  isActive: boolean;
  baselineLocked?: boolean;
  createdAt: string;
}

interface ScheduleResponse {
  schedule: ProjectSchedule | null;
  tasks: ScheduleTask[];
}

declare global {
  interface Window {
    __GANTT_READY?: boolean;
    __GANTT_ERROR?: string;
  }
}

function useQueryParams() {
  const search = useSearch();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export default function SchedulePrintPage() {
  const params = useParams<{ code: string }>();
  const code = params?.code || "";
  const qp = useQueryParams();
  const theme = (qp.get("theme") || "light").toLowerCase() === "dark" ? "dark" : "light";
  const showBaselineParam = qp.get("baseline") !== "0";

  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.body.style.background = theme === "dark" ? "#0a0a0a" : "#ffffff";
    document.body.style.color = theme === "dark" ? "#fafafa" : "#0a0a0a";
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(code)}/schedule`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error(`Failed to load schedule (${res.status})`);
        const json = (await res.json()) as ScheduleResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!cancelled) {
          setError(msg);
          window.__GANTT_ERROR = msg;
          window.__GANTT_READY = true;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!data) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__GANTT_READY = true;
      });
    });
  }, [data]);

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Schedule export error</h1>
        <p>{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>Loading schedule…</div>
    );
  }

  if (!data.schedule || data.tasks.length === 0) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>No schedule available</h1>
      </div>
    );
  }

  return (
    <PrintGantt
      schedule={data.schedule}
      tasks={data.tasks}
      theme={theme}
      showBaseline={showBaselineParam && !!data.schedule.baselineLocked}
      projectCode={code}
    />
  );
}

function PrintGantt({
  schedule,
  tasks,
  theme,
  showBaseline,
  projectCode,
}: {
  schedule: ProjectSchedule;
  tasks: ScheduleTask[];
  theme: "light" | "dark";
  showBaseline: boolean;
  projectCode: string;
}) {
  const sorted = useMemo(
    () => [...tasks].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)),
    [tasks],
  );

  const wbs = useMemo(() => {
    const childMap = new Map<string, ScheduleTask[]>();
    const rootTasks: ScheduleTask[] = [];
    for (const t of sorted) {
      if (t.parentTaskId) {
        if (!childMap.has(t.parentTaskId)) childMap.set(t.parentTaskId, []);
        childMap.get(t.parentTaskId)!.push(t);
      } else {
        rootTasks.push(t);
      }
    }
    const out: Array<{ task: ScheduleTask; depth: number; hasChildren: boolean }> = [];
    const seen = new Set<string>();
    function walk(task: ScheduleTask, depth: number) {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      const kids = childMap.get(task.id) || [];
      out.push({ task, depth, hasChildren: kids.length > 0 });
      for (const k of kids) walk(k, depth + 1);
    }
    for (const r of rootTasks) walk(r, 0);
    // Append any tasks that didn't get walked (orphans)
    for (const t of sorted) if (!seen.has(t.id)) out.push({ task: t, depth: 0, hasChildren: false });
    return out;
  }, [sorted]);

  const range = useMemo(() => {
    const dates: number[] = [];
    for (const t of tasks) {
      if (t.plannedStartDate) dates.push(parseISO(t.plannedStartDate).getTime());
      if (t.plannedEndDate) dates.push(parseISO(t.plannedEndDate).getTime());
      if (t.baselineStartDate) dates.push(parseISO(t.baselineStartDate).getTime());
      if (t.baselineEndDate) dates.push(parseISO(t.baselineEndDate).getTime());
    }
    if (schedule.baselineStartDate) dates.push(parseISO(schedule.baselineStartDate).getTime());
    if (schedule.baselineEndDate) dates.push(parseISO(schedule.baselineEndDate).getTime());
    const start = dates.length ? new Date(Math.min(...dates)) : new Date();
    const end = dates.length ? new Date(Math.max(...dates)) : new Date();
    const totalDays = Math.max(differenceInDays(end, start), 1);
    return { start, end, totalDays };
  }, [tasks, schedule]);

  const monthTicks = useMemo(() => {
    const ticks: Array<{ left: number; label: string }> = [];
    const cur = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
    while (cur <= range.end) {
      const offset = differenceInDays(cur, range.start);
      ticks.push({
        left: Math.max(0, (offset / range.totalDays) * 100),
        label: format(cur, "MMM yyyy"),
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    return ticks;
  }, [range]);

  const colors = theme === "dark"
    ? {
        bg: "#0a0a0a",
        fg: "#fafafa",
        muted: "#a1a1aa",
        rowAlt: "#111113",
        track: "#1f2024",
        border: "#27272a",
        bar: "#3b82f6",
        critical: "#ef4444",
        complete: "#10b981",
        baseline: "#6b7280",
        slip: "#dc2626",
        ahead: "#10b981",
      }
    : {
        bg: "#ffffff",
        fg: "#0a0a0a",
        muted: "#52525b",
        rowAlt: "#f8fafc",
        track: "#f1f5f9",
        border: "#e4e4e7",
        bar: "#2563eb",
        critical: "#dc2626",
        complete: "#059669",
        baseline: "#9ca3af",
        slip: "#b91c1c",
        ahead: "#059669",
      };

  const labelColWidth = 280;
  const rowHeight = 30;

  const barFor = (startStr?: string, endStr?: string) => {
    if (!startStr || !endStr) return null;
    const s = parseISO(startStr);
    const e = parseISO(endStr);
    const offset = differenceInDays(s, range.start);
    const dur = Math.max(differenceInDays(e, s) + 1, 1);
    return {
      left: `${Math.max(0, (offset / range.totalDays) * 100)}%`,
      width: `${Math.min(100, (dur / range.totalDays) * 100)}%`,
    };
  };

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        background: colors.bg,
        color: colors.fg,
        padding: "16px 20px",
      }}
      data-testid="print-gantt-root"
    >
      <style>{`
        @page { size: A3 landscape; margin: 12mm; }
        .gantt-row { page-break-inside: avoid; break-inside: avoid; }
        .gantt-row-group-header { page-break-after: avoid; break-after: avoid; }
        .gantt-section { page-break-inside: auto; }
        thead { display: table-header-group; }
      `}</style>
      <header style={{ marginBottom: 12, borderBottom: `1px solid ${colors.border}`, paddingBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{schedule.name || "Project Schedule"}</h1>
            <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
              Project {projectCode} · {tasks.length} tasks · {format(range.start, "MMM d, yyyy")} → {format(range.end, "MMM d, yyyy")}
              {schedule.baselineLocked ? " · Baseline locked" : ""}
            </div>
          </div>
          <div style={{ fontSize: 10, color: colors.muted }}>
            Generated {format(new Date(), "MMM d, yyyy h:mm a")}
          </div>
        </div>
      </header>

      <div className="gantt-section" style={{ width: "100%" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 10,
            color: colors.muted,
            borderBottom: `1px solid ${colors.border}`,
            height: 22,
          }}
        >
          <div style={{ width: labelColWidth, flexShrink: 0, fontWeight: 600 }}>Task</div>
          <div style={{ flex: 1, position: "relative", height: "100%" }}>
            {monthTicks.map((tick, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${tick.left}%`,
                  top: 0,
                  bottom: 0,
                  paddingLeft: 4,
                  borderLeft: `1px solid ${colors.border}`,
                  fontSize: 9,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {tick.label}
              </div>
            ))}
          </div>
        </div>

        {wbs.map(({ task, depth, hasChildren }, idx) => {
          const planned = barFor(task.plannedStartDate, task.plannedEndDate);
          const baseline = showBaseline ? barFor(task.baselineStartDate, task.baselineEndDate) : null;
          const barColor = task.isCriticalPath
            ? colors.critical
            : task.status === "COMPLETE"
              ? colors.complete
              : colors.bar;
          return (
            <div
              key={task.id}
              className={hasChildren ? "gantt-row gantt-row-group-header" : "gantt-row"}
              style={{
                display: "flex",
                alignItems: "center",
                height: rowHeight,
                background: idx % 2 === 0 ? colors.rowAlt : "transparent",
                borderBottom: `1px solid ${colors.border}`,
              }}
              data-testid={`print-task-row-${task.id}`}
            >
              <div
                style={{
                  width: labelColWidth,
                  flexShrink: 0,
                  paddingLeft: 8 + depth * 14,
                  paddingRight: 8,
                  fontSize: 11,
                  fontWeight: hasChildren ? 600 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={task.name}
              >
                {task.isCriticalPath ? (
                  <span
                    style={{
                      display: "inline-block",
                      background: colors.critical,
                      color: "#fff",
                      fontSize: 8,
                      padding: "1px 4px",
                      borderRadius: 3,
                      marginRight: 4,
                      verticalAlign: "middle",
                    }}
                  >
                    CP
                  </span>
                ) : null}
                {task.name}
              </div>
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  height: "100%",
                  background: colors.track,
                }}
              >
                {monthTicks.map((tick, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: `${tick.left}%`,
                      top: 0,
                      bottom: 0,
                      borderLeft: `1px dashed ${colors.border}`,
                    }}
                  />
                ))}
                {baseline && (
                  <div
                    style={{
                      position: "absolute",
                      left: baseline.left,
                      width: baseline.width,
                      top: 4,
                      height: 6,
                      background: colors.baseline,
                      opacity: 0.55,
                      borderRadius: 2,
                    }}
                  />
                )}
                {planned && (
                  <div
                    style={{
                      position: "absolute",
                      left: planned.left,
                      width: planned.width,
                      top: showBaseline ? 12 : 8,
                      height: showBaseline ? 12 : 14,
                      background: barColor,
                      borderRadius: 3,
                      boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.12)",
                    }}
                  >
                    {task.percentComplete > 0 && task.percentComplete < 100 && (
                      <div
                        style={{
                          width: `${task.percentComplete}%`,
                          height: "100%",
                          background: "rgba(255,255,255,0.35)",
                          borderRadius: "3px 0 0 3px",
                        }}
                      />
                    )}
                  </div>
                )}
                {planned && (
                  <div
                    style={{
                      position: "absolute",
                      left: `calc(${planned.left} + ${planned.width} + 4px)`,
                      top: showBaseline ? 10 : 6,
                      fontSize: 9,
                      color: colors.muted,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {task.durationDays}d
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <footer style={{ marginTop: 12, fontSize: 9, color: colors.muted, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: colors.bar, marginRight: 4, verticalAlign: "middle" }} />Planned</span>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: colors.critical, marginRight: 4, verticalAlign: "middle" }} />Critical path</span>
        <span><span style={{ display: "inline-block", width: 10, height: 6, background: colors.complete, marginRight: 4, verticalAlign: "middle" }} />Complete</span>
        {showBaseline && (
          <span><span style={{ display: "inline-block", width: 10, height: 6, background: colors.baseline, marginRight: 4, verticalAlign: "middle" }} />Baseline</span>
        )}
      </footer>
    </div>
  );
}
