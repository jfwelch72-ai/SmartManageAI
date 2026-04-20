import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Clock,
  CheckCircle,
  XCircle,
  Pencil,
  Trash2,
  ChevronDown,
} from "lucide-react";
import { format } from "date-fns";

export function getStatusBadge(status: string) {
  switch (status) {
    case "APPROVED":
      return (
        <Badge variant="default" data-testid="badge-status-approved">
          <CheckCircle className="w-3 h-3 mr-1" />
          Approved
        </Badge>
      );
    case "REJECTED":
      return (
        <Badge variant="destructive" data-testid="badge-status-rejected">
          <XCircle className="w-3 h-3 mr-1" />
          Rejected
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" data-testid="badge-status-pending">
          <Clock className="w-3 h-3 mr-1" />
          Pending
        </Badge>
      );
  }
}

interface TimeEntryListContentProps {
  filteredTimeEntries: any[];
  projects: any[];
  isManager: boolean;
  selectedEntries: string[];
  expandedEntries: Set<string>;
  entriesLoading: boolean;
  hasActiveFilters: boolean;
  approveEntry: { isPending: boolean };
  toggleSelectEntry: (id: string) => void;
  toggleSelectAll: () => void;
  toggleExpanded: (id: string) => void;
  handleApprove: (id: string) => void;
  setRejectEntryId: (id: string) => void;
  openEditDialog: (entry: any) => void;
  setDeleteEntryId: (id: string) => void;
  getRowProps?: (index: number) => Record<string, any>;
}

export function TimeEntryListContent({
  filteredTimeEntries,
  projects,
  isManager,
  selectedEntries,
  expandedEntries,
  entriesLoading,
  hasActiveFilters,
  approveEntry,
  toggleSelectEntry,
  toggleSelectAll,
  toggleExpanded,
  handleApprove,
  setRejectEntryId,
  openEditDialog,
  setDeleteEntryId,
  getRowProps,
}: TimeEntryListContentProps) {
  if (entriesLoading) {
    return <CardContent><div className="text-center py-8 text-muted-foreground">Loading...</div></CardContent>;
  }

  if (filteredTimeEntries.length === 0) {
    return (
      <CardContent>
        <div className="text-center py-8 text-muted-foreground">
          {hasActiveFilters ? "No time entries match your filters" : "No time entries found"}
        </div>
      </CardContent>
    );
  }

  return (
    <CardContent>
    <div className="space-y-3">
      {isManager && filteredTimeEntries.some((e) => e.approvalStatus === "PENDING") && (
        <div className="flex items-center gap-2 pb-1">
          <Checkbox
            checked={
              selectedEntries.length > 0 &&
              selectedEntries.length ===
                filteredTimeEntries.filter((e) => e.approvalStatus === "PENDING").length
            }
            onCheckedChange={toggleSelectAll}
            data-testid="checkbox-select-all"
          />
          <span className="text-sm text-muted-foreground">Select all pending</span>
        </div>
      )}

      {filteredTimeEntries.map((entry, idx) => {
        const project = projects.find((p: any) => p.id === entry.projectId);
        const regular = parseFloat(entry.hoursRegular) || 0;
        const overtime = parseFloat(entry.hoursOvertime) || 0;
        const total = regular + overtime;
        const isExpanded = expandedEntries.has(entry.id);

        return (
          <Card
            key={entry.id}
            data-testid={`time-entry-row-${entry.id}`}
            className="data-[focused=true]:ring-2 data-[focused=true]:ring-primary data-[focused=true]:ring-offset-2 data-[focused=true]:ring-offset-background"
            {...(getRowProps ? getRowProps(idx) : {})}
          >
            <div className="p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {isManager && entry.approvalStatus === "PENDING" && (
                    <Checkbox
                      checked={selectedEntries.includes(entry.id)}
                      onCheckedChange={() => toggleSelectEntry(entry.id)}
                      className="mt-0.5"
                      data-testid={`checkbox-entry-${entry.id}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-sm font-semibold" data-testid={`text-date-${entry.id}`}>
                        {format(new Date(entry.date), "MMM d, yyyy")}
                      </span>
                      {getStatusBadge(entry.approvalStatus)}
                    </div>
                    {isManager && (
                      <p className="text-sm text-muted-foreground" data-testid={`text-employee-${entry.id}`}>
                        {(entry as any).userName || entry.userId}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground truncate" data-testid={`text-project-${entry.id}`}>
                      {project ? `${project.code} - ${project.name}` : "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-lg font-bold font-mono mr-1" data-testid={`text-total-${entry.id}`}>
                    {total.toFixed(1)}h
                  </span>
                  {overtime > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      +{overtime.toFixed(1)} OT
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-xs text-muted-foreground"
                  onClick={() => toggleExpanded(entry.id)}
                  data-testid={`button-expand-${entry.id}`}
                >
                  <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")} />
                  {isExpanded ? "Less details" : "More details"}
                </button>

                <div className="flex flex-wrap items-center gap-1">
                  {isManager && entry.approvalStatus === "PENDING" && (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleApprove(entry.id)}
                        disabled={approveEntry.isPending}
                        data-testid={`button-approve-${entry.id}`}
                      >
                        <CheckCircle className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setRejectEntryId(entry.id)}
                        data-testid={`button-reject-${entry.id}`}
                      >
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEditDialog(entry)}
                    data-testid={`button-edit-${entry.id}`}
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setDeleteEntryId(entry.id)}
                    data-testid={`button-delete-${entry.id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t pt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs">Regular Hrs</span>
                    <p className="font-mono font-medium" data-testid={`text-regular-${entry.id}`}>{regular.toFixed(1)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">OT Hrs</span>
                    <p className="font-mono font-medium" data-testid={`text-overtime-${entry.id}`}>{overtime.toFixed(1)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs">Total Hrs</span>
                    <p className="font-mono font-bold">{total.toFixed(1)}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <span className="text-muted-foreground text-xs">Cost Code</span>
                    <p className="font-medium" data-testid={`text-cost-code-${entry.id}`}>{entry.costCode || "—"}</p>
                  </div>
                  {entry.notes && (
                    <div className="col-span-2 sm:col-span-3">
                      <span className="text-muted-foreground text-xs">Notes</span>
                      <p className="text-muted-foreground">{entry.notes}</p>
                    </div>
                  )}
                  {entry.approvalStatus === "REJECTED" && (entry as any).rejectionReason && (
                    <div className="col-span-2 sm:col-span-3">
                      <span className="text-muted-foreground text-xs">Rejection Reason</span>
                      <p className="text-destructive">{(entry as any).rejectionReason}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
    </CardContent>
  );
}
