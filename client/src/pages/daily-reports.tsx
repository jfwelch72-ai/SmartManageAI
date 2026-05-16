import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Paperclip } from "lucide-react";
import type { DailyReport } from "@shared/schema";
import { ContextualHelpButton } from "@/components/ContextualHelpButton";

interface ProjectLite {
  id: string;
  code: string;
  name: string;
}

export default function DailyReportsPage() {
  const { data, isLoading } = useQuery<{ dailyReports: DailyReport[] }>({
    queryKey: ["/api/daily-reports"],
  });
  const { data: projectsResp } = useQuery<{ data: ProjectLite[]; pagination: unknown }, Error, ProjectLite[]>({
    queryKey: ["/api/projects"],
    select: (r) => r?.data ?? [],
  });

  const projectsById = new Map<string, ProjectLite>(
    (projectsResp ?? []).map((p) => [p.id, p]),
  );
  const reports = data?.dailyReports ?? [];

  return (
    <div className="container max-w-5xl mx-auto p-6 space-y-6" data-testid="page-daily-reports">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Daily Reports</h1>
            <p className="text-sm text-muted-foreground">
              Field daily reports submitted from crew mobile devices.
            </p>
          </div>
        </div>
        <ContextualHelpButton />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" data-testid={`skeleton-report-${i}`} />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" data-testid="text-empty-state">
            No daily reports yet. They will appear here as soon as crews submit them from the mobile app.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => {
            const project = r.projectId ? projectsById.get(r.projectId) : null;
            const attachments = Array.isArray(r.attachmentsJson) ? r.attachmentsJson : [];
            return (
              <Card key={r.id} data-testid={`card-daily-report-${r.id}`}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <span data-testid={`text-report-date-${r.id}`}>
                        {new Date(r.reportDate).toLocaleDateString()}
                      </span>
                      {project ? (
                        <Badge variant="secondary" data-testid={`badge-project-${r.id}`}>
                          {project.code} — {project.name}
                        </Badge>
                      ) : (
                        <Badge variant="outline" data-testid={`badge-no-project-${r.id}`}>
                          Unassigned project
                        </Badge>
                      )}
                    </CardTitle>
                    {r.weather ? (
                      <Badge variant="outline" data-testid={`badge-weather-${r.id}`}>
                        {r.weather}
                      </Badge>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {r.notes ? (
                    <p className="whitespace-pre-wrap text-sm" data-testid={`text-notes-${r.id}`}>
                      {r.notes}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No notes provided.</p>
                  )}
                  {attachments.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1" data-testid={`list-attachments-${r.id}`}>
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      {attachments.map((a, idx) => (
                        <Badge key={(a.objectKey ?? a.name ?? String(idx)) + idx} variant="outline">
                          {a.name ?? a.objectKey ?? `attachment-${idx + 1}`}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
