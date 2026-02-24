import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import TMTicketsSection from "@/components/TMTicketsSection";
import { useProjectTimeEntries, useProjectTMSheets } from "@/hooks/use-data";
import { format } from "date-fns";
import type { Project } from "@shared/schema";

interface TimeTabProps {
  projectCode: string;
  project: Project;
  userRole: string;
}

export default function TimeTab({ projectCode, project, userRole }: TimeTabProps) {
  const { data: timeEntries = [], isLoading: timeEntriesLoading } = useProjectTimeEntries(projectCode);
  const { data: tmSheets = [], isLoading: tmSheetsLoading } = useProjectTMSheets(projectCode);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <CardTitle>Time & Material Tracking</CardTitle>
        </CardHeader>
        <CardContent>
          <TMTicketsSection
            projectId={project.id}
            projectCode={project.code}
            userRole={userRole}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Time Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {timeEntriesLoading ? (
            <div className="text-center py-4 text-muted-foreground">Loading time entries...</div>
          ) : timeEntries.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">No time entries yet</div>
          ) : (
            <div className="space-y-2">
              {timeEntries.map((entry) => {
                const totalHours = parseFloat(entry.hoursRegular) + parseFloat(entry.hoursOvertime || "0");
                return (
                  <div key={entry.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`time-entry-${entry.id}`}>
                    <div>
                      <p className="text-sm font-medium">{format(new Date(entry.date), "MMM d, yyyy")}</p>
                      {entry.notes && (
                        <p className="text-xs text-muted-foreground">{entry.notes}</p>
                      )}
                      {entry.costCode && (
                        <p className="text-xs text-muted-foreground">Cost Code: {entry.costCode}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-mono text-sm">{totalHours} hours</p>
                      <Badge variant={entry.approvedAt ? "default" : "secondary"}>
                        {entry.approvedAt ? "Approved" : "Pending"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>T&M Daily Sheets (Legacy)</CardTitle>
        </CardHeader>
        <CardContent>
          {tmSheetsLoading ? (
            <div className="text-center py-4 text-muted-foreground">Loading T&M sheets...</div>
          ) : tmSheets.length === 0 ? (
            <div className="text-center py-4 text-muted-foreground">No T&M sheets yet</div>
          ) : (
            <div className="space-y-2">
              {tmSheets.map((sheet) => (
                <div key={sheet.id} className="flex items-center justify-between p-3 border rounded-md" data-testid={`tm-sheet-${sheet.id}`}>
                  <div>
                    <p className="text-sm font-medium">{format(new Date(sheet.date), "MMM d, yyyy")}</p>
                    <p className="text-xs text-muted-foreground">Company Rep: {sheet.tfrRepName}</p>
                    {sheet.clientRepName && (
                      <p className="text-xs text-muted-foreground">Client Rep: {sheet.clientRepName}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
