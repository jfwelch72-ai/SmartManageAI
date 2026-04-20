import { useState } from "react";
import type { ProjectWithNames } from "@/hooks/use-data";
import { useUpdateProject } from "@/hooks/use-data";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import HealthScoreBadge from "./HealthScoreBadge";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { Project } from "@shared/schema";

type ProjectStatus = Project["status"];

const STATUS_COLUMNS: Array<{ key: ProjectStatus; label: string; accent: string }> = [
  { key: "BID", label: "Bidding", accent: "bg-amber-500" },
  { key: "PLANNING", label: "Pre-Construction", accent: "bg-blue-500" },
  { key: "ACTIVE", label: "Active", accent: "bg-emerald-500" },
  { key: "COMPLETE", label: "Completed", accent: "bg-purple-500" },
  { key: "CLOSED", label: "Archived", accent: "bg-slate-500" },
];

const AVATAR_COLORS = [
  "bg-rose-500", "bg-orange-500", "bg-amber-500", "bg-emerald-500",
  "bg-teal-500", "bg-cyan-500", "bg-blue-500", "bg-indigo-500",
  "bg-violet-500", "bg-pink-500",
];

function colorForName(name?: string | null): string {
  if (!name) return "bg-muted";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "?";
}

function formatCurrency(val: string | number | null | undefined): string {
  if (val === null || val === undefined || val === "") return "";
  const n = typeof val === "string" ? Number(val) : val;
  if (Number.isNaN(n)) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface Props {
  projects: ProjectWithNames[];
  onCardClick: (project: ProjectWithNames) => void;
}

export default function ProjectsKanbanView({ projects, onCardClick }: Props) {
  const { toast } = useToast();
  const updateProject = useUpdateProject();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<ProjectStatus | null>(null);

  const { data: healthOverview = [] } = useQuery<Array<{
    project_id: string;
    overall_score: number;
    trend_direction: string | null;
  }>>({
    queryKey: ["/api/project-health/overview"],
    refetchInterval: 300000,
  });
  const healthMap = new Map(healthOverview.map((h) => [h.project_id, h]));

  const grouped = STATUS_COLUMNS.reduce((acc, col) => {
    acc[col.key] = projects.filter((p) => p.status === col.key);
    return acc;
  }, {} as Record<ProjectStatus, ProjectWithNames[]>);

  const handleDrop = async (e: React.DragEvent, status: ProjectStatus) => {
    e.preventDefault();
    setDragOverCol(null);
    const code = e.dataTransfer.getData("text/plain");
    setDraggingId(null);
    if (!code) return;
    const project = projects.find((p) => p.code === code);
    if (!project || project.status === status) return;
    try {
      await updateProject.mutateAsync({ code, data: { status } });
      toast({ title: "Project moved", description: `${project.name} → ${STATUS_COLUMNS.find((c) => c.key === status)?.label}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not change project status";
      toast({ title: "Failed to update", description: message, variant: "destructive" });
    }
  };

  return (
    <div className="overflow-x-auto pb-2" data-testid="view-kanban">
      <div className="flex gap-4 min-w-max">
        {STATUS_COLUMNS.map((col) => {
          const colProjects = grouped[col.key];
          const isOver = dragOverCol === col.key;
          return (
            <div
              key={col.key}
              className={`w-72 shrink-0 rounded-md border bg-muted/30 ${isOver ? "ring-2 ring-primary" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
              onDragLeave={() => setDragOverCol((cur) => (cur === col.key ? null : cur))}
              onDrop={(e) => handleDrop(e, col.key)}
              data-testid={`kanban-column-${col.key}`}
            >
              <div className="flex items-center justify-between px-3 py-2 border-b">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${col.accent}`} />
                  <span className="text-sm font-semibold">{col.label}</span>
                </div>
                <Badge variant="secondary" className="text-xs">{colProjects.length}</Badge>
              </div>
              <div className="p-2 space-y-2 min-h-32 max-h-[calc(100vh-22rem)] overflow-y-auto">
                {colProjects.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">No projects</p>
                ) : (
                  colProjects.map((p) => {
                    const health = healthMap.get(p.id);
                    const ownerName = p.superintendent || p.estimator || p.clientName;
                    const dueDate = p.endDate || p.estimatedCompletionDate;
                    const isDragging = draggingId === p.code;
                    return (
                      <Card
                        key={p.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", p.code);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggingId(p.code);
                        }}
                        onDragEnd={() => setDraggingId(null)}
                        onClick={() => onCardClick(p)}
                        className={`cursor-pointer hover-elevate ${isDragging ? "opacity-50" : ""}`}
                        data-testid={`kanban-card-${p.code}`}
                      >
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <Badge variant="outline" className="font-mono text-[10px] mb-1">{p.code}</Badge>
                              <h4 className="text-sm font-medium leading-tight truncate" data-testid={`kanban-card-name-${p.code}`}>{p.name}</h4>
                              {p.clientName && (
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{p.clientName}</p>
                              )}
                            </div>
                            {health && (
                              <HealthScoreBadge score={health.overall_score} trendDirection={health.trend_direction} size="sm" />
                            )}
                          </div>
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0 ${colorForName(ownerName)}`}>
                                {initials(ownerName)}
                              </div>
                              {p.contractAmount && (
                                <span className="text-muted-foreground truncate">{formatCurrency(p.contractAmount)}</span>
                              )}
                            </div>
                            {dueDate && (
                              <span className="text-muted-foreground shrink-0">{format(new Date(dueDate), "MMM d")}</span>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
