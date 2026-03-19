import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { Flag, Filter } from "lucide-react";

interface IssuesTabProps {
  issues: any[];
  sheets: any[];
  selectedSheetId: string | null;
  onSelectIssue: (issue: any) => void;
  onSelectSheet: (sheetId: string) => void;
  selectedIssueId: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-500",
  IN_REVIEW: "bg-amber-500",
  RESOLVED: "bg-green-500",
};

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  IN_REVIEW: "In Review",
  RESOLVED: "Resolved",
};

const SEVERITY_COLORS: Record<string, string> = {
  LOW: "text-blue-600 dark:text-blue-400",
  MEDIUM: "text-amber-600 dark:text-amber-400",
  HIGH: "text-orange-600 dark:text-orange-400",
  CRITICAL: "text-red-600 dark:text-red-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  QUESTION: "Question",
  CONFLICT: "Conflict",
  RFI: "RFI",
  OBSERVATION: "Observation",
};

export function IssuesTab({ issues, sheets, selectedSheetId, onSelectIssue, onSelectSheet, selectedIssueId }: IssuesTabProps) {
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterSheet, setFilterSheet] = useState<string>("all");

  const filteredIssues = issues.filter((issue) => {
    if (filterStatus !== "all" && issue.status !== filterStatus) return false;
    if (filterSeverity !== "all" && issue.severity !== filterSeverity) return false;
    if (filterSheet !== "all" && issue.sheetId !== filterSheet) return false;
    return true;
  });

  const openCount = issues.filter(i => i.status === "OPEN").length;
  const inReviewCount = issues.filter(i => i.status === "IN_REVIEW").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Flag className="w-4 h-4" />
          Issues
        </h3>
        <div className="flex gap-1">
          {openCount > 0 && (
            <Badge variant="destructive" className="text-xs h-5 px-1.5" data-testid="badge-open-issues-count">
              {openCount} open
            </Badge>
          )}
          {inReviewCount > 0 && (
            <Badge className="text-xs h-5 px-1.5 bg-amber-500 hover:bg-amber-600" data-testid="badge-in-review-issues-count">
              {inReviewCount} reviewing
            </Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-filter-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="IN_REVIEW">In Review</SelectItem>
            <SelectItem value="RESOLVED">Resolved</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-filter-severity">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="LOW">Low</SelectItem>
            <SelectItem value="MEDIUM">Medium</SelectItem>
            <SelectItem value="HIGH">High</SelectItem>
            <SelectItem value="CRITICAL">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterSheet} onValueChange={setFilterSheet}>
          <SelectTrigger className="h-7 text-xs w-28" data-testid="select-filter-sheet">
            <SelectValue placeholder="Sheet" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sheets</SelectItem>
            {sheets.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.sheetName || s.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="max-h-[400px]">
        {filteredIssues.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {issues.length === 0 ? "No issues yet. Use the Issue Pin tool to flag items on the plan." : "No issues match the current filters."}
          </p>
        ) : (
          <div className="space-y-2 pr-1">
            {filteredIssues.map((issue) => {
              const sheet = sheets.find(s => s.id === issue.sheetId);
              const isSelected = issue.id === selectedIssueId;
              return (
                <button
                  key={issue.id}
                  className={cn(
                    "w-full text-left p-2.5 rounded border hover-elevate transition-colors",
                    isSelected ? "ring-2 ring-primary bg-primary/5" : "bg-muted/30"
                  )}
                  onClick={() => {
                    if (issue.sheetId !== selectedSheetId) {
                      onSelectSheet(issue.sheetId);
                    }
                    onSelectIssue(issue);
                  }}
                  data-testid={`issue-list-item-${issue.id}`}
                >
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <div className="flex items-center gap-1.5">
                      <div className={cn("w-2.5 h-2.5 rounded-full shrink-0 mt-0.5", STATUS_COLORS[issue.status])} />
                      <span className="text-sm font-medium">#{issue.issueNumber}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1">
                        {CATEGORY_LABELS[issue.category] || issue.category}
                      </Badge>
                    </div>
                    <span className={cn("text-xs font-medium", SEVERITY_COLORS[issue.severity])}>
                      {issue.severity}
                    </span>
                  </div>
                  {issue.description && (
                    <p className="text-xs text-muted-foreground truncate">{issue.description}</p>
                  )}
                  {sheet && (
                    <p className="text-[10px] text-muted-foreground mt-1">{sheet.sheetName}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
