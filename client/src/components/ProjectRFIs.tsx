import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  HelpCircle, Plus, Eye, CheckCircle2, XCircle, AlertTriangle, Clock,
} from "lucide-react";
import { format } from "date-fns";
import DocumentAttachments from "@/components/DocumentAttachments";
import {
  useRfiMutations, getStatusBadge, getPriorityBadge, isRfiOverdue,
  type RFI, type RFIStats, type RFICreateForm,
} from "@/hooks/useRfiMutations";
import RfiDetailDialog from "@/components/document-control/RfiDetailDialog";
import RfiCreateFields from "@/components/document-control/RfiCreateFields";

interface ProjectRFIsProps { projectId: string; projectCode: string; userRole: string; }
interface Subcontractor { id: string; companyName: string; }

const EMPTY_CREATE: Omit<RFICreateForm, "projectId"> = {
  subject: "", question: "", priority: "MEDIUM", category: "", subcontractorId: "", assignedToId: "",
  drawingReference: "", specReference: "", dateRequired: "",
  impactDescription: "", costImpact: false, scheduleImpact: false,
};

export default function ProjectRFIs({ projectId, projectCode, userRole }: ProjectRFIsProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedRFI, setSelectedRFI] = useState<RFI | null>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [createForm, setCreateForm] = useState<Omit<RFICreateForm, "projectId">>({ ...EMPTY_CREATE });

  const mutations = useRfiMutations({
    selectedRfiId: selectedRFI?.id ?? null,
    onCreateSuccess: () => { setShowCreateDialog(false); setCreateForm({ ...EMPTY_CREATE }); },
    onDeleteSuccess: () => { setShowDetailDialog(false); setSelectedRFI(null); },
  });

  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.set("projectId", projectId);
    if (filterStatus !== "all") params.set("status", filterStatus);
    return `?${params.toString()}`;
  };

  const { data: subcontractors = [] } = useQuery<Subcontractor[]>({ queryKey: ["/api/subcontracts/subcontractors"] });

  const { data: stats, isLoading: loadingStats } = useQuery<RFIStats>({
    queryKey: ["/api/rfi/stats", { projectId }],
    queryFn: async () => {
      const res = await fetch(`/api/rfi/stats?projectId=${projectId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data: rfis = [], isLoading: loadingRFIs } = useQuery<RFI[]>({
    queryKey: ["/api/rfi", { projectId, status: filterStatus }],
    queryFn: async () => {
      const res = await fetch(`/api/rfi${buildQueryString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch RFIs");
      return res.json();
    },
  });

  useEffect(() => {
    if (rfis.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const deepLinkRfiId = params.get("rfiId");
    if (deepLinkRfiId) {
      const found = rfis.find(r => r.id === deepLinkRfiId);
      if (found) {
        setSelectedRFI(found);
        setShowDetailDialog(true);
      }
    }
  }, [rfis]);

  const openDetail = (rfi: RFI) => { setSelectedRFI(rfi); setShowDetailDialog(true); };

  const filteredRFIs = rfis.filter((rfi) => {
    if (filterPriority !== "all" && rfi.priority !== filterPriority) return false;
    return true;
  });

  return (
    <div className="space-y-6" data-testid="proj-section-rfis">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">RFIs</h3>
          <Badge variant="secondary" data-testid="proj-badge-rfi-count">{stats?.total ?? 0} total</Badge>
        </div>
        <Button onClick={() => setShowCreateDialog(true)} data-testid="proj-button-create-rfi">
          <Plus className="h-4 w-4 mr-2" />Create RFI
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {loadingStats ? (
          [1, 2, 3, 4, 5].map((i) => (
            <Card key={i}><CardHeader className="pb-2"><Skeleton className="h-4 w-24" /></CardHeader><CardContent><Skeleton className="h-8 w-12" /></CardContent></Card>
          ))
        ) : (
          <>
            <Card data-testid="proj-card-stat-total">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><HelpCircle className="h-4 w-4" />Total RFIs</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="proj-text-stat-total">{stats?.total ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="proj-card-stat-open">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Open</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="proj-text-stat-open">{stats?.open ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="proj-card-stat-overdue" className="cursor-pointer hover-elevate" onClick={() => setFilterStatus("OVERDUE")}>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-red-600 dark:text-red-400 flex items-center gap-2"><Clock className="h-4 w-4" />Overdue</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="proj-text-stat-overdue">{stats?.overdue ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="proj-card-stat-answered">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Answered</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="proj-text-stat-answered">{stats?.answered ?? 0}</div></CardContent>
            </Card>
            <Card data-testid="proj-card-stat-closed">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><XCircle className="h-4 w-4" />Closed</CardTitle></CardHeader>
              <CardContent><div className="text-2xl font-bold" data-testid="proj-text-stat-closed">{stats?.closed ?? 0}</div></CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-48">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger data-testid="proj-select-filter-status"><SelectValue placeholder="All Statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="SUBMITTED">Submitted</SelectItem>
              <SelectItem value="UNDER_REVIEW">Under Review</SelectItem>
              <SelectItem value="FORWARDED">Forwarded</SelectItem>
              <SelectItem value="ANSWERED">Answered</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
              <SelectItem value="OVERDUE">Overdue</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger data-testid="proj-select-filter-priority"><SelectValue placeholder="All Priorities" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priorities</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="URGENT">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadingRFIs ? (
        <div className="space-y-4">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-16" />))}</div>
      ) : filteredRFIs.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-muted-foreground" data-testid="proj-text-empty-state">No RFIs found for this project. Create your first RFI to get started.</CardContent></Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden md:block">
              <Table data-testid="proj-table-rfis">
                <TableHeader>
                  <TableRow>
                    <TableHead>RFI #</TableHead><TableHead>Subject</TableHead><TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead><TableHead>Submitted By</TableHead><TableHead>Date Submitted</TableHead>
                    <TableHead>Date Required</TableHead><TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRFIs.map((rfi) => (
                    <TableRow key={rfi.id} className="cursor-pointer" onClick={() => openDetail(rfi)} data-testid={`proj-row-rfi-${rfi.id}`}>
                      <TableCell className="font-medium" data-testid={`proj-text-rfi-number-${rfi.id}`}>{rfi.rfiNumber}</TableCell>
                      <TableCell className="max-w-[200px] truncate" data-testid={`proj-text-rfi-subject-${rfi.id}`}>{rfi.subject}</TableCell>
                      <TableCell data-testid={`proj-badge-rfi-priority-${rfi.id}`}>{getPriorityBadge(rfi.priority)}</TableCell>
                      <TableCell data-testid={`proj-badge-rfi-status-${rfi.id}`}>{getStatusBadge(rfi.status)}</TableCell>
                      <TableCell data-testid={`proj-text-rfi-submitter-${rfi.id}`}>{rfi.submittedByName || "—"}</TableCell>
                      <TableCell data-testid={`proj-text-rfi-submitted-date-${rfi.id}`}>{rfi.dateSubmitted ? format(new Date(rfi.dateSubmitted), "MMM d, yyyy") : "—"}</TableCell>
                      <TableCell data-testid={`proj-text-rfi-required-date-${rfi.id}`}>
                        {rfi.dateRequired ? (
                          <span className="flex items-center gap-1 flex-wrap">
                            <span className={isRfiOverdue(rfi) ? "text-red-600 dark:text-red-400 font-medium" : ""}>{format(new Date(rfi.dateRequired), "MMM d, yyyy")}</span>
                            {isRfiOverdue(rfi) && <Badge variant="destructive" className="text-xs" data-testid={`proj-badge-overdue-${rfi.id}`}><Clock className="h-3 w-3 mr-1" />Overdue</Badge>}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openDetail(rfi); }} data-testid={`proj-button-view-rfi-${rfi.id}`}>
                          <Eye className="h-4 w-4 mr-1" />View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="md:hidden space-y-3 p-3">
              {filteredRFIs.map((rfi) => (
                <div key={rfi.id} className="border rounded-md p-3 space-y-2 cursor-pointer" onClick={() => openDetail(rfi)} data-testid={`proj-row-rfi-mobile-${rfi.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm" data-testid={`proj-text-rfi-number-mobile-${rfi.id}`}>{rfi.rfiNumber}</span>
                    <span className="shrink-0" data-testid={`proj-badge-rfi-status-mobile-${rfi.id}`}>{getStatusBadge(rfi.status)}</span>
                  </div>
                  <div className="text-sm truncate" data-testid={`proj-text-rfi-subject-mobile-${rfi.id}`}>{rfi.subject}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div data-testid={`proj-badge-rfi-priority-mobile-${rfi.id}`}><span className="block mb-1">Priority</span>{getPriorityBadge(rfi.priority)}</div>
                    <div data-testid={`proj-text-rfi-submitter-mobile-${rfi.id}`}><span className="block mb-1">Submitted By</span><span className="text-foreground text-sm">{rfi.submittedByName || "—"}</span></div>
                    <div data-testid={`proj-text-rfi-submitted-date-mobile-${rfi.id}`}><span className="block mb-1">Date Submitted</span><span className="text-foreground text-sm">{rfi.dateSubmitted ? format(new Date(rfi.dateSubmitted), "MMM d, yyyy") : "—"}</span></div>
                    <div data-testid={`proj-text-rfi-required-date-mobile-${rfi.id}`}>
                      <span className="block mb-1">Date Required</span>
                      <span className={`text-foreground text-sm ${isRfiOverdue(rfi) ? "text-red-600 dark:text-red-400 font-medium" : ""}`}>{rfi.dateRequired ? format(new Date(rfi.dateRequired), "MMM d, yyyy") : "—"}</span>
                      {isRfiOverdue(rfi) && <Badge variant="destructive" className="text-xs mt-1" data-testid={`proj-badge-overdue-mobile-${rfi.id}`}><Clock className="h-3 w-3 mr-1" />Overdue</Badge>}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); openDetail(rfi); }} data-testid={`proj-button-view-rfi-mobile-${rfi.id}`}>
                    <Eye className="h-4 w-4 mr-1" />View
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg" data-testid="proj-dialog-create-rfi">
          <DialogHeader>
            <DialogTitle>Create RFI</DialogTitle>
            <DialogDescription>Submit a new Request for Information for {projectCode}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
            <RfiCreateFields
              form={createForm}
              onChange={(updates) => setCreateForm({ ...createForm, ...updates })}
              subcontractors={subcontractors}
              testIdPrefix="proj-"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="proj-button-cancel-create">Cancel</Button>
            <Button
              onClick={() => mutations.createMutation.mutate({ ...createForm, projectId })}
              disabled={!createForm.subject || !createForm.question || mutations.createMutation.isPending}
              data-testid="proj-button-submit-create"
            >
              {mutations.createMutation.isPending ? "Creating..." : "Create RFI"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RfiDetailDialog
        open={showDetailDialog}
        onOpenChange={setShowDetailDialog}
        rfi={selectedRFI}
        onRfiUpdate={setSelectedRFI}
        mutations={mutations}
        testIdPrefix="proj-"
        attachmentsSlot={
          selectedRFI ? (
            <DocumentAttachments
              entityType="rfi"
              entityId={selectedRFI.id}
              canUpload={["ADMIN", "MANAGER", "SUPERINTENDENT"].includes(userRole)}
              canDelete={["ADMIN", "MANAGER"].includes(userRole)}
              compact
            />
          ) : null
        }
      />
    </div>
  );
}
